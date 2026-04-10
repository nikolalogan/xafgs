package service

import (
	"bytes"
	"compress/flate"
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"regexp"
	"strconv"
	"strings"

	"sxfgssever/server/internal/model"
)

const maxDocumentParseBytes int64 = 20 * 1024 * 1024

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
}

type ParsedDocument struct {
	Version        model.FileVersionDTO
	Profile        DocumentProfile
	Slices         []model.DocumentSlice
	Tables         []model.DocumentTable
	TableFragments []model.DocumentTableFragment
	TableCells     []model.DocumentTableCell
}

type DocumentParseService interface {
	ParseCaseFile(ctx context.Context, caseFile model.ReportCaseFile) (ParsedDocument, *model.APIError)
}

type documentParseService struct {
	fileService FileService
	ocrProvider OCRProvider
}

func NewDocumentParseService(fileService FileService, ocrProvider OCRProvider) DocumentParseService {
	return &documentParseService{
		fileService: fileService,
		ocrProvider: ocrProvider,
	}
}

func (service *documentParseService) ParseCaseFile(ctx context.Context, caseFile model.ReportCaseFile) (ParsedDocument, *model.APIError) {
	version, raw, apiError := service.fileService.ReadReferenceContent(ctx, caseFile.FileID, caseFile.VersionNo, maxDocumentParseBytes)
	if apiError != nil {
		return ParsedDocument{}, apiError
	}

	profile := buildDocumentProfile(version, raw)
	switch profile.FileType {
	case "text", "json":
		slices := buildTextSlices(caseFile, version, string(raw), profile)
		tables, fragments, cells := buildDelimitedTables(caseFile, version, string(raw), profile, ',')
		return ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}, nil
	case "csv":
		text := string(raw)
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := buildDelimitedTables(caseFile, version, text, profile, ',')
		return ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}, nil
	case "tsv":
		text := string(raw)
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := buildDelimitedTables(caseFile, version, text, profile, '\t')
		return ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}, nil
	case "pdf":
		if profile.OCRRequired {
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		text := extractPDFText(raw)
		slices := buildTextSlices(caseFile, version, text, profile)
		tables, fragments, cells := detectPipeTables(caseFile, version, text, profile)
		return ParsedDocument{Version: version, Profile: profile, Slices: slices, Tables: tables, TableFragments: fragments, TableCells: cells}, nil
	default:
		if profile.OCRRequired {
			return ParsedDocument{
				Version: version,
				Profile: profile,
				Slices:  buildScannedPageSlices(caseFile, version, profile),
			}, nil
		}
		text := strings.TrimSpace(string(raw))
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
		return ParsedDocument{
			Version: version,
			Profile: profile,
			Slices:  buildTextSlices(caseFile, version, text, profile),
		}, nil
	}
}

func buildDocumentProfile(version model.FileVersionDTO, raw []byte) DocumentProfile {
	fileType := detectDocumentType(version)
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
		pageCount = detectPDFPageCount(raw)
		text := strings.TrimSpace(extractPDFText(raw))
		hasTextLayer = text != ""
		if pageCount <= 0 {
			pageCount = 1
		}
		textDensity = float64(len([]rune(text))) / float64(pageCount)
		if !hasTextLayer || textDensity < 24 {
			isScannedSuspected = true
			ocrRequired = true
			parseStrategy = "needs_ocr"
			sourceType = model.DocumentSourceTypeBinary
		} else {
			parseStrategy = "pdf_text_layer"
			sourceType = model.DocumentSourceTypeTextLayer
		}
	case "csv":
		parseStrategy = "delimited_table"
	case "tsv":
		parseStrategy = "delimited_table"
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

func detectDocumentType(version model.FileVersionDTO) string {
	mimeType := strings.ToLower(strings.TrimSpace(version.MimeType))
	name := strings.ToLower(strings.TrimSpace(version.OriginName))
	switch {
	case strings.Contains(mimeType, "application/pdf") || strings.HasSuffix(name, ".pdf"):
		return "pdf"
	case strings.HasPrefix(mimeType, "image/") || strings.HasSuffix(name, ".png") || strings.HasSuffix(name, ".jpg") || strings.HasSuffix(name, ".jpeg"):
		return "image"
	case strings.Contains(mimeType, "text/csv") || strings.HasSuffix(name, ".csv"):
		return "csv"
	case strings.Contains(mimeType, "tab-separated-values") || strings.HasSuffix(name, ".tsv"):
		return "tsv"
	case strings.Contains(mimeType, "application/json") || strings.HasSuffix(name, ".json"):
		return "json"
	case strings.HasPrefix(mimeType, "text/") || strings.HasSuffix(name, ".txt") || strings.HasSuffix(name, ".md"):
		return "text"
	default:
		return "binary"
	}
}

func detectPDFPageCount(raw []byte) int {
	pageCount := len(regexp.MustCompile(`/Type\s*/Page([^s]|$)`).FindAll(raw, -1))
	if pageCount <= 0 {
		return 1
	}
	return pageCount
}

func extractPDFText(raw []byte) string {
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
		part := extractTextOperators(string(body))
		if strings.TrimSpace(part) != "" {
			textParts = append(textParts, part)
		}
	}
	return normalizeText(strings.Join(textParts, "\n"))
}

func inflatePDFStream(raw []byte) ([]byte, error) {
	reader := flate.NewReader(bytes.NewReader(raw))
	defer reader.Close()
	return io.ReadAll(reader)
}

func extractTextOperators(content string) string {
	singlePattern := regexp.MustCompile(`\(([^()]*(?:\\.[^()]*)*)\)\s*Tj`)
	arrayPattern := regexp.MustCompile(`\[(.*?)\]\s*TJ`)
	parts := make([]string, 0)
	for _, match := range singlePattern.FindAllStringSubmatch(content, -1) {
		if len(match) > 1 {
			parts = append(parts, decodePDFString(match[1]))
		}
	}
	for _, match := range arrayPattern.FindAllStringSubmatch(content, -1) {
		if len(match) <= 1 {
			continue
		}
		inner := match[1]
		for _, nested := range singlePattern.FindAllStringSubmatch(inner, -1) {
			if len(nested) > 1 {
				parts = append(parts, decodePDFString(nested[1]))
			}
		}
	}
	return strings.Join(parts, "\n")
}

func decodePDFString(raw string) string {
	replacer := strings.NewReplacer(`\(`, "(", `\)`, ")", `\\`, `\`, `\n`, "\n", `\r`, "", `\t`, "\t")
	return replacer.Replace(raw)
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
		trimmed := strings.TrimSpace(line)
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
