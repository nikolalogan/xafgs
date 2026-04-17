package service

import (
	"archive/zip"
	"bufio"
	"bytes"
	"compress/flate"
	"compress/lzw"
	"compress/zlib"
	"context"
	"encoding/ascii85"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"sxfgssever/server/internal/model"
)

const maxDocumentParseBytes int64 = 20 * 1024 * 1024

const (
	pdfExtractorPyMuPDF = "pymupdf"
	pdfExtractorMuPDF   = "mupdf"
	pdfExtractorNative  = "native"
	pdfMuPDFTimeout     = 20 * time.Second
)

type OCRRequest struct {
	FileID    int64
	VersionNo int
	MimeType  string
	Content   []byte
}

type OCRResponse struct {
	Text string
}

type OCRProvider interface {
	Name() string
	IsConfigured() bool
	Extract(ctx context.Context, request OCRRequest) (OCRResponse, error)
}

type NoopOCRProvider struct{}

func NewNoopOCRProvider() OCRProvider {
	return &NoopOCRProvider{}
}

func (provider *NoopOCRProvider) Name() string {
	return "noop"
}

func (provider *NoopOCRProvider) IsConfigured() bool {
	return false
}

func (provider *NoopOCRProvider) Extract(_ context.Context, _ OCRRequest) (OCRResponse, error) {
	return OCRResponse{}, nil
}

type DocumentProfile struct {
	FileType           string  `json:"fileType"`
	HasTextLayer       bool    `json:"hasTextLayer"`
	TextDensity        float64 `json:"textDensity"`
	IsScannedSuspected bool    `json:"isScannedSuspected"`
	OCRRequired        bool    `json:"ocrRequired"`
	ParseStrategy      string  `json:"parseStrategy"`
	PageCount          int     `json:"pageCount"`
	SourceType         string  `json:"sourceType"`
	BizClass           string  `json:"bizClass,omitempty"`
	OCRSkipReason      string  `json:"ocrSkipReason,omitempty"`
	ImageOCRApplied    bool    `json:"imageOcrApplied,omitempty"`
	ImageOCRAppendCount int    `json:"imageOcrAppendCount,omitempty"`
	OCRQueueMode       string  `json:"ocrQueueMode,omitempty"`
	PDFDiagnostics     any     `json:"pdfDiagnostics,omitempty"`
}

type ParsedDocument struct {
	Version        model.FileVersionDTO
	Profile        DocumentProfile
	OCRTask        *model.OCRTask
	Slices         []model.DocumentSlice
	Tables         []model.DocumentTable
	TableFragments []model.DocumentTableFragment
	TableCells     []model.DocumentTableCell
	Figures        []model.DocumentFigureCandidate
}

type DocumentParseService interface {
	ParseCaseFile(ctx context.Context, caseFile model.ReportCaseFile) (ParsedDocument, *model.APIError)
}

type documentParseService struct {
	fileService    FileService
	ocrProvider    OCRProvider
	ocrTaskService OCRTaskService
}

func NewDocumentParseService(fileService FileService, ocrProvider OCRProvider, ocrTaskService OCRTaskService) DocumentParseService {
	return &documentParseService{
		fileService:    fileService,
		ocrProvider:    ocrProvider,
		ocrTaskService: ocrTaskService,
	}
}

func (service *documentParseService) ParseCaseFile(ctx context.Context, caseFile model.ReportCaseFile) (ParsedDocument, *model.APIError) {
	version, raw, apiError := service.fileService.ReadReferenceContent(ctx, caseFile.FileID, caseFile.VersionNo, maxDocumentParseBytes)
	if apiError != nil {
		return ParsedDocument{}, apiError
	}

	bizKey := ""
	if fileDTO, fileError := service.fileService.GetFile(ctx, caseFile.FileID); fileError == nil {
		bizKey = fileDTO.BizKey
	}
	profile := buildDocumentProfile(version, raw)
	applyBusinessProfileHints(&profile, bizKey)
	switch profile.FileType {
	case "text", "json":
		text := decodePlainTextPayload(raw)
		if text == "" {
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := buildDelimitedTables(caseFile, version, text, profile, ',')
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	case "csv":
		text := decodePlainTextPayload(raw)
		if text == "" {
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := buildDelimitedTables(caseFile, version, text, profile, ',')
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	case "tsv":
		text := decodePlainTextPayload(raw)
		if text == "" {
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := buildDelimitedTables(caseFile, version, text, profile, '\t')
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	case "docx":
		slices, tables, fragments, cells := parseDOCXDocument(caseFile, version, raw, profile)
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	case "xlsx":
		slices, tables, fragments, cells := parseXLSXDocument(caseFile, version, raw, profile)
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	case "xls":
		slices := parseLegacyXLSDocument(caseFile, version, raw, profile)
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	case "pdf":
		if profile.OCRRequired {
			if service.ocrTaskService != nil {
				task, taskError := service.ocrTaskService.EnsureTask(ctx, version, raw, profile)
				if taskError == nil {
					if task.Status == model.OCRTaskStatusSucceeded {
						if parsed, ok := buildParsedDocumentFromOCRTask(caseFile, version, profile, task); ok {
							parsed.OCRTask = &task
							logPDFParseSummary(caseFile, version, parsed.Profile, len(parsed.Slices), len(parsed.Tables))
							return parsed, nil
						}
					}
					logPDFParseSummary(caseFile, version, profile, 0, 0)
					return ParsedDocument{
						Version: version,
						Profile: profile,
						OCRTask: &task,
						Slices:  buildScannedPageSlices(caseFile, version, profile),
					}, nil
				}
			}
			logPDFParseSummary(caseFile, version, profile, 0, 0)
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		slices, tables, fragments, cells, figures := parsePDFDocument(caseFile, version, raw, profile)
		logPDFParseSummary(caseFile, version, profile, len(slices), len(tables))
		parsed := ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells, Figures: figures}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	default:
		if profile.OCRRequired {
			if service.ocrTaskService != nil {
				task, taskError := service.ocrTaskService.EnsureTask(ctx, version, raw, profile)
				if taskError == nil {
					if task.Status == model.OCRTaskStatusSucceeded {
						if parsed, ok := buildParsedDocumentFromOCRTask(caseFile, version, profile, task); ok {
							parsed.OCRTask = &task
							return parsed, nil
						}
					}
					return ParsedDocument{
						Version: version,
						Profile: profile,
						OCRTask: &task,
						Slices:  buildScannedPageSlices(caseFile, version, profile),
					}, nil
				}
			}
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		text := decodePlainTextPayload(raw)
		if text == "" {
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices: []model.DocumentSlice{
					{
						CaseFileID:  caseFile.ID,
						FileID:      caseFile.FileID,
						VersionNo:   version.VersionNo,
						SliceType:   model.DocumentStructurePage,
						SourceType:  profile.SourceType,
						Title:       version.OriginName,
						PageStart:   1,
						PageEnd:     max(1, profile.PageCount),
						BBoxJSON:    json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
						RawText:     "",
						CleanText:   "",
						TableJSON:   json.RawMessage(`null`),
						Confidence:  0.25,
						ParseStatus: model.DocumentParseStatusParsed,
						OCRPending:  false,
					},
				},
			}, nil
		}
		parsed := ParsedDocument{
			Version: version,
			Profile: profile,
			Slices:  buildTextSlices(caseFile, version, text, profile),
		}
		return service.applyOCRSupplementIfNeeded(ctx, caseFile, version, raw, parsed), nil
	}
}

func buildDocumentProfile(version model.FileVersionDTO, raw []byte) DocumentProfile {
	fileType := detectDocumentType(version, raw)
	if fileType == "xlsx" && isOLECompoundDocument(raw) {
		fileType = "xls"
	}
	pageCount := 1
	hasTextLayer := false
	textDensity := 0.0
	isScannedSuspected := false
	ocrRequired := false
	parseStrategy := "native_text"
	sourceType := model.DocumentSourceTypeNativeText

	switch fileType {
	case "image":
		isScannedSuspected = true
		ocrRequired = true
		parseStrategy = "needs_ocr"
		sourceType = model.DocumentSourceTypeBinary
	case "pdf":
		extracted := extractPDFTextResult(raw)
		pageCount = max(1, len(extracted.Pages))
		text := strings.TrimSpace(joinPDFPageTexts(extracted.Pages))
		hasTextLayer = extracted.HasTextOperators || text != ""
		if pageCount <= 0 {
			pageCount = 1
		}
		textDensity = float64(len([]rune(text))) / float64(pageCount)
		if extracted.DecodeFailed || (extracted.HasTextOperators && textDensity < 24) {
			parseStrategy = extracted.DecodeMode
			if parseStrategy == "" || parseStrategy == "pdf_native_fallback" {
				parseStrategy = "pdf_decode_failed"
			}
			sourceType = model.DocumentSourceTypeTextLayer
		} else if !hasTextLayer || textDensity < 24 {
			isScannedSuspected = true
			ocrRequired = true
			parseStrategy = "needs_ocr"
			sourceType = model.DocumentSourceTypeBinary
		} else {
			parseStrategy = extracted.DecodeMode
			sourceType = model.DocumentSourceTypeTextLayer
		}
		if extracted.Diagnostics.DecodeMode == "" {
			extracted.Diagnostics.DecodeMode = parseStrategy
		}
		extracted.Diagnostics.DecodeFailed = extracted.DecodeFailed
		extracted.Diagnostics.HasTextOperators = extracted.HasTextOperators
		extracted.Diagnostics.PageCount = pageCount
		if len(extracted.Diagnostics.Pages) > 0 {
			// diagnostics attached below
		}
	case "csv":
		parseStrategy = "delimited_table"
	case "tsv":
		parseStrategy = "delimited_table"
	case "docx":
		hasTextLayer = true
		parseStrategy = "docx_ooxml_native"
		sourceType = model.DocumentSourceTypeNativeText
	case "xlsx":
		hasTextLayer = true
		parseStrategy = "xlsx_ooxml_native"
		sourceType = model.DocumentSourceTypeNativeText
	case "xls":
		hasTextLayer = true
		parseStrategy = "xls_cfbf_heuristic"
		sourceType = model.DocumentSourceTypeBinary
	case "json":
		parseStrategy = "json_text"
	case "text":
		parseStrategy = "native_text"
	default:
		parseStrategy = "binary_fallback"
		sourceType = model.DocumentSourceTypeBinary
	}

	return DocumentProfile{
		FileType:           fileType,
		HasTextLayer:       hasTextLayer,
		TextDensity:        textDensity,
		IsScannedSuspected: isScannedSuspected,
		OCRRequired:        ocrRequired,
		ParseStrategy:      parseStrategy,
		PageCount:          max(1, pageCount),
		SourceType:         sourceType,
		PDFDiagnostics: func() any {
			if fileType != "pdf" {
				return nil
			}
			extracted := extractPDFTextResult(raw)
			if extracted.Diagnostics.DecodeMode == "" {
				extracted.Diagnostics.DecodeMode = parseStrategy
			}
			extracted.Diagnostics.PageCount = max(1, pageCount)
			extracted.Diagnostics.DecodeFailed = extracted.DecodeFailed
			extracted.Diagnostics.HasTextOperators = extracted.HasTextOperators
			return extracted.Diagnostics
		}(),
	}
}

func applyBusinessProfileHints(profile *DocumentProfile, bizKey string) {
	if profile == nil {
		return
	}
	profile.BizClass = detectBizClassByBizKey(bizKey)
	profile.OCRQueueMode = "single_worker"
	if profile.BizClass == "std_doc" && isTextualDocumentProfile(*profile) {
		profile.OCRSkipReason = "std_doc_textual_skip_ocr"
	}
}

func detectBizClassByBizKey(bizKey string) string {
	normalized := strings.ToLower(strings.TrimSpace(bizKey))
	switch {
	case strings.HasPrefix(normalized, "std_doc:"):
		return "std_doc"
	case strings.HasPrefix(normalized, "std_att:"):
		return "std_att"
	default:
		return "other"
	}
}

func isTextualDocumentProfile(profile DocumentProfile) bool {
	if profile.OCRRequired {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(profile.FileType)) {
	case "text", "json", "csv", "tsv", "docx", "xlsx", "xls":
		return true
	case "pdf":
		return profile.HasTextLayer
	default:
		return false
	}
}

func buildTextSlices(caseFile model.ReportCaseFile, version model.FileVersionDTO, text string, profile DocumentProfile) []model.DocumentSlice {
	normalized := normalizeText(text)
	if normalized == "" {
		return buildScannedPageSlices(caseFile, version, profile)
	}
	paragraphs := splitParagraphs(normalized)
	slices := make([]model.DocumentSlice, 0, len(paragraphs)+1)
	slices = append(slices, model.DocumentSlice{
		CaseFileID:  caseFile.ID,
		FileID:      caseFile.FileID,
		VersionNo:   version.VersionNo,
		SliceType:   model.DocumentStructureSection,
		SourceType:  profile.SourceType,
		Title:       version.OriginName,
		TitleLevel:  1,
		PageStart:   1,
		PageEnd:     max(1, profile.PageCount),
		BBoxJSON:    json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
		RawText:     normalized,
		CleanText:   normalized,
		TableJSON:   json.RawMessage(`null`),
		Confidence:  0.92,
		ParseStatus: model.DocumentParseStatusParsed,
		OCRPending:  false,
	})
	for _, paragraph := range paragraphs {
		titleLevel := 0
		sliceType := model.DocumentStructureParagraph
		title := ""
		if isLikelyTitle(paragraph) {
			sliceType = model.DocumentStructureSection
			titleLevel = inferTitleLevel(paragraph)
			title = paragraph
		}
		slices = append(slices, model.DocumentSlice{
			CaseFileID:  caseFile.ID,
			FileID:      caseFile.FileID,
			VersionNo:   version.VersionNo,
			SliceType:   sliceType,
			SourceType:  profile.SourceType,
			Title:       title,
			TitleLevel:  titleLevel,
			PageStart:   1,
			PageEnd:     max(1, profile.PageCount),
			BBoxJSON:    json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
			RawText:     paragraph,
			CleanText:   paragraph,
			TableJSON:   json.RawMessage(`null`),
			Confidence:  0.88,
			ParseStatus: model.DocumentParseStatusParsed,
			OCRPending:  false,
		})
	}
	return slices
}

func buildScannedPageSlices(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile) []model.DocumentSlice {
	pageCount := max(1, profile.PageCount)
	slices := make([]model.DocumentSlice, 0, pageCount)
	for pageNo := 1; pageNo <= pageCount; pageNo++ {
		slices = append(slices, model.DocumentSlice{
			CaseFileID:  caseFile.ID,
			FileID:      caseFile.FileID,
			VersionNo:   version.VersionNo,
			SliceType:   model.DocumentStructurePage,
			SourceType:  model.DocumentSourceTypeBinary,
			Title:       "待 OCR 页 " + strconv.Itoa(pageNo),
			PageStart:   pageNo,
			PageEnd:     pageNo,
			BBoxJSON:    json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
			RawText:     "",
			CleanText:   "",
			TableJSON:   json.RawMessage(`null`),
			Confidence:  0.35,
			ParseStatus: model.DocumentParseStatusNeedsOCR,
			OCRPending:  true,
		})
	}
	return slices
}

func buildFailedPDFPageSlices(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, pageCount int) []model.DocumentSlice {
	slices := make([]model.DocumentSlice, 0, max(1, pageCount))
	for pageNo := 1; pageNo <= max(1, pageCount); pageNo++ {
		slices = append(slices, model.DocumentSlice{
			CaseFileID:  caseFile.ID,
			FileID:      caseFile.FileID,
			VersionNo:   version.VersionNo,
			SliceType:   model.DocumentStructurePage,
			SourceType:  model.DocumentSourceTypeTextLayer,
			Title:       "PDF 解码失败页 " + strconv.Itoa(pageNo),
			PageStart:   pageNo,
			PageEnd:     pageNo,
			BBoxJSON:    json.RawMessage(fmt.Sprintf(`{"page":%d,"decode":"failed"}`, pageNo)),
			RawText:     "",
			CleanText:   "",
			TableJSON:   json.RawMessage(`null`),
			Confidence:  0.2,
			ParseStatus: model.DocumentParseStatusFailed,
			OCRPending:  false,
		})
	}
	return slices
}

func parseLegacyXLSDocument(caseFile model.ReportCaseFile, version model.FileVersionDTO, raw []byte, profile DocumentProfile) []model.DocumentSlice {
	text := strings.TrimSpace(extractLegacyXLSHeuristicText(raw))
	if text == "" {
		return []model.DocumentSlice{
			{
				CaseFileID:  caseFile.ID,
				FileID:      caseFile.FileID,
				VersionNo:   version.VersionNo,
				SliceType:   model.DocumentStructurePage,
				SourceType:  profile.SourceType,
				Title:       "旧版 Excel 解析失败",
				PageStart:   1,
				PageEnd:     1,
				BBoxJSON:    json.RawMessage(`{"format":"xls","parser":"heuristic"}`),
				RawText:     "",
				CleanText:   "",
				TableJSON:   json.RawMessage(`null`),
				Confidence:  0.2,
				ParseStatus: model.DocumentParseStatusFailed,
				OCRPending:  false,
			},
		}
	}
	return []model.DocumentSlice{
		{
			CaseFileID:  caseFile.ID,
			FileID:      caseFile.FileID,
			VersionNo:   version.VersionNo,
			SliceType:   model.DocumentStructureSection,
			SourceType:  profile.SourceType,
			Title:       version.OriginName,
			TitleLevel:  1,
			PageStart:   1,
			PageEnd:     1,
			BBoxJSON:    json.RawMessage(`{"format":"xls","parser":"heuristic"}`),
			RawText:     text,
			CleanText:   text,
			TableJSON:   json.RawMessage(`null`),
			Confidence:  0.55,
			ParseStatus: model.DocumentParseStatusParsed,
			OCRPending:  false,
		},
	}
}

func buildDelimitedTables(caseFile model.ReportCaseFile, version model.FileVersionDTO, text string, profile DocumentProfile, comma rune) ([]model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell) {
	reader := csv.NewReader(strings.NewReader(text))
	reader.Comma = comma
	reader.TrimLeadingSpace = true
	rows, err := reader.ReadAll()
	if err != nil || len(rows) == 0 {
		return nil, nil, nil
	}
	table := model.DocumentTable{
		CaseFileID:     caseFile.ID,
		FileID:         caseFile.FileID,
		VersionNo:      version.VersionNo,
		Title:          version.OriginName,
		PageStart:      1,
		PageEnd:        1,
		HeaderRowCount: 1,
		ColumnCount:    maxRowWidth(rows),
		SourceType:     profile.SourceType,
		ParseStatus:    model.DocumentParseStatusParsed,
		IsCrossPage:    false,
		BBoxJSON:       json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
	}
	fragment := model.DocumentTableFragment{
		CaseFileID:    caseFile.ID,
		PageNo:        1,
		RowStart:      0,
		RowEnd:        len(rows) - 1,
		FragmentOrder: 1,
		BBoxJSON:      json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
	}
	cells := make([]model.DocumentTableCell, 0)
	for rowIndex, row := range rows {
		for colIndex, value := range row {
			cells = append(cells, model.DocumentTableCell{
				CaseFileID:      caseFile.ID,
				RowIndex:        rowIndex,
				ColIndex:        colIndex,
				RowSpan:         1,
				ColSpan:         1,
				RawText:         value,
				NormalizedValue: strings.TrimSpace(value),
				BBoxJSON:        json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
				Confidence:      0.96,
			})
		}
	}
	return []model.DocumentTable{table}, []model.DocumentTableFragment{fragment}, cells
}

func detectPipeTables(caseFile model.ReportCaseFile, version model.FileVersionDTO, text string, profile DocumentProfile) ([]model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell) {
	lines := strings.Split(normalizeText(text), "\n")
	tableLines := make([]string, 0)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.Count(trimmed, "|") >= 2 {
			tableLines = append(tableLines, trimmed)
		}
	}
	if len(tableLines) < 2 {
		return nil, nil, nil
	}
	csvText := strings.Join(tableLines, "\n")
	csvText = strings.ReplaceAll(csvText, "|", ",")
	return buildDelimitedTables(caseFile, version, csvText, profile, ',')
}

func detectPDFTables(caseFile model.ReportCaseFile, version model.FileVersionDTO, text string, profile DocumentProfile) ([]model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell) {
	tables, fragments, cells := detectPipeTables(caseFile, version, text, profile)
	if len(tables) > 0 {
		return tables, fragments, cells
	}
	rows := detectAlignedRows(text)
	if len(rows) < 2 {
		return nil, nil, nil
	}
	table, fragment, tableCells := buildStructuredTable(caseFile, version, profile, -1, version.OriginName, rows, 1, `{"detected":"aligned_text"}`, "PDF")
	return []model.DocumentTable{table}, []model.DocumentTableFragment{fragment}, tableCells
}

type pdfPageText struct {
	PageNo int
	Text   string
	Width  float64
	Height float64
	Blocks []pdfLayoutBlock
	Tables []pdfDetectedTable
}

type pdfExtractionResult struct {
	Pages            []pdfPageText
	DecodeMode       string
	DecodeFailed     bool
	HasTextOperators bool
	Diagnostics      pdfDiagnostics
}

type pdfDiagnostics struct {
	Extractor        string                 `json:"extractor"`
	TableDetector    string                 `json:"tableDetector,omitempty"`
	PageCount        int                    `json:"pageCount"`
	DecodeMode       string                 `json:"decodeMode"`
	DecodeFailed     bool                   `json:"decodeFailed"`
	HasTextOperators bool                   `json:"hasTextOperators"`
	Errors           []string               `json:"errors,omitempty"`
	ResourceHints    pdfResourceHints       `json:"resourceHints"`
	Pages            []pdfPageDiagnostic    `json:"pages"`
	Fonts            []pdfFontDiagnostic    `json:"fonts"`
	XObjects         []pdfXObjectDiagnostic `json:"xobjects"`
	Filters          []pdfFilterDiagnostic  `json:"filters"`
}

type pdfLayoutBBox struct {
	XMin float64 `json:"xMin"`
	YMin float64 `json:"yMin"`
	XMax float64 `json:"xMax"`
	YMax float64 `json:"yMax"`
}

type pdfLayoutWord struct {
	Text string
	BBox pdfLayoutBBox
}

type pdfLayoutLine struct {
	Index int
	Text  string
	BBox  pdfLayoutBBox
	Words []pdfLayoutWord
}

type pdfLayoutBlock struct {
	Index int
	Text  string
	BBox  pdfLayoutBBox
	Lines []pdfLayoutLine
}

type pdfDetectedTable struct {
	Index      int
	BBox       pdfLayoutBBox
	Rows       [][]string
	Cells      []pdfDetectedCell
	BlockIndex int
	Detector   string
}

type pdfDetectedCell struct {
	RowIndex int
	ColIndex int
	Text     string
	BBox     pdfLayoutBBox
}

type pdfResourceHints struct {
	PageResourcesResolvedCount int `json:"pageResourcesResolvedCount"`
	PageXObjectResolvedCount   int `json:"pageXObjectResolvedCount"`
	PageDoMatchCount           int `json:"pageDoMatchCount"`
}

type pdfPageDiagnostic struct {
	PageNo           int      `json:"pageNo"`
	ContentsCount    int      `json:"contentsCount"`
	ContentsRefs     []string `json:"contentsRefs"`
	HasTextOperators bool     `json:"hasTextOperators"`
	UsedToUnicode    bool     `json:"usedToUnicode"`
	DecodeFailed     bool     `json:"decodeFailed"`
	DoCount          int      `json:"doCount"`
	CharCount        int      `json:"charCount"`
}

type pdfFontDiagnostic struct {
	ResourceName     string `json:"resourceName"`
	BaseFont         string `json:"baseFont"`
	Encoding         string `json:"encoding"`
	HasToUnicode     bool   `json:"hasToUnicode"`
	ToUnicodeEntries int    `json:"toUnicodeEntries"`
}

type pdfXObjectDiagnostic struct {
	ResourceName     string `json:"resourceName"`
	ObjectID         string `json:"objectId"`
	Subtype          string `json:"subtype"`
	Depth            int    `json:"depth"`
	HasTextOperators bool   `json:"hasTextOperators"`
	CharCount        int    `json:"charCount"`
}

type pdfFilterDiagnostic struct {
	ObjectID string   `json:"objectId"`
	Filters  []string `json:"filters"`
}

func pdfPageBBoxJSON(page pdfPageText) json.RawMessage {
	payload := map[string]any{
		"page": page.PageNo,
	}
	if page.Width > 0 {
		payload["width"] = page.Width
	}
	if page.Height > 0 {
		payload["height"] = page.Height
	}
	return mustJSON(payload)
}

func pdfLayoutBlockBBoxJSON(page pdfPageText, block pdfLayoutBlock) json.RawMessage {
	payload := map[string]any{
		"page":  page.PageNo,
		"block": block.Index,
		"bbox":  block.BBox,
	}
	if len(block.Lines) > 0 {
		payload["lineStart"] = block.Lines[0].Index
		payload["lineEnd"] = block.Lines[len(block.Lines)-1].Index
	}
	return mustJSON(payload)
}

func buildPDFPageBlocks(page pdfPageText) []pdfBlock {
	if len(page.Blocks) == 0 {
		return splitPDFPageBlocks(page.Text)
	}
	blocks := make([]pdfBlock, 0, len(page.Blocks))
	for index := 0; index < len(page.Blocks); index++ {
		layoutBlock := page.Blocks[index]
		if isPDFNoiseBlock(layoutBlock) {
			continue
		}
		blockText := normalizeText(layoutBlock.Text)
		if blockText == "" {
			continue
		}
		if isLikelyFigureAnchorBlock(blockText) {
			figureType := detectFigureType(blockText)
			figureBlocks := []pdfLayoutBlock{layoutBlock}
			figureTexts := []string{blockText}
			lastBBox := layoutBlock.BBox
			nextIndex := index + 1
			for ; nextIndex < len(page.Blocks); nextIndex++ {
				nextBlock := page.Blocks[nextIndex]
				if isPDFNoiseBlock(nextBlock) {
					continue
				}
				nextText := normalizeText(nextBlock.Text)
				if nextText == "" {
					continue
				}
				rows := detectAlignedRows(nextText)
				if len(rows) >= 2 && looksLikeTableCandidate(rows) && figureType == model.DocumentFigureTypeGenericFigure {
					break
				}
				if isLikelyTitle(nextText) || isNarrativePDFBlock(nextText) {
					break
				}
				if !isLikelyFigureContinuation(layoutBlock.BBox, lastBBox, nextBlock, nextText) {
					break
				}
				figureBlocks = append(figureBlocks, nextBlock)
				figureTexts = append(figureTexts, nextText)
				lastBBox = nextBlock.BBox
			}
			blocks = append(blocks, pdfBlock{
				Index:       layoutBlock.Index,
				Kind:        model.DocumentStructureFigureCandidate,
				Title:       blockText,
				Text:        normalizeText(strings.Join(figureTexts, "\n")),
				FigureType:  figureType,
				SourceBBox:  mergePDFLayoutBBox(figureBlocks),
				FigureNodes: buildFigureNodes(figureBlocks),
			})
			index = nextIndex - 1
			continue
		}
		rows := detectAlignedRows(blockText)
		if len(rows) >= 2 && looksLikeTableCandidate(rows) {
			blocks = append(blocks, pdfBlock{
				Index:      layoutBlock.Index,
				Kind:       model.DocumentStructureTableCandidate,
				Text:       rowsToText(rows),
				Rows:       rows,
				SourceBBox: layoutBlock.BBox,
			})
			continue
		}
		blockKind := model.DocumentStructureParagraph
		title := ""
		titleLevel := 0
		if isLikelyTitle(blockText) {
			blockKind = model.DocumentStructureSection
			title = blockText
			titleLevel = inferTitleLevel(blockText)
		}
		blocks = append(blocks, pdfBlock{
			Index:      layoutBlock.Index,
			Kind:       blockKind,
			Title:      title,
			TitleLevel: titleLevel,
			Text:       blockText,
			SourceBBox: layoutBlock.BBox,
		})
	}
	return blocks
}

func parsePDFDocument(caseFile model.ReportCaseFile, version model.FileVersionDTO, raw []byte, profile DocumentProfile) ([]model.DocumentSlice, []model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell, []model.DocumentFigureCandidate) {
	extracted := extractPDFTextResult(raw)
	pages := extracted.Pages
	if extracted.DecodeFailed || (extracted.HasTextOperators && strings.TrimSpace(joinPDFPageTexts(pages)) == "") {
		return buildFailedPDFPageSlices(caseFile, version, profile, max(1, len(pages))), nil, nil, nil, nil
	}
	if len(pages) == 0 {
		text := extractPDFText(raw)
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := detectPDFTables(caseFile, version, text, profile)
		return slices, tables, fragments, cells, nil
	}

	slices := make([]model.DocumentSlice, 0, len(pages)*3+1)
	tables := make([]model.DocumentTable, 0)
	fragments := make([]model.DocumentTableFragment, 0)
	cells := make([]model.DocumentTableCell, 0)
	figures := make([]model.DocumentFigureCandidate, 0)
	documentTexts := make([]string, 0, len(pages))
	virtualTableID := int64(-1)
	virtualFigureID := int64(-1)

	for _, page := range pages {
		pageText := normalizeText(page.Text)
		if pageText == "" {
			continue
		}
		documentTexts = append(documentTexts, fmt.Sprintf("[第%d页]\n%s", page.PageNo, pageText))
		slices = append(slices, model.DocumentSlice{
			CaseFileID:  caseFile.ID,
			FileID:      caseFile.FileID,
			VersionNo:   version.VersionNo,
			SliceType:   model.DocumentStructurePage,
			SourceType:  profile.SourceType,
			Title:       fmt.Sprintf("%s - 第%d页", version.OriginName, page.PageNo),
			PageStart:   page.PageNo,
			PageEnd:     page.PageNo,
			BBoxJSON:    pdfPageBBoxJSON(page),
			RawText:     pageText,
			CleanText:   pageText,
			TableJSON:   json.RawMessage(`null`),
			Confidence:  0.93,
			ParseStatus: model.DocumentParseStatusParsed,
			OCRPending:  false,
		})

		consumedBlockIndexes := make(map[int]bool)
		for _, detectedTable := range page.Tables {
			if len(detectedTable.Rows) < 2 {
				continue
			}
			tableBlockIndex := detectedTable.BlockIndex
			if tableBlockIndex > 0 {
				consumedBlockIndexes[tableBlockIndex] = true
			}
			tableBBox := mustJSON(map[string]any{
				"page":  page.PageNo,
				"block": tableBlockIndex,
				"bbox":  detectedTable.BBox,
			})
			tableTitle := findTableTitleFromPageBlocks(page.Blocks, tableBlockIndex, detectedTable.Index, version, page.PageNo)
			slices = append(slices, model.DocumentSlice{
				CaseFileID:  caseFile.ID,
				FileID:      caseFile.FileID,
				VersionNo:   version.VersionNo,
				SliceType:   model.DocumentStructureTableCandidate,
				SourceType:  profile.SourceType,
				Title:       tableTitle,
				PageStart:   page.PageNo,
				PageEnd:     page.PageNo,
				BBoxJSON:    tableBBox,
				RawText:     rowsToText(detectedTable.Rows),
				CleanText:   rowsToText(detectedTable.Rows),
				TableJSON:   mustJSON(detectedTable.Rows),
				Confidence:  0.9,
				ParseStatus: model.DocumentParseStatusParsed,
				OCRPending:  false,
			})
			table, fragment, tableCells := buildDetectedPDFTable(caseFile, version, profile, virtualTableID, tableTitle, detectedTable, page.PageNo, string(tableBBox))
			tables = append(tables, table)
			fragments = append(fragments, fragment)
			cells = append(cells, tableCells...)
			virtualTableID--
		}

		pageBlocks := buildPDFPageBlocks(page)
		for _, block := range pageBlocks {
			if consumedBlockIndexes[block.Index] {
				continue
			}
			blockBBox := mustJSON(map[string]any{
				"page":  page.PageNo,
				"block": block.Index,
			})
			for _, layoutBlock := range page.Blocks {
				if layoutBlock.Index == block.Index {
					blockBBox = pdfLayoutBlockBBoxJSON(page, layoutBlock)
					break
				}
			}
			if block.SourceBBox != (pdfLayoutBBox{}) {
				blockBBox = mustJSON(map[string]any{
					"page":  page.PageNo,
					"block": block.Index,
					"bbox":  block.SourceBBox,
				})
			}
			switch block.Kind {
			case model.DocumentStructureSection, model.DocumentStructureParagraph:
				slices = append(slices, model.DocumentSlice{
					CaseFileID:  caseFile.ID,
					FileID:      caseFile.FileID,
					VersionNo:   version.VersionNo,
					SliceType:   block.Kind,
					SourceType:  profile.SourceType,
					Title:       block.Title,
					TitleLevel:  block.TitleLevel,
					PageStart:   page.PageNo,
					PageEnd:     page.PageNo,
					BBoxJSON:    blockBBox,
					RawText:     block.Text,
					CleanText:   block.Text,
					TableJSON:   json.RawMessage(`null`),
					Confidence:  0.9,
					ParseStatus: model.DocumentParseStatusParsed,
					OCRPending:  false,
				})
			case model.DocumentStructureTableCandidate:
				tableTitle := fmt.Sprintf("%s - 第%d页候选表格%d", version.OriginName, page.PageNo, len(tables)+1)
				slices = append(slices, model.DocumentSlice{
					CaseFileID:  caseFile.ID,
					FileID:      caseFile.FileID,
					VersionNo:   version.VersionNo,
					SliceType:   model.DocumentStructureTableCandidate,
					SourceType:  profile.SourceType,
					Title:       tableTitle,
					PageStart:   page.PageNo,
					PageEnd:     page.PageNo,
					BBoxJSON:    blockBBox,
					RawText:     rowsToText(block.Rows),
					CleanText:   rowsToText(block.Rows),
					TableJSON:   mustJSON(block.Rows),
					Confidence:  0.82,
					ParseStatus: model.DocumentParseStatusParsed,
					OCRPending:  false,
				})
				table, fragment, tableCells := buildStructuredTable(caseFile, version, profile, virtualTableID, tableTitle, block.Rows, page.PageNo, string(blockBBox), fmt.Sprintf("PDF#p%d#b%d", page.PageNo, block.Index))
				tables = append(tables, table)
				fragments = append(fragments, fragment)
				cells = append(cells, tableCells...)
				virtualTableID--
			case model.DocumentStructureFigureCandidate:
				figureTitle := block.Title
				if strings.TrimSpace(figureTitle) == "" {
					figureTitle = fmt.Sprintf("%s - 第%d页候选图表%d", version.OriginName, page.PageNo, len(figures)+1)
				}
				slices = append(slices, model.DocumentSlice{
					CaseFileID:  caseFile.ID,
					FileID:      caseFile.FileID,
					VersionNo:   version.VersionNo,
					SliceType:   model.DocumentStructureFigureCandidate,
					SourceType:  profile.SourceType,
					Title:       figureTitle,
					PageStart:   page.PageNo,
					PageEnd:     page.PageNo,
					BBoxJSON:    blockBBox,
					RawText:     block.Text,
					CleanText:   block.Text,
					TableJSON:   json.RawMessage(`null`),
					Confidence:  0.78,
					ParseStatus: model.DocumentParseStatusParsed,
					OCRPending:  false,
				})
				figures = append(figures, model.DocumentFigureCandidate{
					ID:          virtualFigureID,
					CaseFileID:  caseFile.ID,
					FileID:      caseFile.FileID,
					VersionNo:   version.VersionNo,
					PageNo:      page.PageNo,
					BlockIndex:  block.Index,
					Title:       figureTitle,
					FigureType:  block.FigureType,
					SourceType:  profile.SourceType,
					RawText:     block.Text,
					CleanText:   block.Text,
					DetailJSON:  buildFigureDetailJSON(page.PageNo, block.FigureNodes),
					BBoxJSON:    blockBBox,
					Confidence:  0.78,
					ParseStatus: model.DocumentParseStatusParsed,
				})
				virtualFigureID--
			}
		}
	}

	if len(slices) == 0 {
		return buildScannedPageSlices(caseFile, version, profile), nil, nil, nil, nil
	}

	slices = append([]model.DocumentSlice{{
		CaseFileID:  caseFile.ID,
		FileID:      caseFile.FileID,
		VersionNo:   version.VersionNo,
		SliceType:   model.DocumentStructureSection,
		SourceType:  profile.SourceType,
		Title:       version.OriginName,
		TitleLevel:  1,
		PageStart:   1,
		PageEnd:     max(1, len(pages)),
		BBoxJSON:    json.RawMessage(`{"scope":"document"}`),
		RawText:     strings.Join(documentTexts, "\n\n"),
		CleanText:   strings.Join(documentTexts, "\n\n"),
		TableJSON:   json.RawMessage(`null`),
		Confidence:  0.94,
		ParseStatus: model.DocumentParseStatusParsed,
		OCRPending:  false,
	}}, slices...)
	return slices, tables, fragments, cells, figures
}

type pdfBlock struct {
	Index       int
	Kind        string
	Title       string
	TitleLevel  int
	Text        string
	Rows        [][]string
	FigureType  string
	SourceBBox  pdfLayoutBBox
	FigureNodes []pdfFigureNode
}

type pdfFigureNode struct {
	RowIndex   int
	Region     string
	Text       string
	BlockIndex int
	LineIndex  int
	BBox       pdfLayoutBBox
}

func splitPDFPageBlocks(pageText string) []pdfBlock {
	paragraphs := splitParagraphs(pageText)
	blocks := make([]pdfBlock, 0)
	index := 1
	for _, paragraph := range paragraphs {
		rows := detectAlignedRows(paragraph)
		if len(rows) >= 2 && looksLikeTableCandidate(rows) {
			blocks = append(blocks, pdfBlock{
				Index: index,
				Kind:  model.DocumentStructureTableCandidate,
				Text:  rowsToText(rows),
				Rows:  rows,
			})
			index++
			continue
		}
		blockKind := model.DocumentStructureParagraph
		title := ""
		titleLevel := 0
		if isLikelyTitle(paragraph) {
			blockKind = model.DocumentStructureSection
			title = paragraph
			titleLevel = inferTitleLevel(paragraph)
		}
		blocks = append(blocks, pdfBlock{
			Index:      index,
			Kind:       blockKind,
			Title:      title,
			TitleLevel: titleLevel,
			Text:       paragraph,
		})
		index++
	}
	return blocks
}

func looksLikeTableCandidate(rows [][]string) bool {
	if len(rows) < 2 {
		return false
	}
	columnCount := maxRowWidth(rows)
	if columnCount < 2 {
		return false
	}
	stableRows := 0
	denseRows := 0
	headerish := 0
	numericish := 0
	cellCount := 0
	longSentenceCells := 0
	totalRuneCount := 0
	punctuationHeavyCells := 0
	firstRowNonEmpty := 0
	unreadableCells := 0
	for rowIndex, row := range rows {
		nonEmptyInRow := 0
		for _, cell := range row {
			trimmed := strings.TrimSpace(cell)
			if trimmed == "" {
				continue
			}
			nonEmptyInRow++
			cellCount++
			totalRuneCount += len([]rune(trimmed))
			if rowIndex == 0 && len([]rune(trimmed)) <= 16 {
				headerish++
			}
			if rowIndex == 0 {
				firstRowNonEmpty++
			}
			if regexp.MustCompile(`[\d,，.%万元亿元年月日]+`).MatchString(trimmed) {
				numericish++
			}
			if len([]rune(trimmed)) >= 24 && regexp.MustCompile(`[，。；：]`).MatchString(trimmed) {
				longSentenceCells++
			}
			if regexp.MustCompile(`[，。；：、“”‘’（）]{2,}`).MatchString(trimmed) {
				punctuationHeavyCells++
			}
			if hasUnreadableText(trimmed) {
				unreadableCells++
			}
		}
		if nonEmptyInRow >= max(2, columnCount-1) {
			stableRows++
		}
		if nonEmptyInRow >= 2 {
			denseRows++
		}
	}
	if cellCount == 0 {
		return false
	}
	averageCellLength := totalRuneCount / cellCount
	headerLike := firstRowNonEmpty >= 2 && headerish >= max(2, columnCount/2)
	numericLike := numericish*3 >= cellCount
	structureOK := stableRows >= 2 && denseRows == len(rows)
	textTooNarrative := longSentenceCells*3 >= cellCount || punctuationHeavyCells*2 >= cellCount || averageCellLength > 18
	if !structureOK || textTooNarrative || unreadableCells > 0 {
		return false
	}
	return headerLike || numericLike
}

func detectAlignedRows(text string) [][]string {
	lines := strings.Split(normalizeText(text), "\n")
	rows := make([][]string, 0)
	expectedWidth := 0
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if len(rows) >= 2 {
				break
			}
			rows = rows[:0]
			expectedWidth = 0
			continue
		}
		parts := regexp.MustCompile(`\s{2,}|\t+`).Split(trimmed, -1)
		if len(parts) < 2 {
			if len(rows) >= 2 {
				break
			}
			rows = rows[:0]
			expectedWidth = 0
			continue
		}
		if expectedWidth == 0 {
			expectedWidth = len(parts)
		}
		if len(parts) != expectedWidth {
			if len(rows) >= 2 {
				break
			}
			rows = rows[:0]
			expectedWidth = len(parts)
		}
		rows = append(rows, parts)
	}
	return normalizeRows(rows)
}

type docxBlock struct {
	Kind       string
	Text       string
	Title      string
	TitleLevel int
	Rows       [][]string
	Cells      []structuredCell
}

type structuredCell struct {
	RowIndex     int
	ColIndex     int
	RowSpan      int
	ColSpan      int
	RawText      string
	DisplayValue string
	Formula      string
	SourceRef    string
}

func parseDOCXDocument(caseFile model.ReportCaseFile, version model.FileVersionDTO, raw []byte, profile DocumentProfile) ([]model.DocumentSlice, []model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell) {
	documentXML := readZipEntry(raw, "word/document.xml")
	if len(documentXML) == 0 {
		return buildScannedPageSlices(caseFile, version, profile), nil, nil, nil
	}
	blocks := parseDOCXBlocks(documentXML)
	slices := make([]model.DocumentSlice, 0, len(blocks)+1)
	tables := make([]model.DocumentTable, 0)
	fragments := make([]model.DocumentTableFragment, 0)
	cells := make([]model.DocumentTableCell, 0)
	combinedText := make([]string, 0, len(blocks))
	virtualTableID := int64(-1)
	for index, block := range blocks {
		switch block.Kind {
		case "paragraph", "section":
			if block.Text == "" {
				continue
			}
			combinedText = append(combinedText, block.Text)
			sliceType := model.DocumentStructureParagraph
			title := ""
			titleLevel := 0
			if block.Kind == "section" {
				sliceType = model.DocumentStructureSection
				title = block.Title
				titleLevel = block.TitleLevel
			}
			slices = append(slices, model.DocumentSlice{
				CaseFileID:  caseFile.ID,
				FileID:      caseFile.FileID,
				VersionNo:   version.VersionNo,
				SliceType:   sliceType,
				SourceType:  profile.SourceType,
				Title:       title,
				TitleLevel:  titleLevel,
				PageStart:   1,
				PageEnd:     1,
				BBoxJSON:    json.RawMessage(fmt.Sprintf(`{"block":%d}`, index+1)),
				RawText:     block.Text,
				CleanText:   block.Text,
				TableJSON:   json.RawMessage(`null`),
				Confidence:  0.94,
				ParseStatus: model.DocumentParseStatusParsed,
				OCRPending:  false,
			})
		case "table":
			tableText := rowsToText(block.Rows)
			if tableText == "" {
				continue
			}
			combinedText = append(combinedText, tableText)
			tableTitle := fmt.Sprintf("%s 表格 %d", version.OriginName, len(tables)+1)
			table, fragment, tableCells := buildRichStructuredTable(caseFile, version, profile, virtualTableID, tableTitle, block.Rows, block.Cells, 1, fmt.Sprintf(`{"block":%d}`, index+1))
			tables = append(tables, table)
			fragments = append(fragments, fragment)
			cells = append(cells, tableCells...)
			virtualTableID--
			slices = append(slices, model.DocumentSlice{
				CaseFileID:  caseFile.ID,
				FileID:      caseFile.FileID,
				VersionNo:   version.VersionNo,
				SliceType:   model.DocumentStructureTable,
				SourceType:  profile.SourceType,
				Title:       tableTitle,
				PageStart:   1,
				PageEnd:     1,
				BBoxJSON:    json.RawMessage(fmt.Sprintf(`{"block":%d}`, index+1)),
				RawText:     tableText,
				CleanText:   tableText,
				TableJSON:   mustJSON(block.Rows),
				Confidence:  0.94,
				ParseStatus: model.DocumentParseStatusParsed,
				OCRPending:  false,
			})
		}
	}
	if len(slices) == 0 {
		return buildScannedPageSlices(caseFile, version, profile), nil, nil, nil
	}
	slices = append([]model.DocumentSlice{{
		CaseFileID:  caseFile.ID,
		FileID:      caseFile.FileID,
		VersionNo:   version.VersionNo,
		SliceType:   model.DocumentStructureSection,
		SourceType:  profile.SourceType,
		Title:       version.OriginName,
		TitleLevel:  1,
		PageStart:   1,
		PageEnd:     1,
		BBoxJSON:    json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
		RawText:     strings.Join(combinedText, "\n\n"),
		CleanText:   strings.Join(combinedText, "\n\n"),
		TableJSON:   json.RawMessage(`null`),
		Confidence:  0.95,
		ParseStatus: model.DocumentParseStatusParsed,
		OCRPending:  false,
	}}, slices...)
	return slices, tables, fragments, cells
}

func parseDOCXBlocks(documentXML []byte) []docxBlock {
	decoder := xml.NewDecoder(bytes.NewReader(documentXML))
	blocks := make([]docxBlock, 0)
	inTable := false
	inParagraph := false
	inCell := false
	currentParagraph := strings.Builder{}
	currentStyle := ""
	currentRows := make([][]string, 0)
	currentRow := make([]string, 0)
	currentTableCells := make([]structuredCell, 0)
	currentCell := strings.Builder{}
	currentCellGridSpan := 1
	currentCellVMerge := ""
	currentTableIndex := 0
	currentRowIndex := -1
	currentColIndex := 0
	activeVMerges := map[int]int{}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return blocks
		}
		switch element := token.(type) {
		case xml.StartElement:
			switch element.Name.Local {
			case "tbl":
				inTable = true
				currentTableIndex++
				currentRows = make([][]string, 0)
				currentTableCells = make([]structuredCell, 0)
				activeVMerges = map[int]int{}
				currentRowIndex = -1
			case "tr":
				if inTable {
					currentRow = make([]string, 0)
					currentRowIndex++
					currentColIndex = 0
				}
			case "tc":
				if inTable {
					inCell = true
					currentCell.Reset()
					currentCellGridSpan = 1
					currentCellVMerge = ""
				}
			case "gridSpan":
				if inTable && inCell {
					if span, err := strconv.Atoi(strings.TrimSpace(attrValue(element, "val"))); err == nil && span > 1 {
						currentCellGridSpan = span
					}
				}
			case "vMerge":
				if inTable && inCell {
					currentCellVMerge = strings.TrimSpace(attrValue(element, "val"))
					if currentCellVMerge == "" {
						currentCellVMerge = "continue"
					}
				}
			case "p":
				inParagraph = true
				currentParagraph.Reset()
				currentStyle = ""
			case "pStyle":
				currentStyle = attrValue(element, "val")
			case "t":
				text := readElementText(decoder)
				if inTable && inCell {
					currentCell.WriteString(text)
				} else if inParagraph {
					currentParagraph.WriteString(text)
				}
			case "tab":
				if inTable && inCell {
					currentCell.WriteString("\t")
				} else if inParagraph {
					currentParagraph.WriteString("\t")
				}
			case "br":
				if inTable && inCell {
					currentCell.WriteString("\n")
				} else if inParagraph {
					currentParagraph.WriteString("\n")
				}
			}
		case xml.EndElement:
			switch element.Name.Local {
			case "p":
				text := strings.TrimSpace(currentParagraph.String())
				if text != "" && !inTable {
					titleLevel := docxTitleLevel(currentStyle, text)
					kind := "paragraph"
					title := ""
					if titleLevel > 0 {
						kind = "section"
						title = text
					}
					blocks = append(blocks, docxBlock{Kind: kind, Text: text, Title: title, TitleLevel: titleLevel})
				}
				inParagraph = false
			case "tc":
				if inTable {
					text := normalizeText(currentCell.String())
					colSpan := max(1, currentCellGridSpan)
					if currentCellVMerge == "continue" {
						if anchorIndex, ok := activeVMerges[currentColIndex]; ok && anchorIndex >= 0 && anchorIndex < len(currentTableCells) {
							currentTableCells[anchorIndex].RowSpan++
						}
					} else {
						if currentCellVMerge == "restart" {
							for spanCol := 0; spanCol < colSpan; spanCol++ {
								activeVMerges[currentColIndex+spanCol] = len(currentTableCells)
							}
						} else {
							for spanCol := 0; spanCol < colSpan; spanCol++ {
								delete(activeVMerges, currentColIndex+spanCol)
							}
						}
						currentTableCells = append(currentTableCells, structuredCell{
							RowIndex:     currentRowIndex,
							ColIndex:     currentColIndex,
							RowSpan:      1,
							ColSpan:      colSpan,
							RawText:      text,
							DisplayValue: text,
							SourceRef:    fmt.Sprintf("第1逻辑页/表格%d/单元格R%dC%d", currentTableIndex, currentRowIndex+1, currentColIndex+1),
						})
					}
					currentRow = append(currentRow, text)
					for spanIndex := 1; spanIndex < colSpan; spanIndex++ {
						currentRow = append(currentRow, "")
					}
					currentColIndex += colSpan
					inCell = false
				}
			case "tr":
				if inTable && len(currentRow) > 0 {
					currentRows = append(currentRows, currentRow)
				}
			case "tbl":
				if len(currentRows) > 0 {
					blocks = append(blocks, docxBlock{Kind: "table", Rows: normalizeRows(currentRows), Cells: currentTableCells})
				}
				inTable = false
			}
		}
	}
	return blocks
}

func parseXLSXDocument(caseFile model.ReportCaseFile, version model.FileVersionDTO, raw []byte, profile DocumentProfile) ([]model.DocumentSlice, []model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return buildScannedPageSlices(caseFile, version, profile), nil, nil, nil
	}
	entries := zipEntries(reader)
	sharedStrings := parseXLSXSharedStrings(entries["xl/sharedStrings.xml"])
	styles := parseXLSXStyles(entries["xl/styles.xml"])
	sheets := parseXLSXSheets(entries["xl/workbook.xml"], entries["xl/_rels/workbook.xml.rels"])
	slices := make([]model.DocumentSlice, 0, len(sheets)+1)
	tables := make([]model.DocumentTable, 0)
	fragments := make([]model.DocumentTableFragment, 0)
	cells := make([]model.DocumentTableCell, 0)
	combinedText := make([]string, 0, len(sheets))
	virtualTableID := int64(-1)
	for sheetIndex, sheet := range sheets {
		worksheet := parseXLSXWorksheetRich(entries[sheet.Path], sharedStrings, styles, sheet.Name)
		rows := worksheet.Rows
		if len(rows) == 0 {
			continue
		}
		text := rowsToText(rows)
		combinedText = append(combinedText, sheet.Name+"\n"+text)
		title := fmt.Sprintf("%s - %s", version.OriginName, sheet.Name)
		slices = append(slices, model.DocumentSlice{
			CaseFileID:  caseFile.ID,
			FileID:      caseFile.FileID,
			VersionNo:   version.VersionNo,
			SliceType:   model.DocumentStructureSection,
			SourceType:  profile.SourceType,
			Title:       title,
			TitleLevel:  2,
			PageStart:   sheetIndex + 1,
			PageEnd:     sheetIndex + 1,
			BBoxJSON:    json.RawMessage(fmt.Sprintf(`{"sheet":%q}`, sheet.Name)),
			RawText:     text,
			CleanText:   text,
			TableJSON:   mustJSON(rows),
			Confidence:  0.97,
			ParseStatus: model.DocumentParseStatusParsed,
			OCRPending:  false,
		})
		table, fragment, tableCells := buildRichStructuredTable(caseFile, version, profile, virtualTableID, title, rows, worksheet.Cells, sheetIndex+1, fmt.Sprintf(`{"sheet":%q}`, sheet.Name))
		tables = append(tables, table)
		fragments = append(fragments, fragment)
		cells = append(cells, tableCells...)
		virtualTableID--
	}
	if len(slices) == 0 {
		return buildScannedPageSlices(caseFile, version, profile), nil, nil, nil
	}
	slices = append([]model.DocumentSlice{{
		CaseFileID:  caseFile.ID,
		FileID:      caseFile.FileID,
		VersionNo:   version.VersionNo,
		SliceType:   model.DocumentStructureSection,
		SourceType:  profile.SourceType,
		Title:       version.OriginName,
		TitleLevel:  1,
		PageStart:   1,
		PageEnd:     len(sheets),
		BBoxJSON:    json.RawMessage(`{"x":0,"y":0,"w":1,"h":1}`),
		RawText:     strings.Join(combinedText, "\n\n"),
		CleanText:   strings.Join(combinedText, "\n\n"),
		TableJSON:   json.RawMessage(`null`),
		Confidence:  0.97,
		ParseStatus: model.DocumentParseStatusParsed,
		OCRPending:  false,
	}}, slices...)
	return slices, tables, fragments, cells
}

type xlsxSheet struct {
	Name string
	Path string
}

type xlsxWorksheetResult struct {
	Rows  [][]string
	Cells []structuredCell
}

type xlsxStyles struct {
	DateStyleIndexes map[int]bool
}

func parseXLSXSheets(workbookXML []byte, relsXML []byte) []xlsxSheet {
	relations := parseRelationships(relsXML)
	decoder := xml.NewDecoder(bytes.NewReader(workbookXML))
	sheets := make([]xlsxSheet, 0)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return sheets
		}
		element, ok := token.(xml.StartElement)
		if !ok || element.Name.Local != "sheet" {
			continue
		}
		name := attrValue(element, "name")
		relID := attrValue(element, "id")
		target := relations[relID]
		if name == "" || target == "" {
			continue
		}
		target = strings.TrimPrefix(target, "/")
		if !strings.HasPrefix(target, "xl/") {
			target = "xl/" + strings.TrimPrefix(target, "../")
		}
		sheets = append(sheets, xlsxSheet{Name: name, Path: target})
	}
	return sheets
}

func parseXLSXSharedStrings(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	values := make([]string, 0)
	var current strings.Builder
	inSI := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return values
		}
		switch element := token.(type) {
		case xml.StartElement:
			if element.Name.Local == "si" {
				inSI = true
				current.Reset()
			}
			if inSI && element.Name.Local == "t" {
				current.WriteString(readElementText(decoder))
			}
		case xml.EndElement:
			if element.Name.Local == "si" && inSI {
				values = append(values, current.String())
				inSI = false
			}
		}
	}
	return values
}

func parseXLSXStyles(raw []byte) xlsxStyles {
	styles := xlsxStyles{DateStyleIndexes: map[int]bool{}}
	if len(raw) == 0 {
		return styles
	}
	customDateFormats := map[int]bool{}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	inCellXfs := false
	cellStyleIndex := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return styles
		}
		switch element := token.(type) {
		case xml.StartElement:
			switch element.Name.Local {
			case "numFmt":
				numFmtID := parseOptionalInt(attrValue(element, "numFmtId"), -1)
				if numFmtID >= 0 && isLikelyXLSXDateFormat(attrValue(element, "formatCode")) {
					customDateFormats[numFmtID] = true
				}
			case "cellXfs":
				inCellXfs = true
				cellStyleIndex = 0
			case "xf":
				if !inCellXfs {
					continue
				}
				numFmtID := parseOptionalInt(attrValue(element, "numFmtId"), -1)
				if isBuiltinXLSXDateFormat(numFmtID) || customDateFormats[numFmtID] {
					styles.DateStyleIndexes[cellStyleIndex] = true
				}
				cellStyleIndex++
			}
		case xml.EndElement:
			if element.Name.Local == "cellXfs" {
				inCellXfs = false
			}
		}
	}
	return styles
}

func resolveXLSXCellValue(raw string, cellType string, styleIndex int, sharedStrings []string, styles xlsxStyles) string {
	value := strings.TrimSpace(raw)
	switch cellType {
	case "s":
		index, err := strconv.Atoi(value)
		if err == nil && index >= 0 && index < len(sharedStrings) {
			return sharedStrings[index]
		}
		return ""
	case "b":
		if value == "1" {
			return "TRUE"
		}
		if value == "0" {
			return "FALSE"
		}
	case "inlineStr", "str", "e":
		return value
	}
	if styles.DateStyleIndexes != nil && styles.DateStyleIndexes[styleIndex] {
		if formatted, ok := formatXLSXSerialDate(value); ok {
			return formatted
		}
	}
	return value
}

func formatXLSXSerialDate(raw string) (string, bool) {
	serial, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || serial <= 0 {
		return "", false
	}
	days := int(serial)
	fraction := serial - float64(days)
	date := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC).AddDate(0, 0, days)
	seconds := int(fraction*86400 + 0.5)
	if seconds <= 0 {
		return date.Format("2006-01-02"), true
	}
	date = date.Add(time.Duration(seconds) * time.Second)
	return date.Format("2006-01-02 15:04:05"), true
}

func isBuiltinXLSXDateFormat(numFmtID int) bool {
	switch numFmtID {
	case 14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47:
		return true
	default:
		return false
	}
}

func isLikelyXLSXDateFormat(formatCode string) bool {
	code := strings.ToLower(strings.TrimSpace(formatCode))
	if code == "" {
		return false
	}
	code = regexp.MustCompile(`"[^"]*"`).ReplaceAllString(code, "")
	code = regexp.MustCompile(`\\.`).ReplaceAllString(code, "")
	hasYear := strings.Contains(code, "yy") || strings.Contains(code, "年")
	hasDay := strings.Contains(code, "dd") || strings.Contains(code, "d") || strings.Contains(code, "日")
	hasMonth := strings.Contains(code, "mm") || strings.Contains(code, "m") || strings.Contains(code, "月")
	return hasYear && (hasMonth || hasDay)
}

func parseXLSXWorksheet(raw []byte, sharedStrings []string) [][]string {
	return parseXLSXWorksheetRich(raw, sharedStrings, xlsxStyles{}, "").Rows
}

func parseXLSXWorksheetRich(raw []byte, sharedStrings []string, styles xlsxStyles, sheetName string) xlsxWorksheetResult {
	if len(raw) == 0 {
		return xlsxWorksheetResult{}
	}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	rowsByIndex := map[int]map[int]string{}
	cellsByCoord := map[string]*structuredCell{}
	hiddenRows := map[int]bool{}
	hiddenCols := map[int]bool{}
	mergeRanges := make([]string, 0)
	currentCellRef := ""
	currentCellType := ""
	currentCellStyleIndex := -1
	currentFormula := ""
	currentValue := ""
	currentDisplayValue := ""
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		switch element := token.(type) {
		case xml.StartElement:
			switch element.Name.Local {
			case "row":
				if isXMLBoolTrue(attrValue(element, "hidden")) {
					rowNo, _ := strconv.Atoi(strings.TrimSpace(attrValue(element, "r")))
					if rowNo > 0 {
						hiddenRows[rowNo-1] = true
					}
				}
			case "col":
				if isXMLBoolTrue(attrValue(element, "hidden")) {
					minCol, _ := strconv.Atoi(strings.TrimSpace(attrValue(element, "min")))
					maxCol, _ := strconv.Atoi(strings.TrimSpace(attrValue(element, "max")))
					for col := max(1, minCol); col <= max(1, maxCol); col++ {
						hiddenCols[col-1] = true
					}
				}
			case "mergeCell":
				if ref := strings.TrimSpace(attrValue(element, "ref")); ref != "" {
					mergeRanges = append(mergeRanges, ref)
				}
			case "c":
				currentCellRef = attrValue(element, "r")
				currentCellType = attrValue(element, "t")
				currentCellStyleIndex = parseOptionalInt(attrValue(element, "s"), -1)
				currentFormula = ""
				currentValue = ""
				currentDisplayValue = ""
			case "f":
				if currentCellRef == "" {
					continue
				}
				currentFormula = strings.TrimSpace(readElementText(decoder))
			case "v", "t":
				if currentCellRef == "" {
					continue
				}
				value := resolveXLSXCellValue(readElementText(decoder), currentCellType, currentCellStyleIndex, sharedStrings, styles)
				if element.Name.Local == "t" && currentCellType == "inlineStr" {
					currentValue += value
				} else {
					currentValue = value
				}
				currentDisplayValue = strings.TrimSpace(currentValue)
			}
		case xml.EndElement:
			if element.Name.Local == "c" {
				rowIndex, colIndex := parseCellRef(currentCellRef)
				if rowIndex >= 0 && colIndex >= 0 && !hiddenRows[rowIndex] && !hiddenCols[colIndex] {
					if rowsByIndex[rowIndex] == nil {
						rowsByIndex[rowIndex] = map[int]string{}
					}
					displayValue := strings.TrimSpace(currentDisplayValue)
					if displayValue == "" {
						displayValue = strings.TrimSpace(currentValue)
					}
					rowsByIndex[rowIndex][colIndex] = displayValue
					cellCopy := structuredCell{
						RowIndex:     rowIndex,
						ColIndex:     colIndex,
						RowSpan:      1,
						ColSpan:      1,
						RawText:      strings.TrimSpace(currentValue),
						DisplayValue: displayValue,
						Formula:      strings.TrimSpace(currentFormula),
						SourceRef:    formatXLSXSourceRef(sheetName, rowIndex, colIndex),
					}
					cellsByCoord[currentCellRef] = &cellCopy
				}
				currentCellRef = ""
				currentCellType = ""
				currentCellStyleIndex = -1
				currentFormula = ""
				currentValue = ""
				currentDisplayValue = ""
			}
		}
	}
	applyXLSXMergeSpans(cellsByCoord, mergeRanges)
	return xlsxWorksheetResult{
		Rows:  compactRows(rowsByIndex),
		Cells: flattenStructuredCells(cellsByCoord),
	}
}

func buildStructuredTable(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, virtualTableID int64, title string, rows [][]string, pageNo int, bbox string, refPrefix string) (model.DocumentTable, model.DocumentTableFragment, []model.DocumentTableCell) {
	rows = normalizeRows(rows)
	virtualFragmentID := virtualTableID * 1000
	table := model.DocumentTable{
		ID:             virtualTableID,
		CaseFileID:     caseFile.ID,
		FileID:         caseFile.FileID,
		VersionNo:      version.VersionNo,
		Title:          title,
		PageStart:      max(1, pageNo),
		PageEnd:        max(1, pageNo),
		HeaderRowCount: inferHeaderRowCount(rows),
		ColumnCount:    maxRowWidth(rows),
		SourceType:     profile.SourceType,
		ParseStatus:    model.DocumentParseStatusParsed,
		IsCrossPage:    false,
		BBoxJSON:       json.RawMessage(bbox),
	}
	fragment := model.DocumentTableFragment{
		ID:            virtualFragmentID,
		TableID:       virtualTableID,
		CaseFileID:    caseFile.ID,
		PageNo:        max(1, pageNo),
		RowStart:      0,
		RowEnd:        max(0, len(rows)-1),
		FragmentOrder: 1,
		BBoxJSON:      json.RawMessage(bbox),
	}
	cells := make([]model.DocumentTableCell, 0)
	for rowIndex, row := range rows {
		for colIndex, value := range row {
			if strings.TrimSpace(value) == "" {
				continue
			}
			cells = append(cells, model.DocumentTableCell{
				TableID:         virtualTableID,
				FragmentID:      virtualFragmentID,
				CaseFileID:      caseFile.ID,
				RowIndex:        rowIndex,
				ColIndex:        colIndex,
				RowSpan:         1,
				ColSpan:         1,
				RawText:         value,
				NormalizedValue: strings.TrimSpace(value),
				BBoxJSON:        json.RawMessage(fmt.Sprintf(`{"ref":%q}`, cellRef(refPrefix, rowIndex, colIndex))),
				Confidence:      0.97,
			})
		}
	}
	return table, fragment, cells
}

func buildRichStructuredTable(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, virtualTableID int64, title string, rows [][]string, richCells []structuredCell, pageNo int, bbox string) (model.DocumentTable, model.DocumentTableFragment, []model.DocumentTableCell) {
	rows = normalizeRows(rows)
	virtualFragmentID := virtualTableID * 1000
	table := model.DocumentTable{
		ID:             virtualTableID,
		CaseFileID:     caseFile.ID,
		FileID:         caseFile.FileID,
		VersionNo:      version.VersionNo,
		Title:          title,
		PageStart:      max(1, pageNo),
		PageEnd:        max(1, pageNo),
		HeaderRowCount: inferHeaderRowCount(rows),
		ColumnCount:    maxRowWidth(rows),
		SourceType:     profile.SourceType,
		ParseStatus:    model.DocumentParseStatusParsed,
		IsCrossPage:    false,
		BBoxJSON:       json.RawMessage(bbox),
	}
	fragment := model.DocumentTableFragment{
		ID:            virtualFragmentID,
		TableID:       virtualTableID,
		CaseFileID:    caseFile.ID,
		PageNo:        max(1, pageNo),
		RowStart:      0,
		RowEnd:        max(0, len(rows)-1),
		FragmentOrder: 1,
		BBoxJSON:      json.RawMessage(bbox),
	}
	cells := make([]model.DocumentTableCell, 0, len(richCells))
	for _, richCell := range richCells {
		value := strings.TrimSpace(richCell.DisplayValue)
		if value == "" {
			value = strings.TrimSpace(richCell.RawText)
		}
		if value == "" && strings.TrimSpace(richCell.Formula) == "" {
			continue
		}
		sourceRef := strings.TrimSpace(richCell.SourceRef)
		if sourceRef == "" {
			sourceRef = fmt.Sprintf("%s!%s%d", title, excelColumnName(richCell.ColIndex), richCell.RowIndex+1)
		}
		cells = append(cells, model.DocumentTableCell{
			TableID:         virtualTableID,
			FragmentID:      virtualFragmentID,
			CaseFileID:      caseFile.ID,
			RowIndex:        richCell.RowIndex,
			ColIndex:        richCell.ColIndex,
			RowSpan:         max(1, richCell.RowSpan),
			ColSpan:         max(1, richCell.ColSpan),
			RawText:         strings.TrimSpace(richCell.RawText),
			NormalizedValue: value,
			BBoxJSON: mustJSON(map[string]any{
				"ref":          sourceRef,
				"formula":      strings.TrimSpace(richCell.Formula),
				"displayValue": value,
				"rowSpan":      max(1, richCell.RowSpan),
				"colSpan":      max(1, richCell.ColSpan),
			}),
			Confidence: 0.98,
		})
	}
	return table, fragment, cells
}

func buildDetectedPDFTable(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, virtualTableID int64, title string, detectedTable pdfDetectedTable, pageNo int, bbox string) (model.DocumentTable, model.DocumentTableFragment, []model.DocumentTableCell) {
	rows := normalizeRows(detectedTable.Rows)
	virtualFragmentID := virtualTableID * 1000
	table := model.DocumentTable{
		ID:             virtualTableID,
		CaseFileID:     caseFile.ID,
		FileID:         caseFile.FileID,
		VersionNo:      version.VersionNo,
		Title:          title,
		PageStart:      max(1, pageNo),
		PageEnd:        max(1, pageNo),
		HeaderRowCount: inferHeaderRowCount(rows),
		ColumnCount:    maxRowWidth(rows),
		SourceType:     profile.SourceType,
		ParseStatus:    model.DocumentParseStatusParsed,
		IsCrossPage:    false,
		BBoxJSON:       json.RawMessage(bbox),
	}
	fragment := model.DocumentTableFragment{
		ID:            virtualFragmentID,
		TableID:       virtualTableID,
		CaseFileID:    caseFile.ID,
		PageNo:        max(1, pageNo),
		RowStart:      0,
		RowEnd:        max(0, len(rows)-1),
		FragmentOrder: 1,
		BBoxJSON:      json.RawMessage(bbox),
	}
	cells := make([]model.DocumentTableCell, 0)
	if len(detectedTable.Cells) > 0 {
		for _, detectedCell := range detectedTable.Cells {
			text := strings.TrimSpace(detectedCell.Text)
			if text == "" {
				continue
			}
			cells = append(cells, model.DocumentTableCell{
				TableID:         virtualTableID,
				FragmentID:      virtualFragmentID,
				CaseFileID:      caseFile.ID,
				RowIndex:        detectedCell.RowIndex,
				ColIndex:        detectedCell.ColIndex,
				RowSpan:         1,
				ColSpan:         1,
				RawText:         text,
				NormalizedValue: text,
				BBoxJSON: mustJSON(map[string]any{
					"page":  pageNo,
					"block": detectedTable.BlockIndex,
					"bbox":  detectedCell.BBox,
					"ref":   fmt.Sprintf("第%d页/块%d/单元格R%dC%d", pageNo, detectedTable.BlockIndex, detectedCell.RowIndex+1, detectedCell.ColIndex+1),
				}),
				Confidence: 0.99,
			})
		}
		return table, fragment, cells
	}
	return buildStructuredTable(caseFile, version, profile, virtualTableID, title, rows, pageNo, bbox, fmt.Sprintf("PDF#p%d#b%d", pageNo, detectedTable.BlockIndex))
}

func findTableTitleFromPageBlocks(blocks []pdfLayoutBlock, blockIndex int, tableIndex int, version model.FileVersionDTO, pageNo int) string {
	for _, block := range blocks {
		if block.Index != blockIndex {
			continue
		}
		text := normalizeText(block.Text)
		if text == "" {
			break
		}
		lines := strings.Split(text, "\n")
		for _, line := range lines {
			line = normalizeText(line)
			if regexp.MustCompile(`^表\d+[：:].+`).MatchString(line) {
				return line
			}
		}
	}
	return fmt.Sprintf("%s - 第%d页候选表格%d", version.OriginName, pageNo, tableIndex)
}

func detectDocumentType(version model.FileVersionDTO, raw []byte) string {
	mimeType := strings.ToLower(strings.TrimSpace(version.MimeType))
	name := strings.ToLower(strings.TrimSpace(version.OriginName))
	declaredType := ""
	switch {
	case strings.Contains(mimeType, "application/pdf") || strings.HasSuffix(name, ".pdf"):
		declaredType = "pdf"
	case strings.HasPrefix(mimeType, "image/") || strings.HasSuffix(name, ".png") || strings.HasSuffix(name, ".jpg") || strings.HasSuffix(name, ".jpeg"):
		declaredType = "image"
	case strings.Contains(mimeType, "text/csv") || strings.HasSuffix(name, ".csv"):
		declaredType = "csv"
	case strings.Contains(mimeType, "tab-separated-values") || strings.HasSuffix(name, ".tsv"):
		declaredType = "tsv"
	case strings.Contains(mimeType, "wordprocessingml.document") || strings.HasSuffix(name, ".docx"):
		declaredType = "docx"
	case strings.Contains(mimeType, "spreadsheetml.sheet") || strings.HasSuffix(name, ".xlsx"):
		declaredType = "xlsx"
	case strings.Contains(mimeType, "application/json") || strings.HasSuffix(name, ".json"):
		declaredType = "json"
	case strings.HasPrefix(mimeType, "text/") || strings.HasSuffix(name, ".txt") || strings.HasSuffix(name, ".md"):
		declaredType = "text"
	}

	if declaredType != "" {
		switch declaredType {
		case "text", "json", "csv", "tsv":
			if !isLikelyBinaryPayload(raw) {
				return declaredType
			}
		default:
			return declaredType
		}
	}

	if bytes.HasPrefix(raw, []byte("%PDF-")) {
		return "pdf"
	}
	if isOLECompoundDocument(raw) {
		return "xls"
	}
	if looksLikeXLSXPayload(raw) {
		return "xlsx"
	}
	if looksLikeDOCXPayload(raw) {
		return "docx"
	}
	if looksLikePlainTextPayload(raw) {
		return "text"
	}
	return "binary"
}

func isOLECompoundDocument(raw []byte) bool {
	if len(raw) < 8 {
		return false
	}
	return bytes.Equal(raw[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1})
}

func looksLikeXLSXPayload(raw []byte) bool {
	if len(raw) < 4 || !bytes.HasPrefix(raw, []byte("PK\x03\x04")) {
		return false
	}
	return len(readZipEntry(raw, "xl/workbook.xml")) > 0
}

func looksLikeDOCXPayload(raw []byte) bool {
	if len(raw) < 4 || !bytes.HasPrefix(raw, []byte("PK\x03\x04")) {
		return false
	}
	return len(readZipEntry(raw, "word/document.xml")) > 0
}

func looksLikePlainTextPayload(raw []byte) bool {
	if len(raw) == 0 || isLikelyBinaryPayload(raw) {
		return false
	}
	sample := raw
	if len(sample) > 4096 {
		sample = sample[:4096]
	}
	text := strings.TrimSpace(string(sample))
	if text == "" {
		return false
	}
	return !containsArchiveHeaderArtifacts(text)
}

func decodePlainTextPayload(raw []byte) string {
	if !looksLikePlainTextPayload(raw) {
		return ""
	}
	return normalizeText(string(raw))
}

func isLikelyBinaryPayload(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	if bytes.HasPrefix(raw, []byte("PK\x03\x04")) || bytes.HasPrefix(raw, []byte("%PDF-")) || isOLECompoundDocument(raw) {
		return true
	}
	sample := raw
	if len(sample) > 8192 {
		sample = sample[:8192]
	}
	if bytes.Contains(sample, []byte("PK\x03\x04")) ||
		bytes.Contains(sample, []byte("[Content_Types].xml")) ||
		bytes.Contains(sample, []byte("_rels/.rels")) ||
		bytes.Contains(sample, []byte("xl/workbook.xml")) ||
		bytes.Contains(sample, []byte("word/document.xml")) {
		return true
	}
	invalidUTF8Bytes := 0
	for index := 0; index < len(sample); {
		value, size := utf8.DecodeRune(sample[index:])
		if value == utf8.RuneError && size == 1 {
			invalidUTF8Bytes++
		}
		index += size
	}
	if len(sample) > 0 && invalidUTF8Bytes*100/len(sample) >= 10 {
		return true
	}
	controlCount := 0
	visibleCount := 0
	nullByteSeen := false
	for _, value := range sample {
		if value == 0 {
			nullByteSeen = true
			continue
		}
		if value == '\n' || value == '\r' || value == '\t' {
			continue
		}
		visibleCount++
		if value < 32 {
			controlCount++
		}
	}
	if nullByteSeen {
		return true
	}
	if visibleCount == 0 {
		return false
	}
	return controlCount*100/visibleCount >= 10
}

func containsArchiveHeaderArtifacts(text string) bool {
	value := strings.TrimSpace(text)
	if value == "" {
		return false
	}
	for _, marker := range []string{
		"PK\x03\x04",
		"[Content_Types].xml",
		"_rels/.rels",
		"xl/workbook.xml",
		"word/document.xml",
		"docProps/app.xml",
		"docProps/core.xml",
	} {
		if strings.Contains(value, marker) {
			return true
		}
	}
	if strings.Contains(value, "PK") && (strings.Contains(value, "_rels/.rels") || strings.Contains(value, "xl/workbook.xml") || strings.Contains(value, "word/document.xml")) {
		return true
	}
	return false
}

func detectPDFPageCount(raw []byte) int {
	pageCount := len(extractPDFTextResult(raw).Pages)
	if pageCount <= 0 {
		pageCount = len(regexp.MustCompile(`/Type\s*/Page([^s]|$)`).FindAll(raw, -1))
	}
	if pageCount <= 0 {
		return 1
	}
	return pageCount
}

func extractPDFText(raw []byte) string {
	pages := extractPDFTextResult(raw).Pages
	if len(pages) > 0 {
		return joinPDFPageTexts(pages)
	}
	streamPattern := regexp.MustCompile(`(?s)(<<.*?>>)\s*stream\r?\n(.*?)\r?\nendstream`)
	textParts := make([]string, 0)
	for _, match := range streamPattern.FindAllSubmatch(raw, -1) {
		if len(match) < 3 {
			continue
		}
		dict := string(match[1])
		body := match[2]
		if strings.Contains(dict, "/FlateDecode") {
			inflated, err := inflatePDFStream(body)
			if err == nil {
				body = inflated
			}
		}
		part, _, _ := extractTextOperators(string(body), nil)
		if strings.TrimSpace(part) != "" {
			textParts = append(textParts, part)
		}
	}
	return normalizeText(strings.Join(textParts, "\n"))
}

type pdfObject struct {
	ID      string
	Body    []byte
	Dict    string
	Streams [][]byte
}

type pdfFontMap struct {
	ToUnicode   map[string]string
	CodeLengths []int
	Encoding    string
	BaseFont    string
}

type pyMuPDFPayload struct {
	PageCount int           `json:"page_count"`
	HasText   bool          `json:"has_text"`
	Pages     []pyMuPDFPage `json:"pages"`
	Errors    []string      `json:"errors"`
}

type pyMuPDFPage struct {
	PageNo int            `json:"page_no"`
	Width  float64        `json:"width"`
	Height float64        `json:"height"`
	Text   string         `json:"text"`
	Blocks []pyMuPDFBlock `json:"blocks"`
	Tables []pyMuPDFTable `json:"tables"`
}

type pyMuPDFBlock struct {
	BBox  []float64     `json:"bbox"`
	Lines []pyMuPDFLine `json:"lines"`
}

type pyMuPDFLine struct {
	BBox  []float64     `json:"bbox"`
	Text  string        `json:"text"`
	Words []pyMuPDFWord `json:"words"`
}

type pyMuPDFWord struct {
	Text string    `json:"text"`
	BBox []float64 `json:"bbox"`
}

type pyMuPDFTable struct {
	BBox  []float64          `json:"bbox"`
	Rows  [][]string         `json:"rows"`
	Cells []pyMuPDFTableCell `json:"cells"`
}

type pyMuPDFTableCell struct {
	RowIndex int       `json:"row_index"`
	ColIndex int       `json:"col_index"`
	Text     string    `json:"text"`
	BBox     []float64 `json:"bbox"`
}

func extractPDFTextResultWithMuPDF(raw []byte) (pdfExtractionResult, error) {
	if _, err := exec.LookPath("mutool"); err != nil {
		return pdfExtractionResult{}, fmt.Errorf("mutool not available: %w", err)
	}
	pdfPath, cleanup, err := writeTempPDF(raw)
	if err != nil {
		return pdfExtractionResult{}, err
	}
	defer cleanup()

	textOutput, textErr := runMuPDFCommand("txt", "draw", "-F", "txt", pdfPath)
	structuredOutput, structuredErr := runMuPDFCommand("stext", "draw", "-F", "stext", pdfPath)
	if textErr != nil && structuredErr != nil {
		return pdfExtractionResult{}, fmt.Errorf("mupdf txt failed: %v; stext failed: %v", textErr, structuredErr)
	}

	pages := splitMuPDFPageTexts(textOutput)
	layoutPages, parseErr := parseMuPDFStructuredText(structuredOutput)
	if parseErr != nil && pdfDebugEnabled() {
		log.Printf("pdf-mupdf-stext-parse error=%q", parseErr.Error())
	}
	pageIndex := map[int]int{}
	for index, page := range pages {
		pageIndex[page.PageNo] = index
	}
	for _, page := range layoutPages {
		index, ok := pageIndex[page.PageNo]
		if ok {
			if strings.TrimSpace(page.Text) != "" {
				pages[index].Text = page.Text
			} else if strings.TrimSpace(pages[index].Text) == "" {
				pages[index].Text = page.Text
			}
			pages[index].Width = page.Width
			pages[index].Height = page.Height
			pages[index].Blocks = page.Blocks
			continue
		}
		pages = append(pages, page)
	}
	sort.Slice(pages, func(i, j int) bool {
		return pages[i].PageNo < pages[j].PageNo
	})

	text := strings.TrimSpace(joinPDFPageTexts(pages))
	pageDiagnostics := make([]pdfPageDiagnostic, 0, len(pages))
	for _, page := range pages {
		pageDiagnostics = append(pageDiagnostics, pdfPageDiagnostic{
			PageNo:           page.PageNo,
			ContentsCount:    len(page.Blocks),
			HasTextOperators: strings.TrimSpace(page.Text) != "",
			UsedToUnicode:    false,
			DecodeFailed:     false,
			DoCount:          len(page.Blocks),
			CharCount:        len([]rune(strings.TrimSpace(page.Text))),
		})
	}
	result := pdfExtractionResult{
		Pages:            pages,
		DecodeMode:       "pdf_mupdf_text",
		DecodeFailed:     false,
		HasTextOperators: text != "",
		Diagnostics: pdfDiagnostics{
			Extractor:        pdfExtractorMuPDF,
			PageCount:        len(pages),
			DecodeMode:       "pdf_mupdf_text",
			DecodeFailed:     false,
			HasTextOperators: text != "",
			Pages:            pageDiagnostics,
		},
	}
	if textErr != nil {
		result.Diagnostics.Errors = append(result.Diagnostics.Errors, "txt: "+textErr.Error())
	}
	if structuredErr != nil {
		result.Diagnostics.Errors = append(result.Diagnostics.Errors, "stext: "+structuredErr.Error())
	}
	if text == "" {
		result.DecodeMode = "pdf_mupdf_empty"
		result.Diagnostics.DecodeMode = "pdf_mupdf_empty"
	}
	return result, nil
}

func extractPDFTextResultWithPyMuPDF(raw []byte) (pdfExtractionResult, error) {
	if _, err := exec.LookPath("python3"); err != nil {
		return pdfExtractionResult{}, fmt.Errorf("python3 not available: %w", err)
	}
	scriptPath, err := resolvePyMuPDFScriptPath()
	if err != nil {
		return pdfExtractionResult{}, err
	}
	pdfPath, cleanup, err := writeTempPDF(raw)
	if err != nil {
		return pdfExtractionResult{}, err
	}
	defer cleanup()

	output, err := runPyMuPDFCommand(scriptPath, pdfPath)
	if err != nil {
		return pdfExtractionResult{}, err
	}
	var payload pyMuPDFPayload
	if err := json.Unmarshal([]byte(output), &payload); err != nil {
		return pdfExtractionResult{}, fmt.Errorf("pymupdf output parse failed: %w", err)
	}
	pages := normalizePyMuPDFPages(payload.Pages)
	text := strings.TrimSpace(joinPDFPageTexts(pages))
	pageDiagnostics := make([]pdfPageDiagnostic, 0, len(pages))
	totalTables := 0
	for _, page := range pages {
		totalTables += len(page.Tables)
		pageDiagnostics = append(pageDiagnostics, pdfPageDiagnostic{
			PageNo:           page.PageNo,
			ContentsCount:    len(page.Blocks),
			HasTextOperators: strings.TrimSpace(page.Text) != "",
			UsedToUnicode:    false,
			DecodeFailed:     false,
			DoCount:          len(page.Tables),
			CharCount:        len([]rune(strings.TrimSpace(page.Text))),
		})
	}
	result := pdfExtractionResult{
		Pages:            pages,
		DecodeMode:       "pdf_pymupdf_text",
		DecodeFailed:     false,
		HasTextOperators: payload.HasText || text != "",
		Diagnostics: pdfDiagnostics{
			Extractor:        pdfExtractorPyMuPDF,
			TableDetector:    "find_tables",
			PageCount:        max(len(pages), payload.PageCount),
			DecodeMode:       "pdf_pymupdf_text",
			DecodeFailed:     false,
			HasTextOperators: payload.HasText || text != "",
			Errors:           payload.Errors,
			Pages:            pageDiagnostics,
		},
	}
	if strings.TrimSpace(text) == "" {
		result.DecodeMode = "pdf_pymupdf_empty"
		result.Diagnostics.DecodeMode = "pdf_pymupdf_empty"
	}
	if totalTables == 0 {
		result.Diagnostics.TableDetector = "aligned_text_fallback"
	}
	return result, nil
}

func resolvePyMuPDFScriptPath() (string, error) {
	candidates := []string{
		filepath.Join("scripts", "pdf_extract_pymupdf.py"),
		filepath.Join("server", "scripts", "pdf_extract_pymupdf.py"),
		filepath.Join(filepath.Dir(os.Args[0]), "scripts", "pdf_extract_pymupdf.py"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("pymupdf script not found")
}

func runPyMuPDFCommand(scriptPath string, pdfPath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), pdfMuPDFTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "python3", scriptPath, pdfPath)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("pymupdf timeout after %s", pdfMuPDFTimeout)
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("pymupdf %s", message)
	}
	return stdout.String(), nil
}

func normalizePyMuPDFPages(rawPages []pyMuPDFPage) []pdfPageText {
	pages := make([]pdfPageText, 0, len(rawPages))
	for _, rawPage := range rawPages {
		page := pdfPageText{
			PageNo: rawPage.PageNo,
			Text:   normalizeText(rawPage.Text),
			Width:  rawPage.Width,
			Height: rawPage.Height,
			Blocks: make([]pdfLayoutBlock, 0, len(rawPage.Blocks)),
			Tables: make([]pdfDetectedTable, 0, len(rawPage.Tables)),
		}
		for blockIndex, rawBlock := range rawPage.Blocks {
			block := pdfLayoutBlock{
				Index: blockIndex + 1,
				BBox:  bboxFromArray(rawBlock.BBox),
				Lines: make([]pdfLayoutLine, 0, len(rawBlock.Lines)),
			}
			for lineIndex, rawLine := range rawBlock.Lines {
				line := pdfLayoutLine{
					Index: lineIndex + 1,
					Text:  normalizeText(rawLine.Text),
					BBox:  bboxFromArray(rawLine.BBox),
					Words: make([]pdfLayoutWord, 0, len(rawLine.Words)),
				}
				for _, rawWord := range rawLine.Words {
					text := normalizeText(rawWord.Text)
					if text == "" {
						continue
					}
					line.Words = append(line.Words, pdfLayoutWord{
						Text: text,
						BBox: bboxFromArray(rawWord.BBox),
					})
				}
				if line.Text == "" {
					line.Text = joinPDFLayoutWords(line.Words)
				}
				if line.Text != "" {
					block.Lines = append(block.Lines, line)
				}
			}
			if len(block.Lines) > 0 {
				parts := make([]string, 0, len(block.Lines))
				for _, line := range block.Lines {
					parts = append(parts, line.Text)
				}
				block.Text = normalizeText(strings.Join(parts, "\n"))
				page.Blocks = append(page.Blocks, block)
			}
		}
		for tableIndex, rawTable := range rawPage.Tables {
			rows := normalizeRows(rawTable.Rows)
			table := pdfDetectedTable{
				Index:    tableIndex + 1,
				BBox:     bboxFromArray(rawTable.BBox),
				Rows:     rows,
				Cells:    make([]pdfDetectedCell, 0, len(rawTable.Cells)),
				Detector: "find_tables",
			}
			for _, rawCell := range rawTable.Cells {
				table.Cells = append(table.Cells, pdfDetectedCell{
					RowIndex: rawCell.RowIndex,
					ColIndex: rawCell.ColIndex,
					Text:     strings.TrimSpace(rawCell.Text),
					BBox:     bboxFromArray(rawCell.BBox),
				})
			}
			table.BlockIndex = findClosestBlockIndex(page.Blocks, table.BBox)
			page.Tables = append(page.Tables, table)
		}
		pages = append(pages, page)
	}
	sort.Slice(pages, func(i, j int) bool { return pages[i].PageNo < pages[j].PageNo })
	return pages
}

func bboxFromArray(values []float64) pdfLayoutBBox {
	if len(values) != 4 {
		return pdfLayoutBBox{}
	}
	return pdfLayoutBBox{XMin: values[0], YMin: values[1], XMax: values[2], YMax: values[3]}
}

func findClosestBlockIndex(blocks []pdfLayoutBlock, target pdfLayoutBBox) int {
	bestIndex := 0
	bestScore := 0.0
	for _, block := range blocks {
		score := bboxIntersectionArea(block.BBox, target)
		if score > bestScore {
			bestScore = score
			bestIndex = block.Index
		}
	}
	if bestIndex > 0 {
		return bestIndex
	}
	for _, block := range blocks {
		if bboxContains(block.BBox, target) || bboxContains(target, block.BBox) {
			return block.Index
		}
	}
	if len(blocks) > 0 {
		return blocks[0].Index
	}
	return 0
}

func bboxIntersectionArea(left pdfLayoutBBox, right pdfLayoutBBox) float64 {
	x1 := maxFloat(left.XMin, right.XMin)
	y1 := maxFloat(left.YMin, right.YMin)
	x2 := minFloat(left.XMax, right.XMax)
	y2 := minFloat(left.YMax, right.YMax)
	if x2 <= x1 || y2 <= y1 {
		return 0
	}
	return (x2 - x1) * (y2 - y1)
}

func bboxContains(container pdfLayoutBBox, target pdfLayoutBBox) bool {
	if container == (pdfLayoutBBox{}) || target == (pdfLayoutBBox{}) {
		return false
	}
	return target.XMin >= container.XMin && target.YMin >= container.YMin &&
		target.XMax <= container.XMax && target.YMax <= container.YMax
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func minFloat(left float64, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func writeTempPDF(raw []byte) (string, func(), error) {
	file, err := os.CreateTemp("", "sxfg-report-*.pdf")
	if err != nil {
		return "", nil, err
	}
	if _, err := file.Write(raw); err != nil {
		file.Close()
		os.Remove(file.Name())
		return "", nil, err
	}
	if err := file.Close(); err != nil {
		os.Remove(file.Name())
		return "", nil, err
	}
	return file.Name(), func() {
		_ = os.Remove(file.Name())
	}, nil
}

func runMuPDFCommand(label string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), pdfMuPDFTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "mutool", args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("%s timeout after %s", label, pdfMuPDFTimeout)
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("%s %s", label, message)
	}
	return stdout.String(), nil
}

func splitMuPDFPageTexts(raw string) []pdfPageText {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	parts := strings.Split(raw, "\f")
	pages := make([]pdfPageText, 0, len(parts))
	pageNo := 1
	for _, part := range parts {
		text := normalizeText(part)
		if text == "" && pageNo > len(parts)-1 {
			continue
		}
		pages = append(pages, pdfPageText{
			PageNo: pageNo,
			Text:   text,
		})
		pageNo++
	}
	return pages
}

func parseMuPDFStructuredText(raw string) ([]pdfPageText, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoder := xml.NewDecoder(strings.NewReader(raw))
	pages := make([]pdfPageText, 0)
	var currentPage *pdfPageText
	var currentBlock *pdfLayoutBlock
	var currentLine *pdfLayoutLine
	inChar := false
	pageNo := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "page":
				pageNo++
				width, height := parseMuPDFPageSize(value)
				page := pdfPageText{
					PageNo: pageNo,
					Width:  width,
					Height: height,
					Blocks: make([]pdfLayoutBlock, 0),
				}
				pages = append(pages, page)
				currentPage = &pages[len(pages)-1]
				currentBlock = nil
				currentLine = nil
			case "block":
				if currentPage == nil {
					continue
				}
				blockType := xmlAttrValue(value.Attr, "type")
				if blockType != "" && blockType != "text" {
					currentBlock = nil
					currentLine = nil
					continue
				}
				block := pdfLayoutBlock{
					Index: len(currentPage.Blocks) + 1,
					BBox:  parseMuPDFBBox(value.Attr),
					Lines: make([]pdfLayoutLine, 0),
				}
				currentPage.Blocks = append(currentPage.Blocks, block)
				currentBlock = &currentPage.Blocks[len(currentPage.Blocks)-1]
				currentLine = nil
			case "line":
				if currentBlock == nil {
					continue
				}
				line := pdfLayoutLine{
					Index: len(currentBlock.Lines) + 1,
					BBox:  parseMuPDFBBox(value.Attr),
					Words: make([]pdfLayoutWord, 0),
				}
				currentBlock.Lines = append(currentBlock.Lines, line)
				currentLine = &currentBlock.Lines[len(currentBlock.Lines)-1]
			case "char":
				if currentLine == nil {
					continue
				}
				inChar = true
				text := xmlAttrValue(value.Attr, "c")
				if text == "" {
					text = xmlAttrValue(value.Attr, "ucs")
				}
				if text != "" {
					currentLine.Text += text
				}
			case "text", "span":
				if currentLine == nil {
					continue
				}
				text := strings.TrimSpace(readElementText(decoder))
				if text != "" {
					currentLine.Text += text
				}
			}
		case xml.CharData:
			if inChar && currentLine != nil {
				currentLine.Text += string(value)
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "char":
				inChar = false
			case "line":
				if currentLine != nil {
					currentLine.Text = normalizeText(currentLine.Text)
				}
				currentLine = nil
			case "block":
				if currentBlock != nil {
					lines := make([]string, 0, len(currentBlock.Lines))
					for _, line := range currentBlock.Lines {
						if strings.TrimSpace(line.Text) != "" {
							lines = append(lines, strings.TrimSpace(line.Text))
						}
					}
					currentBlock.Text = normalizeText(strings.Join(lines, "\n"))
				}
				currentBlock = nil
			case "page":
				if currentPage != nil {
					parts := make([]string, 0, len(currentPage.Blocks))
					skipFigureRegion := false
					for _, block := range currentPage.Blocks {
						if isPDFNoiseBlock(block) {
							continue
						}
						if skipFigureRegion {
							if isLikelyFigureContentBlock(block, block.Text) {
								continue
							}
							if isNarrativePDFBlock(block.Text) || isLikelyTitle(block.Text) {
								skipFigureRegion = false
							}
						}
						if isLikelyFigureAnchorBlock(block.Text) {
							skipFigureRegion = true
						}
						if strings.TrimSpace(block.Text) != "" {
							parts = append(parts, block.Text)
						}
					}
					currentPage.Text = normalizeText(strings.Join(parts, "\n\n"))
				}
				currentPage = nil
			}
		}
	}
	return pages, nil
}

func parseXMLFloatAttr(attrs []xml.Attr, name string) float64 {
	for _, attr := range attrs {
		if attr.Name.Local != name {
			continue
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(attr.Value), 64)
		if err == nil {
			return value
		}
	}
	return 0
}

func xmlAttrValue(attrs []xml.Attr, name string) string {
	for _, attr := range attrs {
		if attr.Name.Local == name {
			return strings.TrimSpace(attr.Value)
		}
	}
	return ""
}

func parseXMLBBox(attrs []xml.Attr) pdfLayoutBBox {
	return pdfLayoutBBox{
		XMin: parseXMLFloatAttr(attrs, "xMin"),
		YMin: parseXMLFloatAttr(attrs, "yMin"),
		XMax: parseXMLFloatAttr(attrs, "xMax"),
		YMax: parseXMLFloatAttr(attrs, "yMax"),
	}
}

func parseMuPDFBBox(attrs []xml.Attr) pdfLayoutBBox {
	if bbox := parseBBoxString(xmlAttrValue(attrs, "bbox")); bbox != (pdfLayoutBBox{}) {
		return bbox
	}
	return parseXMLBBox(attrs)
}

func parseMuPDFPageSize(element xml.StartElement) (float64, float64) {
	if width := parseXMLFloatAttr(element.Attr, "width"); width > 0 {
		return width, parseXMLFloatAttr(element.Attr, "height")
	}
	if mediabox := parseBBoxString(xmlAttrValue(element.Attr, "mediabox")); mediabox != (pdfLayoutBBox{}) {
		return mediabox.XMax - mediabox.XMin, mediabox.YMax - mediabox.YMin
	}
	if bbox := parseBBoxString(xmlAttrValue(element.Attr, "bbox")); bbox != (pdfLayoutBBox{}) {
		return bbox.XMax - bbox.XMin, bbox.YMax - bbox.YMin
	}
	return 0, 0
}

func parseBBoxString(raw string) pdfLayoutBBox {
	fields := strings.Fields(strings.TrimSpace(raw))
	if len(fields) != 4 {
		return pdfLayoutBBox{}
	}
	values := [4]float64{}
	for index, field := range fields {
		value, err := strconv.ParseFloat(field, 64)
		if err != nil {
			return pdfLayoutBBox{}
		}
		values[index] = value
	}
	return pdfLayoutBBox{
		XMin: values[0],
		YMin: values[1],
		XMax: values[2],
		YMax: values[3],
	}
}

func joinPDFLayoutWords(words []pdfLayoutWord) string {
	var builder strings.Builder
	previous := ""
	for _, word := range words {
		text := strings.TrimSpace(word.Text)
		if text == "" {
			continue
		}
		if previous != "" && shouldInsertPDFWordSpace(previous, text) {
			builder.WriteByte(' ')
		}
		builder.WriteString(text)
		previous = text
	}
	return strings.TrimSpace(builder.String())
}

func isPDFNoiseBlock(block pdfLayoutBlock) bool {
	text := normalizeText(block.Text)
	if text == "" {
		return true
	}
	if hasUnreadableText(text) {
		return true
	}
	runeCount := len([]rune(text))
	width := block.BBox.XMax - block.BBox.XMin
	height := block.BBox.YMax - block.BBox.YMin
	if runeCount == 1 && width <= 60 && height >= 18 {
		return true
	}
	if runeCount <= 2 && width > 0 && height >= width*1.2 && height >= 24 {
		return true
	}
	if runeCount <= 4 && width <= 48 && height >= 42 {
		return true
	}
	return false
}

func hasUnreadableText(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	unreadable := 0
	total := 0
	for _, value := range text {
		if value == '\n' || value == '\t' || value == '\r' {
			continue
		}
		total++
		if value == utf8.RuneError || value == '�' || (value < 32 && value != '\n' && value != '\t' && value != '\r') {
			unreadable++
		}
	}
	return total > 0 && unreadable > 0
}

func isLikelyFigureAnchorBlock(text string) bool {
	normalized := normalizeText(text)
	if normalized == "" {
		return false
	}
	if strings.Contains(normalized, "如下图所示") || strings.Contains(normalized, "见下图") {
		return true
	}
	return regexp.MustCompile(`^表\d+[：:].*图$|结构图$|组织结构图$|流程图$|示意图$`).MatchString(normalized)
}

func isLikelyFigureContentBlock(block pdfLayoutBlock, text string) bool {
	normalized := normalizeText(text)
	if normalized == "" {
		return true
	}
	if hasUnreadableText(normalized) {
		return true
	}
	width := block.BBox.XMax - block.BBox.XMin
	height := block.BBox.YMax - block.BBox.YMin
	runeCount := len([]rune(normalized))
	if regexp.MustCompile(`^[0-9.,%]+$`).MatchString(normalized) {
		return true
	}
	if runeCount <= 18 && !strings.ContainsAny(normalized, "，。；：") && (width <= 220 || height <= 28) {
		return true
	}
	if runeCount <= 30 && regexp.MustCompile(`公司|集团|担保|控股|资本|金融`).MatchString(normalized) && !strings.ContainsAny(normalized, "，。；：") {
		return true
	}
	return false
}

func isLikelyFigureContinuation(anchorBBox pdfLayoutBBox, lastBBox pdfLayoutBBox, block pdfLayoutBlock, text string) bool {
	if isLikelyFigureContentBlock(block, text) {
		return true
	}
	if hasUnreadableText(text) {
		return false
	}
	if len([]rune(text)) > 20 || strings.ContainsAny(text, "，。；：") {
		return false
	}
	gapFromLast := block.BBox.YMin - lastBBox.YMax
	gapFromAnchor := block.BBox.YMin - anchorBBox.YMax
	return gapFromLast <= 80 && gapFromAnchor <= 220
}

func detectFigureType(text string) string {
	normalized := normalizeText(text)
	switch {
	case strings.Contains(normalized, "股权结构图"), strings.Contains(normalized, "结构图"), strings.Contains(normalized, "架构图"):
		return model.DocumentFigureTypeStructureChart
	case strings.Contains(normalized, "组织结构图"):
		return model.DocumentFigureTypeOrgChart
	case strings.Contains(normalized, "流程图"):
		return model.DocumentFigureTypeFlowChart
	default:
		return model.DocumentFigureTypeGenericFigure
	}
}

func mergePDFLayoutBBox(blocks []pdfLayoutBlock) pdfLayoutBBox {
	if len(blocks) == 0 {
		return pdfLayoutBBox{}
	}
	out := blocks[0].BBox
	for _, block := range blocks[1:] {
		if block.BBox.XMin < out.XMin {
			out.XMin = block.BBox.XMin
		}
		if block.BBox.YMin < out.YMin {
			out.YMin = block.BBox.YMin
		}
		if block.BBox.XMax > out.XMax {
			out.XMax = block.BBox.XMax
		}
		if block.BBox.YMax > out.YMax {
			out.YMax = block.BBox.YMax
		}
	}
	return out
}

func buildFigureNodes(blocks []pdfLayoutBlock) []pdfFigureNode {
	lines := make([]pdfFigureNode, 0)
	for _, block := range blocks {
		if len(block.Lines) > 0 {
			for _, line := range block.Lines {
				text := normalizeText(line.Text)
				if text == "" || hasUnreadableText(text) {
					continue
				}
				lines = append(lines, pdfFigureNode{
					Text:       text,
					BlockIndex: block.Index,
					LineIndex:  line.Index,
					BBox:       line.BBox,
				})
			}
			continue
		}
		text := normalizeText(block.Text)
		if text == "" || hasUnreadableText(text) {
			continue
		}
		lines = append(lines, pdfFigureNode{
			Text:       text,
			BlockIndex: block.Index,
			LineIndex:  1,
			BBox:       block.BBox,
		})
	}
	if len(lines) == 0 {
		return nil
	}
	sort.Slice(lines, func(i, j int) bool {
		if absFloat(lines[i].BBox.YMin-lines[j].BBox.YMin) > 6 {
			return lines[i].BBox.YMin < lines[j].BBox.YMin
		}
		return lines[i].BBox.XMin < lines[j].BBox.XMin
	})
	mergedBBox := mergeFigureNodeBBox(lines)
	currentRow := 1
	rowAnchorY := lines[0].BBox.YMin
	for index := range lines {
		if index > 0 && absFloat(lines[index].BBox.YMin-rowAnchorY) > 14 {
			currentRow++
			rowAnchorY = lines[index].BBox.YMin
		}
		lines[index].RowIndex = currentRow
		lines[index].Region = detectFigureRegion(mergedBBox, lines[index].BBox)
	}
	return lines
}

func mergeFigureNodeBBox(nodes []pdfFigureNode) pdfLayoutBBox {
	if len(nodes) == 0 {
		return pdfLayoutBBox{}
	}
	out := nodes[0].BBox
	for _, node := range nodes[1:] {
		if node.BBox.XMin < out.XMin {
			out.XMin = node.BBox.XMin
		}
		if node.BBox.YMin < out.YMin {
			out.YMin = node.BBox.YMin
		}
		if node.BBox.XMax > out.XMax {
			out.XMax = node.BBox.XMax
		}
		if node.BBox.YMax > out.YMax {
			out.YMax = node.BBox.YMax
		}
	}
	return out
}

func detectFigureRegion(merged pdfLayoutBBox, node pdfLayoutBBox) string {
	width := merged.XMax - merged.XMin
	if width <= 0 {
		return "center"
	}
	centerX := (node.XMin + node.XMax) / 2
	leftThreshold := merged.XMin + width/3
	rightThreshold := merged.XMin + width*2/3
	switch {
	case centerX <= leftThreshold:
		return "left"
	case centerX >= rightThreshold:
		return "right"
	default:
		return "center"
	}
}

func buildFigureDetailJSON(pageNo int, nodes []pdfFigureNode) json.RawMessage {
	if len(nodes) == 0 {
		return mustJSON(map[string]any{"page": pageNo, "nodes": []any{}})
	}
	items := make([]map[string]any, 0, len(nodes))
	for _, node := range nodes {
		items = append(items, map[string]any{
			"rowIndex":  node.RowIndex,
			"region":    node.Region,
			"text":      node.Text,
			"block":     node.BlockIndex,
			"line":      node.LineIndex,
			"sourceRef": fmt.Sprintf("第%d页/块%d", pageNo, node.BlockIndex),
			"bbox":      node.BBox,
		})
	}
	return mustJSON(map[string]any{
		"page":  pageNo,
		"nodes": items,
	})
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

func isNarrativePDFBlock(text string) bool {
	normalized := normalizeText(text)
	if normalized == "" {
		return false
	}
	if hasUnreadableText(normalized) {
		return false
	}
	return len([]rune(normalized)) >= 20 || strings.ContainsAny(normalized, "，。；：")
}

func shouldInsertPDFWordSpace(previous string, current string) bool {
	prevRune := []rune(previous)
	currRune := []rune(current)
	if len(prevRune) == 0 || len(currRune) == 0 {
		return false
	}
	return isASCIIWordRune(prevRune[len(prevRune)-1]) && isASCIIWordRune(currRune[0])
}

func isASCIIWordRune(value rune) bool {
	return (value >= '0' && value <= '9') ||
		(value >= 'A' && value <= 'Z') ||
		(value >= 'a' && value <= 'z')
}

func extractPDFTextResult(raw []byte) pdfExtractionResult {
	if result, err := extractPDFTextResultWithPyMuPDF(raw); err == nil {
		return result
	} else if pdfDebugEnabled() {
		log.Printf("pdf-pymupdf-fallback error=%q", err.Error())
	}
	if result, err := extractPDFTextResultWithMuPDF(raw); err == nil {
		return result
	} else if pdfDebugEnabled() {
		log.Printf("pdf-mupdf-fallback error=%q", err.Error())
	}
	native := extractPDFTextResultNative(raw)
	native.Diagnostics.Extractor = pdfExtractorNative
	if native.Diagnostics.DecodeMode == "" {
		native.Diagnostics.DecodeMode = native.DecodeMode
	}
	return native
}

func extractPDFTextResultNative(raw []byte) pdfExtractionResult {
	objects := parsePDFObjects(raw)
	if len(objects) == 0 {
		return pdfExtractionResult{DecodeMode: "pdf_native_fallback", Diagnostics: pdfDiagnostics{Extractor: pdfExtractorNative, DecodeMode: "pdf_native_fallback"}}
	}
	pagePattern := regexp.MustCompile(`/Type\s*/Page([^s]|$)`)
	contentsRefPattern := regexp.MustCompile(`/Contents\s+(\d+)\s+(\d+)\s+R`)
	contentsArrayPattern := regexp.MustCompile(`/Contents\s*\[(.*?)\]`)
	refPattern := regexp.MustCompile(`(\d+)\s+(\d+)\s+R`)
	mode := "pdf_native_fallback"
	pages := make([]pdfPageText, 0)
	decodeFailed := false
	hasTextOperators := false
	diagnostics := pdfDiagnostics{
		Extractor:  pdfExtractorNative,
		DecodeMode: "pdf_native_fallback",
		Fonts:      collectPDFFontDiagnostics(objects),
		Filters:    collectPDFFilterDiagnostics(objects),
		XObjects:   make([]pdfXObjectDiagnostic, 0),
		Pages:      make([]pdfPageDiagnostic, 0),
	}
	for _, object := range objects {
		if !pagePattern.Match(object.Body) {
			continue
		}
		resourcesDict := resolvePDFResourcesDict(objects, object, map[string]bool{})
		if resourcesDict != "" {
			diagnostics.ResourceHints.PageResourcesResolvedCount++
		}
		fonts := resolvePDFFontsFromResources(objects, resourcesDict)
		xobjects := resolvePDFXObjectsFromResources(objects, object.ID, resourcesDict)
		if len(xobjects) > 0 {
			diagnostics.ResourceHints.PageXObjectResolvedCount += len(xobjects)
		}
		refs := make([]string, 0)
		if match := contentsRefPattern.FindStringSubmatch(object.Dict); len(match) == 3 {
			refs = append(refs, match[1]+" "+match[2])
		}
		if match := contentsArrayPattern.FindStringSubmatch(object.Dict); len(match) == 2 {
			for _, ref := range refPattern.FindAllStringSubmatch(match[1], -1) {
				if len(ref) == 3 {
					refs = append(refs, ref[1]+" "+ref[2])
				}
			}
		}
		textParts := make([]string, 0)
		pageDecodeFailed := false
		pageUsedToUnicode := false
		pageHasTextOperators := false
		pageXObjects := make([]pdfXObjectDiagnostic, 0)
		for _, ref := range refs {
			contentObject, ok := objectByID(objects, ref)
			if !ok {
				continue
			}
			for _, stream := range contentObject.Streams {
				text, usedToUnicode, failed, hasText, xobjectDiagnostics := extractPDFStreamTextWithResources(objects, contentObject, stream, fonts, xobjects, map[string]bool{}, 1)
				pageUsedToUnicode = pageUsedToUnicode || usedToUnicode
				pageDecodeFailed = pageDecodeFailed || failed
				pageHasTextOperators = pageHasTextOperators || hasText
				pageXObjects = append(pageXObjects, xobjectDiagnostics...)
				if strings.TrimSpace(text) != "" {
					textParts = append(textParts, text)
				}
			}
		}
		if len(textParts) == 0 && len(object.Streams) > 0 {
			for _, stream := range object.Streams {
				text, usedToUnicode, failed, hasText, xobjectDiagnostics := extractPDFStreamTextWithResources(objects, object, stream, fonts, xobjects, map[string]bool{}, 1)
				pageUsedToUnicode = pageUsedToUnicode || usedToUnicode
				pageDecodeFailed = pageDecodeFailed || failed
				pageHasTextOperators = pageHasTextOperators || hasText
				pageXObjects = append(pageXObjects, xobjectDiagnostics...)
				if strings.TrimSpace(text) != "" {
					textParts = append(textParts, text)
				}
			}
		}
		hasTextOperators = hasTextOperators || pageHasTextOperators
		if pageUsedToUnicode {
			mode = "pdf_to_unicode"
		}
		if (pageDecodeFailed || pageHasTextOperators) && strings.TrimSpace(strings.Join(textParts, "")) == "" {
			decodeFailed = true
		}
		pages = append(pages, pdfPageText{
			PageNo: len(pages) + 1,
			Text:   normalizeText(strings.Join(textParts, "\n")),
		})
		pageNo := len(pages)
		diagnostics.Pages = append(diagnostics.Pages, pdfPageDiagnostic{
			PageNo:           pageNo,
			ContentsCount:    len(refs),
			ContentsRefs:     refs,
			HasTextOperators: pageHasTextOperators,
			UsedToUnicode:    pageUsedToUnicode,
			DecodeFailed:     pageDecodeFailed,
			DoCount:          len(pageXObjects),
			CharCount:        len([]rune(normalizeText(strings.Join(textParts, "\n")))),
		})
		diagnostics.XObjects = append(diagnostics.XObjects, pageXObjects...)
		diagnostics.ResourceHints.PageDoMatchCount += len(pageXObjects)
		logPDFPageDiagnostic(pageNo, refs, pageHasTextOperators, pageUsedToUnicode, pageDecodeFailed, len(pageXObjects), len([]rune(normalizeText(strings.Join(textParts, "\n")))))
	}
	if decodeFailed {
		diagnostics.DecodeMode = "pdf_decode_failed"
		diagnostics.DecodeFailed = true
		diagnostics.HasTextOperators = hasTextOperators
		diagnostics.PageCount = len(pages)
		return pdfExtractionResult{Pages: pages, DecodeMode: "pdf_decode_failed", DecodeFailed: true, HasTextOperators: hasTextOperators, Diagnostics: diagnostics}
	}
	diagnostics.DecodeMode = mode
	diagnostics.DecodeFailed = false
	diagnostics.HasTextOperators = hasTextOperators
	diagnostics.PageCount = len(pages)
	return pdfExtractionResult{Pages: pages, DecodeMode: mode, HasTextOperators: hasTextOperators, Diagnostics: diagnostics}
}

func extractPDFPageTexts(raw []byte) []pdfPageText {
	return extractPDFTextResult(raw).Pages
}

func parsePDFObjects(raw []byte) []pdfObject {
	objectPattern := regexp.MustCompile(`(?ms)(?:\A|[\r\n])\s*(\d+)\s+(\d+)\s+obj\b(.*?)(?:[\r\n])\s*endobj\b`)
	matches := objectPattern.FindAllSubmatch(raw, -1)
	objects := make([]pdfObject, 0, len(matches))
	for _, match := range matches {
		if len(match) < 4 {
			continue
		}
		body := bytes.TrimSpace(match[3])
		obj := pdfObject{
			ID:   string(match[1]) + " " + string(match[2]),
			Body: body,
			Dict: extractPDFObjectDict(body),
		}
		streamPattern := regexp.MustCompile(`(?s)stream\r?\n(.*?)\r?\nendstream`)
		streamMatches := streamPattern.FindAllSubmatch(body, -1)
		for _, streamMatch := range streamMatches {
			if len(streamMatch) >= 2 {
				obj.Streams = append(obj.Streams, append([]byte(nil), streamMatch[1]...))
			}
		}
		objects = append(objects, obj)
	}
	return objects
}

func extractPDFObjectDict(body []byte) string {
	start := bytes.Index(body, []byte("<<"))
	if start < 0 {
		return ""
	}
	depth := 0
	for index := start; index < len(body)-1; index++ {
		if body[index] == '<' && body[index+1] == '<' {
			depth++
			index++
			continue
		}
		if body[index] == '>' && body[index+1] == '>' {
			depth--
			index++
			if depth == 0 {
				return string(body[start : index+1])
			}
		}
	}
	return ""
}

func objectByID(objects []pdfObject, id string) (pdfObject, bool) {
	for index := len(objects) - 1; index >= 0; index-- {
		object := objects[index]
		if object.ID == id {
			return object, true
		}
	}
	return pdfObject{}, false
}

func resolvePDFFonts(objects []pdfObject, pageObject pdfObject) map[string]pdfFontMap {
	resourcesDict := resolvePDFResourcesDict(objects, pageObject, map[string]bool{})
	return resolvePDFFontsFromResources(objects, resourcesDict)
}

func resolvePDFFontsFromResources(objects []pdfObject, resourcesDict string) map[string]pdfFontMap {
	fonts := map[string]pdfFontMap{}
	if resourcesDict == "" {
		return fonts
	}
	fontDict := extractInlinePDFDict(resourcesDict, "/Font")
	if fontDict == "" {
		return fonts
	}
	for _, match := range regexp.MustCompile(`/([^\s/]+)\s+(\d+)\s+(\d+)\s+R`).FindAllStringSubmatch(fontDict, -1) {
		if len(match) != 4 {
			continue
		}
		fontObject, ok := objectByID(objects, match[2]+" "+match[3])
		if !ok {
			continue
		}
		fonts[match[1]] = parsePDFFontMap(objects, fontObject)
	}
	return fonts
}

func resolvePDFXObjectsFromResources(objects []pdfObject, ownerObjectID string, resourcesDict string) map[string]pdfObject {
	xobjects := map[string]pdfObject{}
	if resourcesDict == "" {
		logPDFPageXObjects(ownerObjectID, "", nil, nil)
		return xobjects
	}
	xObjectDict := extractInlinePDFDict(resourcesDict, "/XObject")
	if xObjectDict == "" {
		logPDFPageXObjects(ownerObjectID, "", nil, nil)
		return xobjects
	}
	names := make([]string, 0)
	objectIDs := make([]string, 0)
	for _, match := range regexp.MustCompile(`/([^\s/]+)\s+(\d+)\s+(\d+)\s+R`).FindAllStringSubmatch(xObjectDict, -1) {
		if len(match) != 4 {
			continue
		}
		object, ok := objectByID(objects, match[2]+" "+match[3])
		if !ok {
			continue
		}
		xobjects[match[1]] = object
		names = append(names, match[1])
		objectIDs = append(objectIDs, object.ID)
	}
	logPDFPageXObjects(ownerObjectID, xObjectDict, names, objectIDs)
	return xobjects
}

func resolvePDFResourcesDict(objects []pdfObject, object pdfObject, visited map[string]bool) string {
	if visited[object.ID] {
		return ""
	}
	visited[object.ID] = true
	resourcesDict := extractInlinePDFDict(object.Dict, "/Resources")
	if resourcesDict != "" {
		logPDFPageResources(object.ID, "inline", "", resourcesDict)
		return resourcesDict
	}
	if match := regexp.MustCompile(`/Resources\s+(\d+)\s+(\d+)\s+R`).FindStringSubmatch(object.Dict); len(match) == 3 {
		if resourceObject, ok := objectByID(objects, match[1]+" "+match[2]); ok {
			logPDFPageResources(object.ID, "ref", resourceObject.ID, resourceObject.Dict)
			return resourceObject.Dict
		}
	}
	if match := regexp.MustCompile(`/Parent\s+(\d+)\s+(\d+)\s+R`).FindStringSubmatch(object.Dict); len(match) == 3 {
		if parentObject, ok := objectByID(objects, match[1]+" "+match[2]); ok {
			logPDFPageResources(object.ID, "parent", parentObject.ID, parentObject.Dict)
			return resolvePDFResourcesDict(objects, parentObject, visited)
		}
	}
	logPDFPageResources(object.ID, "missing", "", "")
	return ""
}

func extractInlinePDFDict(dict string, key string) string {
	index := strings.Index(dict, key)
	if index < 0 {
		logPDFInlineDict(key, dict, false, false, false)
		return ""
	}
	start := strings.Index(dict[index:], "<<")
	if start < 0 {
		logPDFInlineDict(key, dict, true, false, false)
		return ""
	}
	start += index
	depth := 0
	for i := start; i < len(dict)-1; i++ {
		if dict[i] == '<' && dict[i+1] == '<' {
			depth++
			i++
			continue
		}
		if dict[i] == '>' && dict[i+1] == '>' {
			depth--
			i++
			if depth == 0 {
				logPDFInlineDict(key, dict, true, true, true)
				return dict[start : i+1]
			}
		}
	}
	logPDFInlineDict(key, dict, true, true, false)
	return ""
}

func parsePDFFontMap(objects []pdfObject, fontObject pdfObject) pdfFontMap {
	fontMap := pdfFontMap{
		ToUnicode: map[string]string{},
	}
	fontMap.Encoding = parsePDFFontEncoding(fontObject.Dict)
	fontMap.BaseFont = parsePDFBaseFont(fontObject.Dict)
	match := regexp.MustCompile(`/ToUnicode\s+(\d+)\s+(\d+)\s+R`).FindStringSubmatch(fontObject.Dict)
	if len(match) != 3 {
		return fontMap
	}
	toUnicodeObject, ok := objectByID(objects, match[1]+" "+match[2])
	if !ok || len(toUnicodeObject.Streams) == 0 {
		return fontMap
	}
	stream := toUnicodeObject.Streams[0]
	if strings.Contains(toUnicodeObject.Dict, "/FlateDecode") {
		inflated, err := inflatePDFStream(stream)
		if err == nil {
			stream = inflated
		}
	}
	fontMap.ToUnicode, fontMap.CodeLengths = parseToUnicodeCMap(string(stream))
	return fontMap
}

func parsePDFFontEncoding(dict string) string {
	if match := regexp.MustCompile(`/Encoding\s*/([A-Za-z0-9\-_]+)`).FindStringSubmatch(dict); len(match) == 2 {
		return match[1]
	}
	if strings.Contains(dict, "/Identity-H") {
		return "Identity-H"
	}
	return ""
}

func parsePDFBaseFont(dict string) string {
	if match := regexp.MustCompile(`/BaseFont\s*/([A-Za-z0-9\-_+,]+)`).FindStringSubmatch(dict); len(match) == 2 {
		return match[1]
	}
	return ""
}

func parseToUnicodeCMap(content string) (map[string]string, []int) {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	mapping := map[string]string{}
	codeLengths := map[int]struct{}{}

	for _, match := range regexp.MustCompile(`(?s)beginbfchar(.*?)endbfchar`).FindAllStringSubmatch(content, -1) {
		lines := strings.Split(match[1], "\n")
		for _, line := range lines {
			pairs := regexp.MustCompile(`<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>`).FindStringSubmatch(line)
			if len(pairs) != 3 {
				continue
			}
			key := strings.ToUpper(pairs[1])
			mapping[key] = decodePDFUTF16Hex(pairs[2])
			codeLengths[len(key)/2] = struct{}{}
		}
	}

	for _, match := range regexp.MustCompile(`(?s)beginbfrange(.*?)endbfrange`).FindAllStringSubmatch(content, -1) {
		lines := strings.Split(match[1], "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if pairs := regexp.MustCompile(`<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>`).FindStringSubmatch(line); len(pairs) == 4 {
				startCode, _ := strconv.ParseUint(pairs[1], 16, 32)
				endCode, _ := strconv.ParseUint(pairs[2], 16, 32)
				dst := decodePDFUTF16Hex(pairs[3])
				dstRunes := []rune(dst)
				if len(dstRunes) == 1 {
					for code := startCode; code <= endCode; code++ {
						key := strings.ToUpper(fmt.Sprintf("%0*X", len(pairs[1]), code))
						mapping[key] = string(rune(int(dstRunes[0]) + int(code-startCode)))
						codeLengths[len(key)/2] = struct{}{}
					}
				}
				continue
			}
			if pairs := regexp.MustCompile(`<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]`).FindStringSubmatch(line); len(pairs) == 4 {
				startCode, _ := strconv.ParseUint(pairs[1], 16, 32)
				values := regexp.MustCompile(`<([0-9A-Fa-f]+)>`).FindAllStringSubmatch(pairs[3], -1)
				for offset, value := range values {
					key := strings.ToUpper(fmt.Sprintf("%0*X", len(pairs[1]), startCode+uint64(offset)))
					mapping[key] = decodePDFUTF16Hex(value[1])
					codeLengths[len(key)/2] = struct{}{}
				}
			}
		}
	}

	lengths := make([]int, 0, len(codeLengths))
	for length := range codeLengths {
		lengths = append(lengths, length)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(lengths)))
	return mapping, lengths
}

func decodePDFUTF16Hex(hexText string) string {
	if len(hexText)%2 == 1 {
		hexText += "0"
	}
	data := make([]byte, 0, len(hexText)/2)
	for index := 0; index+1 < len(hexText); index += 2 {
		value, err := strconv.ParseUint(hexText[index:index+2], 16, 8)
		if err == nil {
			data = append(data, byte(value))
		}
	}
	if len(data)%2 == 0 && len(data) > 0 {
		text := decodeUTF16BigEndian(data)
		if text != "" {
			return text
		}
	}
	text := decodePDFUTF16(data)
	if text == "" {
		return string(data)
	}
	return text
}

func decodeUTF16BigEndian(data []byte) string {
	if len(data)%2 != 0 {
		return ""
	}
	u16 := make([]uint16, 0, len(data)/2)
	for index := 0; index+1 < len(data); index += 2 {
		u16 = append(u16, uint16(data[index])<<8|uint16(data[index+1]))
	}
	return string(utf16.Decode(u16))
}

func joinPDFPageTexts(pages []pdfPageText) string {
	parts := make([]string, 0, len(pages))
	for _, page := range pages {
		if strings.TrimSpace(page.Text) != "" {
			parts = append(parts, page.Text)
		}
	}
	return normalizeText(strings.Join(parts, "\n\n"))
}

func extractPDFStreamText(dict string, body []byte, fonts map[string]pdfFontMap) (string, bool, bool, bool) {
	body = decodePDFStreamByFilters(dict, body)
	text, usedToUnicode, failed := extractTextOperators(string(body), fonts)
	return text, usedToUnicode, failed, streamHasPDFTextOperators(string(body))
}

func extractPDFStreamTextWithResources(objects []pdfObject, owner pdfObject, body []byte, fonts map[string]pdfFontMap, xobjects map[string]pdfObject, visited map[string]bool, depth int) (string, bool, bool, bool, []pdfXObjectDiagnostic) {
	body = decodePDFStreamByFilters(owner.Dict, body)
	content := string(body)
	text, usedToUnicode, failed := extractTextOperators(content, fonts)
	hasText := streamHasPDFTextOperators(content)
	doNames := extractPDFDoOperators(owner.ID, content)
	diagnostics := make([]pdfXObjectDiagnostic, 0)
	if len(doNames) == 0 {
		return text, usedToUnicode, failed, hasText, diagnostics
	}
	parts := make([]string, 0, len(doNames)+1)
	if strings.TrimSpace(text) != "" {
		parts = append(parts, text)
	}
	for _, name := range doNames {
		xobject, ok := xobjects[name]
		if !ok || visited[xobject.ID] {
			continue
		}
		if !strings.Contains(xobject.Dict, "/Subtype/Form") {
			continue
		}
		visited[xobject.ID] = true
		xobjectDiag := pdfXObjectDiagnostic{
			ResourceName: name,
			ObjectID:     xobject.ID,
			Subtype:      "Form",
			Depth:        depth,
		}
		formResources := resolvePDFResourcesDict(objects, xobject, map[string]bool{})
		formFonts := mergePDFFonts(fonts, resolvePDFFontsFromResources(objects, formResources))
		formXObjects := mergePDFXObjects(xobjects, resolvePDFXObjectsFromResources(objects, xobject.ID, formResources))
		for _, stream := range xobject.Streams {
			childText, childUsedToUnicode, childFailed, childHasText, childDiagnostics := extractPDFStreamTextWithResources(objects, xobject, stream, formFonts, formXObjects, visited, depth+1)
			usedToUnicode = usedToUnicode || childUsedToUnicode
			failed = failed || childFailed
			hasText = hasText || childHasText
			xobjectDiag.HasTextOperators = xobjectDiag.HasTextOperators || childHasText
			xobjectDiag.CharCount += len([]rune(strings.TrimSpace(childText)))
			if strings.TrimSpace(childText) != "" {
				parts = append(parts, childText)
			}
			diagnostics = append(diagnostics, childDiagnostics...)
		}
		logPDFXObjectDiagnostic(xobjectDiag)
		diagnostics = append(diagnostics, xobjectDiag)
	}
	return normalizeText(strings.Join(parts, "\n")), usedToUnicode, failed, hasText, diagnostics
}

func collectPDFFontDiagnostics(objects []pdfObject) []pdfFontDiagnostic {
	out := make([]pdfFontDiagnostic, 0)
	for _, object := range objects {
		if !strings.Contains(object.Dict, "/Type/Font") && !strings.Contains(object.Dict, "/Type /Font") {
			continue
		}
		fontMap := parsePDFFontMap(objects, object)
		out = append(out, pdfFontDiagnostic{
			ResourceName:     object.ID,
			BaseFont:         fontMap.BaseFont,
			Encoding:         fontMap.Encoding,
			HasToUnicode:     len(fontMap.ToUnicode) > 0,
			ToUnicodeEntries: len(fontMap.ToUnicode),
		})
	}
	return out
}

func collectPDFFilterDiagnostics(objects []pdfObject) []pdfFilterDiagnostic {
	out := make([]pdfFilterDiagnostic, 0)
	for _, object := range objects {
		filters := extractPDFFilters(object.Dict)
		if len(filters) == 0 {
			continue
		}
		out = append(out, pdfFilterDiagnostic{
			ObjectID: object.ID,
			Filters:  filters,
		})
	}
	return out
}

func pdfDebugEnabled() bool {
	return strings.TrimSpace(os.Getenv("PDF_DEBUG_LOG")) == "1"
}

func pdfPreview(text string, maxLen int) string {
	normalized := strings.ReplaceAll(text, "\r\n", " ")
	normalized = strings.ReplaceAll(normalized, "\n", " ")
	normalized = strings.TrimSpace(normalized)
	runes := []rune(normalized)
	if len(runes) > maxLen {
		return string(runes[:maxLen]) + "..."
	}
	return normalized
}

func logPDFPageDiagnostic(pageNo int, refs []string, hasTextOperators bool, usedToUnicode bool, decodeFailed bool, doCount int, charCount int) {
	if !pdfDebugEnabled() {
		return
	}
	log.Printf("pdf-page page=%d contents=%v hasTextOperators=%t usedToUnicode=%t decodeFailed=%t doCount=%d charCount=%d", pageNo, refs, hasTextOperators, usedToUnicode, decodeFailed, doCount, charCount)
}

func logPDFXObjectDiagnostic(diagnostic pdfXObjectDiagnostic) {
	if !pdfDebugEnabled() {
		return
	}
	log.Printf("pdf-xobject name=%s objectId=%s subtype=%s depth=%d hasTextOperators=%t charCount=%d", diagnostic.ResourceName, diagnostic.ObjectID, diagnostic.Subtype, diagnostic.Depth, diagnostic.HasTextOperators, diagnostic.CharCount)
}

func logPDFPageResources(objectID string, source string, parentObjectID string, resourcesDict string) {
	if !pdfDebugEnabled() {
		return
	}
	log.Printf("pdf-page-resources objectId=%s source=%s parentObjectId=%s resourcesPreview=%q", objectID, source, parentObjectID, pdfPreview(resourcesDict, 200))
}

func logPDFInlineDict(dictKey string, dict string, hasKey bool, hasStart bool, closed bool) {
	if !pdfDebugEnabled() {
		return
	}
	log.Printf("pdf-inline-dict key=%s hasKey=%t hasStart=%t closed=%t dictPreview=%q", dictKey, hasKey, hasStart, closed, pdfPreview(dict, 240))
}

func logPDFPageXObjects(ownerObjectID string, xobjectDict string, names []string, objectIDs []string) {
	if !pdfDebugEnabled() {
		return
	}
	log.Printf("pdf-page-xobjects resourceObjectId=%s count=%d names=%v resolvedObjectIds=%v xobjectDictPreview=%q", ownerObjectID, len(names), names, objectIDs, pdfPreview(xobjectDict, 240))
}

func logPDFDoMatch(objectID string, content string, names []string) {
	if !pdfDebugEnabled() {
		return
	}
	log.Printf("pdf-do-match objectId=%s count=%d matchedNames=%v streamPreview=%q", objectID, len(names), names, pdfPreview(content, 240))
}

func logPDFParseSummary(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, sliceCount int, tableCount int) {
	if profile.FileType != "pdf" {
		return
	}
	diagnosticsJSON, _ := json.Marshal(profile.PDFDiagnostics)
	log.Printf("pdf-parse-summary fileId=%d versionNo=%d origin=%q strategy=%s hasTextLayer=%t sourceType=%s pageCount=%d sliceCount=%d tableCount=%d diagnostics=%s", caseFile.FileID, version.VersionNo, version.OriginName, profile.ParseStrategy, profile.HasTextLayer, profile.SourceType, profile.PageCount, sliceCount, tableCount, string(diagnosticsJSON))
}

func extractPDFDoOperators(objectID string, content string) []string {
	matches := regexp.MustCompile(`/([^\s/]+)\s+Do`).FindAllStringSubmatch(content, -1)
	out := make([]string, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) != 2 || seen[match[1]] {
			continue
		}
		seen[match[1]] = true
		out = append(out, match[1])
	}
	logPDFDoMatch(objectID, content, out)
	return out
}

func mergePDFFonts(parent map[string]pdfFontMap, child map[string]pdfFontMap) map[string]pdfFontMap {
	out := make(map[string]pdfFontMap, len(parent)+len(child))
	for key, value := range parent {
		out[key] = value
	}
	for key, value := range child {
		out[key] = value
	}
	return out
}

func mergePDFXObjects(parent map[string]pdfObject, child map[string]pdfObject) map[string]pdfObject {
	out := make(map[string]pdfObject, len(parent)+len(child))
	for key, value := range parent {
		out[key] = value
	}
	for key, value := range child {
		out[key] = value
	}
	return out
}

func decodePDFStreamByFilters(dict string, body []byte) []byte {
	filters := extractPDFFilters(dict)
	if len(filters) == 0 {
		return body
	}
	decoded := append([]byte(nil), body...)
	for _, filter := range filters {
		next, ok := applyPDFFilter(filter, decoded)
		if !ok {
			return decoded
		}
		decoded = next
	}
	return decoded
}

func extractPDFFilters(dict string) []string {
	arrayMatch := regexp.MustCompile(`/Filter\s*\[(.*?)\]`).FindStringSubmatch(dict)
	if len(arrayMatch) == 2 {
		names := regexp.MustCompile(`/([A-Za-z0-9]+)`).FindAllStringSubmatch(arrayMatch[1], -1)
		out := make([]string, 0, len(names))
		for _, item := range names {
			if len(item) == 2 {
				out = append(out, item[1])
			}
		}
		return out
	}
	singleMatch := regexp.MustCompile(`/Filter\s*/([A-Za-z0-9]+)`).FindStringSubmatch(dict)
	if len(singleMatch) == 2 {
		return []string{singleMatch[1]}
	}
	return nil
}

func applyPDFFilter(filter string, body []byte) ([]byte, bool) {
	switch filter {
	case "FlateDecode", "Fl":
		inflated, err := inflatePDFStream(body)
		return inflated, err == nil
	case "ASCIIHexDecode", "AHx":
		decoded, err := decodeASCIIHex(body)
		return decoded, err == nil
	case "ASCII85Decode", "A85":
		decoded, err := decodeASCII85(body)
		return decoded, err == nil
	case "RunLengthDecode", "RL":
		return decodeRunLength(body), true
	case "LZWDecode", "LZW":
		decoded, err := decodeLZW(body)
		return decoded, err == nil
	default:
		return body, false
	}
}

func decodeASCIIHex(body []byte) ([]byte, error) {
	filtered := make([]byte, 0, len(body))
	for _, value := range body {
		if value == '>' {
			break
		}
		if value == ' ' || value == '\n' || value == '\r' || value == '\t' || value == '\f' || value == '\000' {
			continue
		}
		filtered = append(filtered, value)
	}
	if len(filtered)%2 == 1 {
		filtered = append(filtered, '0')
	}
	out := make([]byte, 0, len(filtered)/2)
	for index := 0; index+1 < len(filtered); index += 2 {
		value, err := strconv.ParseUint(string(filtered[index:index+2]), 16, 8)
		if err != nil {
			return nil, err
		}
		out = append(out, byte(value))
	}
	return out, nil
}

func decodeASCII85(body []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(body)
	trimmed = bytes.TrimPrefix(trimmed, []byte("<~"))
	trimmed = bytes.TrimSuffix(trimmed, []byte("~>"))
	dst := make([]byte, len(trimmed)*4/5+8)
	written, _, err := ascii85.Decode(dst, trimmed, true)
	if err != nil {
		return nil, err
	}
	return dst[:written], nil
}

func decodeRunLength(body []byte) []byte {
	reader := bufio.NewReader(bytes.NewReader(body))
	out := make([]byte, 0, len(body))
	for {
		length, err := reader.ReadByte()
		if err != nil || length == 128 {
			break
		}
		if length <= 127 {
			count := int(length) + 1
			buffer := make([]byte, count)
			if _, err := io.ReadFull(reader, buffer); err != nil {
				break
			}
			out = append(out, buffer...)
			continue
		}
		value, err := reader.ReadByte()
		if err != nil {
			break
		}
		for repeat := 0; repeat < 257-int(length); repeat++ {
			out = append(out, value)
		}
	}
	return out
}

func decodeLZW(body []byte) ([]byte, error) {
	reader := lzw.NewReader(bytes.NewReader(body), lzw.MSB, 8)
	defer reader.Close()
	return io.ReadAll(reader)
}

func streamHasPDFTextOperators(content string) bool {
	return strings.Contains(content, " BT") ||
		strings.Contains(content, "\nBT") ||
		strings.Contains(content, "BT\n") ||
		strings.Contains(content, " Tj") ||
		strings.Contains(content, " TJ") ||
		strings.Contains(content, ")Tj") ||
		strings.Contains(content, "]TJ")
}

func inflatePDFStream(raw []byte) ([]byte, error) {
	zlibReader, zlibErr := zlib.NewReader(bytes.NewReader(raw))
	if zlibErr == nil {
		defer zlibReader.Close()
		return io.ReadAll(zlibReader)
	}
	flateReader := flate.NewReader(bytes.NewReader(raw))
	defer flateReader.Close()
	return io.ReadAll(flateReader)
}

func extractTextOperators(content string, fonts map[string]pdfFontMap) (string, bool, bool) {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	blockPattern := regexp.MustCompile(`(?s)BT(.*?)ET`)
	blocks := blockPattern.FindAllStringSubmatch(content, -1)
	if len(blocks) == 0 {
		blocks = [][]string{{"", content}}
	}
	parts := make([]string, 0)
	usedToUnicode := false
	decodeFailed := false
	for _, block := range blocks {
		segment := block[len(block)-1]
		texts, blockUsedToUnicode, blockFailed := extractPDFTextFromBlock(segment, fonts)
		usedToUnicode = usedToUnicode || blockUsedToUnicode
		decodeFailed = decodeFailed || blockFailed
		parts = append(parts, texts...)
	}
	return normalizeText(strings.Join(parts, "\n")), usedToUnicode, decodeFailed
}

func extractPDFTextFromBlock(segment string, fonts map[string]pdfFontMap) ([]string, bool, bool) {
	parts := make([]string, 0)
	currentFont := ""
	usedToUnicode := false
	decodeFailed := false
	for index := 0; index < len(segment); index++ {
		switch segment[index] {
		case '/':
			if name, next, ok := readPDFFontToken(segment, index); ok {
				currentFont = name
				index = next
			}
		case 'T':
			if strings.HasPrefix(segment[index:], "T*") {
				parts = append(parts, "\n")
				index++
			}
		case '(':
			raw, next := readPDFLiteralStringBytes(segment, index)
			index = next
			operator := pdfOperatorAfter(segment, index)
			if operator != "Tj" && operator != "TJ" && operator != "'" && operator != `"` {
				continue
			}
			decoded, hitToUnicode, failed := decodePDFBytes(raw, currentFont, fonts)
			usedToUnicode = usedToUnicode || hitToUnicode
			decodeFailed = decodeFailed || failed
			if strings.TrimSpace(decoded) != "" {
				parts = append(parts, normalizeText(decoded))
			}
		case '<':
			if index+1 < len(segment) && segment[index+1] != '<' {
				raw, next := readPDFHexStringBytes(segment, index)
				index = next
				operator := pdfOperatorAfter(segment, index)
				if operator != "Tj" && operator != "TJ" {
					continue
				}
				decoded, hitToUnicode, failed := decodePDFBytes(raw, currentFont, fonts)
				usedToUnicode = usedToUnicode || hitToUnicode
				decodeFailed = decodeFailed || failed
				if strings.TrimSpace(decoded) != "" {
					parts = append(parts, normalizeText(decoded))
				}
			} else if index+1 < len(segment) && segment[index+1] == '<' {
				dict, next := readBalancedPDFDict(segment, index)
				index = next
				if name := extractFontNameFromTf(dict, segment[index+1:]); name != "" {
					currentFont = name
				}
			}
		case '[':
			arrayBody, next := readBalancedPDFArray(segment, index)
			index = next
			operator := pdfOperatorAfter(segment, index)
			if operator != "TJ" {
				continue
			}
			arrayTexts, hitToUnicode, failed := decodePDFTJArray(arrayBody, currentFont, fonts)
			usedToUnicode = usedToUnicode || hitToUnicode
			decodeFailed = decodeFailed || failed
			parts = append(parts, arrayTexts...)
		}
		if strings.HasPrefix(segment[index:], "Td") || strings.HasPrefix(segment[index:], "TD") || strings.HasPrefix(segment[index:], "Tm") {
			parts = append(parts, "\n")
		}
	}
	return compactTextParts(parts), usedToUnicode, decodeFailed
}

func compactTextParts(parts []string) []string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}

func readPDFFontToken(content string, start int) (string, int, bool) {
	match := regexp.MustCompile(`^/([^\s/]+)\s+\d+(?:\.\d+)?\s+Tf`).FindStringSubmatch(content[start:])
	if len(match) == 2 {
		return match[1], start + len(match[0]) - 1, true
	}
	return "", start, false
}

func pdfOperatorAfter(content string, index int) string {
	rest := strings.TrimSpace(content[index+1:])
	for _, operator := range []string{"Tj", "TJ", "'", `"`} {
		if strings.HasPrefix(rest, operator) {
			return operator
		}
	}
	return ""
}

func readBalancedPDFArray(content string, start int) (string, int) {
	depth := 0
	for index := start; index < len(content); index++ {
		switch content[index] {
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return content[start+1 : index], index
			}
		}
	}
	return content[start+1:], len(content) - 1
}

func readBalancedPDFDict(content string, start int) (string, int) {
	depth := 0
	for index := start; index < len(content)-1; index++ {
		if content[index] == '<' && content[index+1] == '<' {
			depth++
			index++
			continue
		}
		if content[index] == '>' && content[index+1] == '>' {
			depth--
			index++
			if depth == 0 {
				return content[start : index+1], index
			}
		}
	}
	return content[start:], len(content) - 1
}

func extractFontNameFromTf(dict string, rest string) string {
	combined := strings.TrimSpace(dict + " " + rest)
	match := regexp.MustCompile(`/([^\s/]+)\s+\d+(?:\.\d+)?\s+Tf`).FindStringSubmatch(combined)
	if len(match) == 2 {
		return match[1]
	}
	return ""
}

func decodePDFTJArray(content string, currentFont string, fonts map[string]pdfFontMap) ([]string, bool, bool) {
	parts := make([]string, 0)
	usedToUnicode := false
	decodeFailed := false
	for index := 0; index < len(content); index++ {
		switch content[index] {
		case '(':
			raw, next := readPDFLiteralStringBytes(content, index)
			index = next
			decoded, hitToUnicode, failed := decodePDFBytes(raw, currentFont, fonts)
			usedToUnicode = usedToUnicode || hitToUnicode
			decodeFailed = decodeFailed || failed
			if strings.TrimSpace(decoded) != "" {
				parts = append(parts, normalizeText(decoded))
			}
		case '<':
			if index+1 < len(content) && content[index+1] != '<' {
				raw, next := readPDFHexStringBytes(content, index)
				index = next
				decoded, hitToUnicode, failed := decodePDFBytes(raw, currentFont, fonts)
				usedToUnicode = usedToUnicode || hitToUnicode
				decodeFailed = decodeFailed || failed
				if strings.TrimSpace(decoded) != "" {
					parts = append(parts, normalizeText(decoded))
				}
			}
		}
	}
	return parts, usedToUnicode, decodeFailed
}

func decodePDFBytes(raw []byte, currentFont string, fonts map[string]pdfFontMap) (string, bool, bool) {
	if len(raw) == 0 {
		return "", false, false
	}
	if font, ok := fonts[currentFont]; ok && len(font.ToUnicode) > 0 {
		text := decodeBytesWithToUnicode(raw, font)
		if text != "" {
			return text, true, false
		}
		return "", true, true
	}
	if font, ok := fonts[currentFont]; ok {
		if text, matched := decodePDFBytesWithoutToUnicode(raw, font); matched {
			if looksReadableText(text) {
				return text, false, false
			}
			return "", false, true
		}
	}
	text := decodePDFUTF16(raw)
	if looksReadableText(text) {
		return text, false, false
	}
	if utf8.Valid(raw) {
		text = string(raw)
		if looksReadableText(text) {
			return text, false, false
		}
	}
	if looksBinaryBytes(raw) {
		return "", false, true
	}
	return string(raw), false, false
}

func decodePDFBytesWithoutToUnicode(raw []byte, font pdfFontMap) (string, bool) {
	encoding := strings.TrimSpace(font.Encoding)
	switch encoding {
	case "Identity-H", "Identity-V":
		if len(raw)%2 == 0 {
			text := decodeUTF16BigEndian(raw)
			return text, text != ""
		}
	case "UniGB-UTF16-H", "UniGB-UTF16-V":
		if len(raw)%2 == 0 {
			text := decodeUTF16BigEndian(raw)
			return text, text != ""
		}
	case "WinAnsiEncoding", "MacRomanEncoding", "":
		if len(raw) == 0 {
			return "", false
		}
		if font.BaseFont != "" && strings.Contains(strings.ToLower(font.BaseFont), "identity") && len(raw)%2 == 0 {
			text := decodeUTF16BigEndian(raw)
			return text, text != ""
		}
		return string(raw), true
	}
	if strings.Contains(strings.ToUpper(encoding), "UTF16") && len(raw)%2 == 0 {
		text := decodeUTF16BigEndian(raw)
		return text, text != ""
	}
	return "", false
}

func decodeBytesWithToUnicode(raw []byte, font pdfFontMap) string {
	if len(font.CodeLengths) == 0 {
		return ""
	}
	var builder strings.Builder
	for index := 0; index < len(raw); {
		matched := false
		for _, codeLen := range font.CodeLengths {
			if index+codeLen > len(raw) {
				continue
			}
			key := strings.ToUpper(fmt.Sprintf("%X", raw[index:index+codeLen]))
			if value, ok := font.ToUnicode[key]; ok {
				builder.WriteString(value)
				index += codeLen
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		return ""
	}
	return builder.String()
}

func looksReadableText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	runes := []rune(trimmed)
	readable := 0
	for _, r := range runes {
		if r == '\n' || r == '\t' || (r >= 32 && r != utf8.RuneError) {
			readable++
		}
	}
	return readable*100/len(runes) >= 80
}

func looksBinaryBytes(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	binaryish := 0
	for _, value := range raw {
		if value == 0 || value > 0xF4 {
			binaryish++
		}
	}
	return binaryish*3 >= len(raw)
}

func decodePDFString(raw string) string {
	var builder strings.Builder
	escaped := false
	octal := strings.Builder{}
	flushOctal := func() {
		if octal.Len() == 0 {
			return
		}
		value, err := strconv.ParseInt(octal.String(), 8, 32)
		if err == nil {
			builder.WriteByte(byte(value))
		}
		octal.Reset()
	}
	for _, r := range raw {
		if octal.Len() > 0 && (r < '0' || r > '7' || octal.Len() == 3) {
			flushOctal()
		}
		if escaped {
			switch r {
			case 'n':
				builder.WriteByte('\n')
			case 'r':
			case 't':
				builder.WriteByte('\t')
			case 'b':
				builder.WriteByte('\b')
			case 'f':
				builder.WriteByte('\f')
			case '(', ')', '\\':
				builder.WriteRune(r)
			default:
				if r >= '0' && r <= '7' {
					octal.WriteRune(r)
				} else {
					builder.WriteRune(r)
				}
			}
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		builder.WriteRune(r)
	}
	flushOctal()
	return builder.String()
}

func readPDFLiteralStringBytes(content string, start int) ([]byte, int) {
	depth := 0
	escaped := false
	out := make([]byte, 0)
	octal := strings.Builder{}
	flushOctal := func() {
		if octal.Len() == 0 {
			return
		}
		value, err := strconv.ParseInt(octal.String(), 8, 32)
		if err == nil {
			out = append(out, byte(value))
		}
		octal.Reset()
	}
	for index := start; index < len(content); index++ {
		ch := content[index]
		if escaped {
			switch ch {
			case 'n':
				out = append(out, '\n')
			case 'r':
			case 't':
				out = append(out, '\t')
			case 'b':
				out = append(out, '\b')
			case 'f':
				out = append(out, '\f')
			case '(', ')', '\\':
				out = append(out, ch)
			default:
				if ch >= '0' && ch <= '7' {
					octal.WriteByte(ch)
				} else {
					out = append(out, ch)
				}
			}
			escaped = false
			continue
		}
		if octal.Len() > 0 && (ch < '0' || ch > '7' || octal.Len() == 3) {
			flushOctal()
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == '(' {
			depth++
			if depth > 1 {
				out = append(out, ch)
			}
			continue
		}
		if ch == ')' {
			depth--
			if depth == 0 {
				flushOctal()
				return out, index
			}
		}
		if depth >= 1 {
			out = append(out, ch)
		}
	}
	flushOctal()
	return out, len(content) - 1
}

func readPDFHexStringBytes(content string, start int) ([]byte, int) {
	end := strings.IndexByte(content[start+1:], '>')
	if end < 0 {
		return nil, len(content) - 1
	}
	raw := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			return -1
		}
		return r
	}, content[start+1:start+1+end])
	if len(raw)%2 == 1 {
		raw += "0"
	}
	data := make([]byte, 0, len(raw)/2)
	for index := 0; index+1 < len(raw); index += 2 {
		value, err := strconv.ParseUint(raw[index:index+2], 16, 8)
		if err == nil {
			data = append(data, byte(value))
		}
	}
	return data, start + end + 1
}

func extractPDFTextLiterals(content string) []string {
	parts := make([]string, 0)
	for index := 0; index < len(content); index++ {
		switch content[index] {
		case '(':
			value, next := readPDFLiteralString(content, index)
			index = next
			if value != "" {
				parts = append(parts, normalizeText(value))
			}
		case '<':
			if index+1 < len(content) && content[index+1] != '<' {
				value, next := readPDFHexString(content, index)
				index = next
				if value != "" {
					parts = append(parts, normalizeText(value))
				}
			}
		}
	}
	return parts
}

func extractLegacyXLSHeuristicText(raw []byte) string {
	parts := make([]string, 0, 256)
	seen := map[string]struct{}{}
	appendPart := func(value string) {
		value = normalizeText(value)
		if value == "" {
			return
		}
		if utf8.RuneCountInString(value) < 2 {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		parts = append(parts, value)
	}

	for _, value := range extractUTF16LEPrintableStrings(raw) {
		appendPart(value)
	}
	for _, value := range extractASCIIPrintableStrings(raw) {
		appendPart(value)
	}
	return strings.Join(parts, "\n")
}

func extractUTF16LEPrintableStrings(raw []byte) []string {
	values := make([]string, 0)
	buffer := make([]rune, 0, 32)
	flush := func() {
		if len(buffer) >= 2 {
			values = append(values, string(buffer))
		}
		buffer = buffer[:0]
	}
	for index := 0; index+1 < len(raw); index += 2 {
		code := uint16(raw[index]) | uint16(raw[index+1])<<8
		if code == 0 {
			flush()
			continue
		}
		r := rune(code)
		if isLikelySpreadsheetRune(r) {
			buffer = append(buffer, r)
			continue
		}
		flush()
	}
	flush()
	return values
}

func extractASCIIPrintableStrings(raw []byte) []string {
	values := make([]string, 0)
	buffer := make([]byte, 0, 32)
	flush := func() {
		if len(buffer) >= 3 {
			values = append(values, string(buffer))
		}
		buffer = buffer[:0]
	}
	for _, b := range raw {
		if b >= 32 && b <= 126 {
			buffer = append(buffer, b)
			continue
		}
		flush()
	}
	flush()
	return values
}

func isLikelySpreadsheetRune(r rune) bool {
	switch {
	case r == '\n' || r == '\t' || r == '\r':
		return true
	case r >= 0x20 && r <= 0x7E:
		return true
	case r >= 0x4E00 && r <= 0x9FFF:
		return true
	case r >= 0x3000 && r <= 0x303F:
		return true
	case r >= 0xFF00 && r <= 0xFFEF:
		return true
	default:
		return false
	}
}

func readPDFLiteralString(content string, start int) (string, int) {
	depth := 0
	escaped := false
	var builder strings.Builder
	for index := start; index < len(content); index++ {
		ch := content[index]
		if escaped {
			builder.WriteByte(ch)
			escaped = false
			continue
		}
		if ch == '\\' {
			builder.WriteByte(ch)
			escaped = true
			continue
		}
		if ch == '(' {
			depth++
			if depth > 1 {
				builder.WriteByte(ch)
			}
			continue
		}
		if ch == ')' {
			depth--
			if depth == 0 {
				return decodePDFString(builder.String()), index
			}
		}
		if depth >= 1 {
			builder.WriteByte(ch)
		}
	}
	return decodePDFString(builder.String()), len(content) - 1
}

func readPDFHexString(content string, start int) (string, int) {
	end := strings.IndexByte(content[start+1:], '>')
	if end < 0 {
		return "", len(content) - 1
	}
	raw := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			return -1
		}
		return r
	}, content[start+1:start+1+end])
	if len(raw)%2 == 1 {
		raw += "0"
	}
	data := make([]byte, 0, len(raw)/2)
	for index := 0; index+1 < len(raw); index += 2 {
		value, err := strconv.ParseUint(raw[index:index+2], 16, 8)
		if err == nil {
			data = append(data, byte(value))
		}
	}
	return decodePDFUTF16(data), start + end + 1
}

func readZipEntry(raw []byte, target string) []byte {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil
	}
	for _, file := range reader.File {
		if file.Name != target {
			continue
		}
		handle, err := file.Open()
		if err != nil {
			return nil
		}
		defer handle.Close()
		content, err := io.ReadAll(handle)
		if err != nil {
			return nil
		}
		return content
	}
	return nil
}

func zipEntries(reader *zip.Reader) map[string][]byte {
	entries := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		handle, err := file.Open()
		if err != nil {
			continue
		}
		content, err := io.ReadAll(handle)
		handle.Close()
		if err != nil {
			continue
		}
		entries[file.Name] = content
	}
	return entries
}

func parseRelationships(raw []byte) map[string]string {
	relations := map[string]string{}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return relations
		}
		element, ok := token.(xml.StartElement)
		if !ok || element.Name.Local != "Relationship" {
			continue
		}
		relations[attrValue(element, "Id")] = attrValue(element, "Target")
	}
	return relations
}

func attrValue(element xml.StartElement, localName string) string {
	for _, attr := range element.Attr {
		if attr.Name.Local == localName {
			return attr.Value
		}
	}
	return ""
}

func parseOptionalInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func isXMLBoolTrue(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "1" || normalized == "true"
}

func readElementText(decoder *xml.Decoder) string {
	var builder strings.Builder
	for {
		token, err := decoder.Token()
		if err != nil {
			return builder.String()
		}
		switch value := token.(type) {
		case xml.CharData:
			builder.Write([]byte(value))
		case xml.EndElement:
			return builder.String()
		case xml.StartElement:
			builder.WriteString(readElementText(decoder))
		}
	}
}

func docxTitleLevel(style string, text string) int {
	style = strings.ToLower(strings.TrimSpace(style))
	switch style {
	case "heading1", "1":
		return 1
	case "heading2", "2":
		return 2
	case "heading3", "3":
		return 3
	}
	if isLikelyTitle(text) {
		return inferTitleLevel(text)
	}
	return 0
}

func rowsToText(rows [][]string) string {
	lines := make([]string, 0, len(rows))
	for _, row := range normalizeRows(rows) {
		line := strings.TrimSpace(strings.Join(row, " | "))
		if line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

func normalizeRows(rows [][]string) [][]string {
	width := maxRowWidth(rows)
	out := make([][]string, 0, len(rows))
	for _, row := range rows {
		normalized := make([]string, width)
		for index := 0; index < width; index++ {
			if index < len(row) {
				normalized[index] = normalizeText(row[index])
			}
		}
		if strings.TrimSpace(strings.Join(normalized, "")) != "" {
			out = append(out, normalized)
		}
	}
	return out
}

func compactRows(rowsByIndex map[int]map[int]string) [][]string {
	if len(rowsByIndex) == 0 {
		return nil
	}
	rowIndexes := make([]int, 0, len(rowsByIndex))
	maxCol := 0
	for rowIndex, row := range rowsByIndex {
		rowIndexes = append(rowIndexes, rowIndex)
		for colIndex := range row {
			if colIndex > maxCol {
				maxCol = colIndex
			}
		}
	}
	sort.Ints(rowIndexes)
	rows := make([][]string, 0, len(rowIndexes))
	for _, rowIndex := range rowIndexes {
		row := make([]string, maxCol+1)
		for colIndex, value := range rowsByIndex[rowIndex] {
			row[colIndex] = normalizeText(value)
		}
		rows = append(rows, row)
	}
	return normalizeRows(rows)
}

func parseCellRef(ref string) (int, int) {
	ref = strings.ToUpper(strings.TrimSpace(ref))
	if ref == "" {
		return -1, -1
	}
	col := 0
	index := 0
	for index < len(ref) && ref[index] >= 'A' && ref[index] <= 'Z' {
		col = col*26 + int(ref[index]-'A'+1)
		index++
	}
	if col == 0 {
		return -1, -1
	}
	row, err := strconv.Atoi(ref[index:])
	if err != nil || row <= 0 {
		return -1, -1
	}
	return row - 1, col - 1
}

func parseCellRangeRef(ref string) (int, int, int, int, bool) {
	parts := strings.Split(strings.TrimSpace(ref), ":")
	if len(parts) == 1 {
		row, col := parseCellRef(parts[0])
		if row < 0 || col < 0 {
			return 0, 0, 0, 0, false
		}
		return row, col, row, col, true
	}
	if len(parts) != 2 {
		return 0, 0, 0, 0, false
	}
	startRow, startCol := parseCellRef(parts[0])
	endRow, endCol := parseCellRef(parts[1])
	if startRow < 0 || startCol < 0 || endRow < 0 || endCol < 0 {
		return 0, 0, 0, 0, false
	}
	return startRow, startCol, endRow, endCol, true
}

func applyXLSXMergeSpans(cellsByCoord map[string]*structuredCell, mergeRanges []string) {
	for _, mergeRange := range mergeRanges {
		startRow, startCol, endRow, endCol, ok := parseCellRangeRef(mergeRange)
		if !ok {
			continue
		}
		anchorRef := fmt.Sprintf("%s%d", excelColumnName(startCol), startRow+1)
		anchor := cellsByCoord[anchorRef]
		if anchor == nil {
			for rowIndex := startRow; rowIndex <= endRow && anchor == nil; rowIndex++ {
				for colIndex := startCol; colIndex <= endCol; colIndex++ {
					if candidate := cellsByCoord[xlsxCellCoordRef(rowIndex, colIndex)]; candidate != nil {
						copied := *candidate
						copied.RowIndex = startRow
						copied.ColIndex = startCol
						copied.SourceRef = formatXLSXSourceRef(extractSheetNameFromSourceRef(candidate.SourceRef), startRow, startCol)
						cellsByCoord[anchorRef] = &copied
						anchor = cellsByCoord[anchorRef]
						break
					}
				}
			}
		}
		if anchor == nil {
			continue
		}
		anchor.RowSpan = max(1, endRow-startRow+1)
		anchor.ColSpan = max(1, endCol-startCol+1)
		for rowIndex := startRow; rowIndex <= endRow; rowIndex++ {
			for colIndex := startCol; colIndex <= endCol; colIndex++ {
				coordRef := xlsxCellCoordRef(rowIndex, colIndex)
				if coordRef == anchorRef {
					continue
				}
				delete(cellsByCoord, coordRef)
			}
		}
	}
}

func flattenStructuredCells(cellsByCoord map[string]*structuredCell) []structuredCell {
	cells := make([]structuredCell, 0, len(cellsByCoord))
	for _, cell := range cellsByCoord {
		if cell == nil {
			continue
		}
		cells = append(cells, *cell)
	}
	sort.Slice(cells, func(i, j int) bool {
		if cells[i].RowIndex != cells[j].RowIndex {
			return cells[i].RowIndex < cells[j].RowIndex
		}
		return cells[i].ColIndex < cells[j].ColIndex
	})
	return cells
}

func formatXLSXSourceRef(sheetName string, rowIndex int, colIndex int) string {
	sheetName = strings.TrimSpace(sheetName)
	if sheetName == "" {
		sheetName = "Sheet"
	}
	return fmt.Sprintf("工作表[%s]/单元格%s%d", sheetName, excelColumnName(colIndex), rowIndex+1)
}

func xlsxCellCoordRef(rowIndex int, colIndex int) string {
	return fmt.Sprintf("%s%d", excelColumnName(colIndex), rowIndex+1)
}

func extractSheetNameFromSourceRef(sourceRef string) string {
	prefix := "工作表["
	start := strings.Index(sourceRef, prefix)
	if start < 0 {
		return ""
	}
	start += len(prefix)
	end := strings.Index(sourceRef[start:], "]")
	if end < 0 {
		return ""
	}
	return sourceRef[start : start+end]
}

func cellRef(prefix string, rowIndex int, colIndex int) string {
	return fmt.Sprintf("%s!%s%d", prefix, excelColumnName(colIndex), rowIndex+1)
}

func excelColumnName(index int) string {
	if index < 0 {
		return "A"
	}
	out := ""
	for index >= 0 {
		out = string(rune('A'+(index%26))) + out
		index = index/26 - 1
	}
	return out
}

func inferHeaderRowCount(rows [][]string) int {
	if len(rows) == 0 {
		return 0
	}
	nonEmpty := 0
	for _, value := range rows[0] {
		if strings.TrimSpace(value) != "" {
			nonEmpty++
		}
	}
	if nonEmpty >= max(1, len(rows[0])/2) {
		return 1
	}
	return 0
}

func mustJSON(value any) json.RawMessage {
	raw, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return raw
}

func decodePDFUTF16(data []byte) string {
	if len(data) >= 2 {
		if data[0] == 0xFE && data[1] == 0xFF {
			u16 := make([]uint16, 0, (len(data)-2)/2)
			for index := 2; index+1 < len(data); index += 2 {
				u16 = append(u16, uint16(data[index])<<8|uint16(data[index+1]))
			}
			return string(utf16.Decode(u16))
		}
		if data[0] == 0xFF && data[1] == 0xFE {
			u16 := make([]uint16, 0, (len(data)-2)/2)
			for index := 2; index+1 < len(data); index += 2 {
				u16 = append(u16, uint16(data[index+1])<<8|uint16(data[index]))
			}
			return string(utf16.Decode(u16))
		}
	}
	return string(data)
}

func splitParagraphs(text string) []string {
	chunks := strings.Split(text, "\n\n")
	out := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		trimmed := strings.TrimSpace(chunk)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 && strings.TrimSpace(text) != "" {
		return []string{strings.TrimSpace(text)}
	}
	return out
}

func normalizeText(raw string) string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	lines := strings.Split(raw, "\n")
	normalized := make([]string, 0, len(lines))
	lastBlank := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(sanitizeTextLine(line))
		if containsArchiveHeaderArtifacts(trimmed) {
			continue
		}
		if trimmed == "" {
			if !lastBlank {
				normalized = append(normalized, "")
			}
			lastBlank = true
			continue
		}
		normalized = append(normalized, trimmed)
		lastBlank = false
	}
	return strings.TrimSpace(strings.Join(normalized, "\n"))
}

func sanitizeTextLine(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(raw))
	for _, value := range raw {
		if value == utf8.RuneError || value == '�' {
			continue
		}
		if value < 32 && value != '\n' && value != '\t' && value != '\r' {
			continue
		}
		builder.WriteRune(value)
	}
	return builder.String()
}

func isLikelyTitle(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || len([]rune(trimmed)) > 40 {
		return false
	}
	if strings.HasPrefix(trimmed, "第") && strings.Contains(trimmed, "章") {
		return true
	}
	for _, prefix := range []string{"一、", "二、", "三、", "四、", "五、", "（一）", "（二）", "（三）", "1.", "1、"} {
		if strings.HasPrefix(trimmed, prefix) {
			return true
		}
	}
	return false
}

func inferTitleLevel(text string) int {
	trimmed := strings.TrimSpace(text)
	if strings.HasPrefix(trimmed, "第") && strings.Contains(trimmed, "章") {
		return 1
	}
	if strings.HasPrefix(trimmed, "一、") || strings.HasPrefix(trimmed, "二、") || strings.HasPrefix(trimmed, "三、") {
		return 1
	}
	if strings.HasPrefix(trimmed, "（一）") || strings.HasPrefix(trimmed, "（二）") || strings.HasPrefix(trimmed, "（三）") {
		return 2
	}
	return 3
}

func maxRowWidth(rows [][]string) int {
	width := 0
	for _, row := range rows {
		if len(row) > width {
			width = len(row)
		}
	}
	if width <= 0 {
		return 1
	}
	return width
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
