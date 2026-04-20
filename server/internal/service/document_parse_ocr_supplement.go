package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"sxfgssever/server/internal/model"
)

func (service *documentParseService) applyOCRSupplementIfNeeded(ctx context.Context, caseFile model.ReportCaseFile, version model.FileVersionDTO, raw []byte, parsed ParsedDocument) ParsedDocument {
	if service.ocrTaskService == nil {
		return parsed
	}
	if !requiresGlobalImageOCR(parsed.Profile.FileType) {
		return parsed
	}

	task, taskError := service.ocrTaskService.EnsureTask(ctx, version, raw, parsed.Profile)
	if taskError != nil {
		parsed.Profile.ParseStrategy = "image_ocr_task_error"
		parsed.Profile.OCRSkipReason = "image_ocr_task_error"
		return parsed
	}
	parsed.OCRTask = &task
	switch task.Status {
	case model.OCRTaskStatusPending, model.OCRTaskStatusRunning:
		parsed.Profile.OCRRequired = true
		parsed.Profile.ParseStrategy = "image_ocr_pending"
		parsed.Profile.OCRSkipReason = "image_ocr_pending"
		return parsed
	case model.OCRTaskStatusFailed, model.OCRTaskStatusCancelled:
		parsed.Profile.ParseStrategy = "image_ocr_failed"
		parsed.Profile.OCRSkipReason = normalizeOCRTaskFailureReason(task)
		return parsed
	}

	ocrResult, ok := parseOCRTaskResult(task)
	if !ok {
		parsed.Profile.ParseStrategy = "image_ocr_result_invalid"
		parsed.Profile.OCRSkipReason = "image_ocr_result_invalid"
		return parsed
	}

	switch strings.ToLower(strings.TrimSpace(parsed.Profile.FileType)) {
	case "pdf":
		merged, appendCount := appendOCRSupplementsAfterTextSlices(caseFile, version, parsed.Slices, collectPDFImageSupplements(parsed, ocrResult.Pages), "pdf_image_region")
		parsed.Slices = merged
		parsed.Profile.ImageOCRApplied = appendCount > 0
		parsed.Profile.ImageOCRAppendCount = appendCount
	case "docx":
		merged, appendCount := appendOCRSupplementsAfterTextSlices(caseFile, version, parsed.Slices, collectDOCXImageSupplements(parsed, ocrResult.Pages), "docx_image_region")
		parsed.Slices = merged
		parsed.Profile.ImageOCRApplied = appendCount > 0
		parsed.Profile.ImageOCRAppendCount = appendCount
	}

	parsed.Tables, parsed.TableFragments, parsed.TableCells = mergeOCRTables(caseFile, version, parsed.Profile, parsed.Tables, parsed.TableFragments, parsed.TableCells, ocrResult.Pages)
	return parsed
}

func requiresGlobalImageOCR(fileType string) bool {
	switch strings.TrimSpace(strings.ToLower(fileType)) {
	case "pdf", "docx":
		return true
	default:
		return false
	}
}

func hasUnreadableOrMissingSlices(slices []model.DocumentSlice) bool {
	for _, slice := range slices {
		text := strings.TrimSpace(slice.CleanText)
		if text == "" {
			text = strings.TrimSpace(slice.RawText)
		}
		if text == "" || hasUnreadableText(text) {
			return true
		}
	}
	return false
}

func normalizeOCRTaskFailureReason(task model.OCRTask) string {
	errorMessage := strings.TrimSpace(task.ErrorMessage)
	if errorMessage == "" {
		errorMessage = "ocr_task_failed"
	}
	return "image_ocr_failed: " + errorMessage
}

func parseOCRTaskResult(task model.OCRTask) (OCRTaskResult, bool) {
	if len(task.ResultPayloadJSON) == 0 || string(task.ResultPayloadJSON) == "null" {
		return OCRTaskResult{}, false
	}
	var result OCRTaskResult
	if err := json.Unmarshal(task.ResultPayloadJSON, &result); err != nil {
		return OCRTaskResult{}, false
	}
	return result, len(result.Pages) > 0
}

func mergeSlicesWithOCRSupplements(caseFile model.ReportCaseFile, version model.FileVersionDTO, original []model.DocumentSlice, pages []OCRResultPage) []model.DocumentSlice {
	supplements := collectOCRSupplements(pages)
	if len(supplements) == 0 {
		return original
	}

	unreadableIndexByPage := map[int]int{}
	lastSliceIndexByPage := map[int]int{}
	for index, slice := range original {
		page := normalizedSlicePage(slice)
		lastSliceIndexByPage[page] = index
		if _, exists := unreadableIndexByPage[page]; exists {
			continue
		}
		text := strings.TrimSpace(slice.CleanText)
		if text == "" {
			text = strings.TrimSpace(slice.RawText)
		}
		if text == "" || hasUnreadableText(text) {
			unreadableIndexByPage[page] = index
		}
	}

	out := make([]model.DocumentSlice, 0, len(original)+len(supplements))
	insertedPages := map[int]bool{}
	for index, slice := range original {
		out = append(out, slice)
		page := normalizedSlicePage(slice)
		if insertedPages[page] {
			continue
		}
		targetIndex, ok := unreadableIndexByPage[page]
		if !ok || targetIndex != index {
			continue
		}
		supplementText := strings.TrimSpace(supplements[page])
		if supplementText == "" {
			continue
		}
		out = append(out, buildOCRSupplementSlice(caseFile, version, page, supplementText, "nearby_unreadable"))
		insertedPages[page] = true
	}

	remaining := make([]int, 0)
	for page := range supplements {
		if insertedPages[page] {
			continue
		}
		remaining = append(remaining, page)
	}
	sort.Ints(remaining)
	for _, page := range remaining {
		supplementText := strings.TrimSpace(supplements[page])
		if supplementText == "" {
			continue
		}
		reason := "fallback_nearby"
		if _, ok := lastSliceIndexByPage[page]; !ok {
			reason = "fallback_append"
		}
		out = append(out, buildOCRSupplementSlice(caseFile, version, page, supplementText, reason))
	}

	return out
}

func appendOCRSupplementsAfterTextSlices(caseFile model.ReportCaseFile, version model.FileVersionDTO, original []model.DocumentSlice, supplements map[int]string, reason string) ([]model.DocumentSlice, int) {
	if len(supplements) == 0 {
		return original, 0
	}
	out := make([]model.DocumentSlice, 0, len(original)+len(supplements))
	out = append(out, original...)
	pageNos := make([]int, 0, len(supplements))
	for pageNo := range supplements {
		pageNos = append(pageNos, pageNo)
	}
	sort.Ints(pageNos)
	appendCount := 0
	for _, pageNo := range pageNos {
		supplementText := strings.TrimSpace(supplements[pageNo])
		if supplementText == "" {
			continue
		}
		out = append(out, buildOCRSupplementSlice(caseFile, version, pageNo, supplementText, reason))
		appendCount++
	}
	return out, appendCount
}

func collectOCRSupplements(pages []OCRResultPage) map[int]string {
	out := make(map[int]string, len(pages))
	for _, page := range pages {
		segments := make([]string, 0, 1+len(page.Blocks))
		pageText := normalizeText(page.Text)
		if pageText != "" {
			segments = append(segments, pageText)
		}
		for _, block := range page.Blocks {
			blockText := normalizeText(block.Text)
			if blockText == "" {
				continue
			}
			if pageText != "" && blockText == pageText {
				continue
			}
			segments = append(segments, blockText)
		}
		merged := dedupAndJoinLines(segments)
		if merged == "" {
			continue
		}
		out[max(1, page.PageNo)] = merged
	}
	return out
}

func collectPDFImageSupplements(parsed ParsedDocument, pages []OCRResultPage) map[int]string {
	figureRegionsByPage := buildFigureRegionsByPage(parsed.Figures)
	existingLines := buildExistingLineSet(parsed.Slices)
	out := make(map[int]string, len(pages))
	for _, page := range pages {
		pageNo := max(1, page.PageNo)
		regions := figureRegionsByPage[pageNo]
		segments := make([]string, 0)
		for _, block := range page.Blocks {
			text := normalizeText(block.Text)
			if text == "" {
				continue
			}
			if len(regions) > 0 && !ocrBBoxOverlapsAnyRegion(block.BBox, regions) {
				continue
			}
			segments = append(segments, text)
		}
		merged := dedupAndJoinLines(dropExistingLines(segments, existingLines))
		if merged != "" {
			out[pageNo] = merged
		}
	}
	return out
}

func collectDOCXImageSupplements(parsed ParsedDocument, pages []OCRResultPage) map[int]string {
	existingLines := buildExistingLineSet(parsed.Slices)
	out := make(map[int]string, len(pages))
	for _, page := range pages {
		segments := make([]string, 0, len(page.Blocks))
		for _, block := range page.Blocks {
			if text := normalizeText(block.Text); text != "" {
				segments = append(segments, text)
			}
		}
		merged := dedupAndJoinLines(dropExistingLines(segments, existingLines))
		if merged != "" {
			out[max(1, page.PageNo)] = merged
		}
	}
	return out
}

func dropExistingLines(parts []string, existing map[string]bool) []string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized := normalizeText(part)
		if normalized == "" {
			continue
		}
		if existing[normalized] {
			continue
		}
		out = append(out, normalized)
	}
	return out
}

func buildExistingLineSet(slices []model.DocumentSlice) map[string]bool {
	out := map[string]bool{}
	for _, slice := range slices {
		for _, text := range []string{slice.CleanText, slice.RawText} {
			for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
				line = normalizeText(line)
				if line == "" {
					continue
				}
				out[line] = true
			}
			normalized := normalizeText(text)
			if normalized != "" {
				out[normalized] = true
			}
		}
	}
	return out
}

func buildFigureRegionsByPage(figures []model.DocumentFigureCandidate) map[int][]pdfLayoutBBox {
	out := map[int][]pdfLayoutBBox{}
	for _, figure := range figures {
		pageNo := max(1, figure.PageNo)
		bbox := parseBBoxFromRawJSON(figure.BBoxJSON)
		if bbox == (pdfLayoutBBox{}) {
			continue
		}
		out[pageNo] = append(out[pageNo], bbox)
	}
	return out
}

func parseBBoxFromRawJSON(raw json.RawMessage) pdfLayoutBBox {
	if len(raw) == 0 || string(raw) == "null" {
		return pdfLayoutBBox{}
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return pdfLayoutBBox{}
	}
	if nested, ok := payload["bbox"]; ok {
		return parseBBoxFromAny(nested)
	}
	return parseBBoxFromAny(payload)
}

func parseBBoxFromAny(value any) pdfLayoutBBox {
	switch typed := value.(type) {
	case map[string]any:
		return pdfLayoutBBox{
			XMin: toFloat(typed["xMin"]),
			YMin: toFloat(typed["yMin"]),
			XMax: toFloat(typed["xMax"]),
			YMax: toFloat(typed["yMax"]),
		}
	case []any:
		values := make([]float64, 0, len(typed))
		for _, item := range typed {
			values = append(values, toFloat(item))
		}
		if len(values) >= 4 {
			return bboxFromArray(values[:4])
		}
	}
	return pdfLayoutBBox{}
}

func toFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		if parsed, err := typed.Float64(); err == nil {
			return parsed
		}
	case string:
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
			return parsed
		}
	}
	return 0
}

func ocrBBoxOverlapsAnyRegion(rawBBox []float64, regions []pdfLayoutBBox) bool {
	if len(regions) == 0 {
		return false
	}
	target := bboxFromArray(rawBBox)
	if target == (pdfLayoutBBox{}) {
		return false
	}
	for _, region := range regions {
		if bboxIntersectionArea(target, region) > 0 {
			return true
		}
		if bboxContains(region, target) || bboxContains(target, region) {
			return true
		}
	}
	return false
}

func mergeOCRTables(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, existingTables []model.DocumentTable, existingFragments []model.DocumentTableFragment, existingCells []model.DocumentTableCell, pages []OCRResultPage) ([]model.DocumentTable, []model.DocumentTableFragment, []model.DocumentTableCell) {
	combinedTables := append([]model.DocumentTable{}, existingTables...)
	combinedFragments := append([]model.DocumentTableFragment{}, existingFragments...)
	combinedCells := append([]model.DocumentTableCell{}, existingCells...)

	nextVirtualID := int64(-1)
	for _, table := range combinedTables {
		if table.ID <= nextVirtualID {
			nextVirtualID = table.ID - 1
		}
	}
	existingFingerprints := buildExistingTableFingerprints(existingTables, existingCells)

	for _, page := range pages {
		pageNo := max(1, page.PageNo)
		for _, table := range page.Tables {
			repairedCells, _ := repairOCRTableCells(table.Cells)
			if len(repairedCells) == 0 {
				repairedCells = table.Cells
			}
			rows := normalizeRows(table.Rows)
			if len(repairedCells) > 0 {
				rows = rowsFromOCRCellsWithMergedMarker(repairedCells, defaultMergedMarker)
			} else if len(rows) == 0 && len(table.Cells) > 0 {
				rows = rowsFromOCRCells(table.Cells)
			}
			richCells := make([]structuredCell, 0, len(repairedCells))
			for _, cell := range repairedCells {
				normalized := normalizeText(cell.Text)
				if normalized == "" {
					continue
				}
				richCells = append(richCells, structuredCell{
					RowIndex:     cell.RowIndex,
					ColIndex:     cell.ColIndex,
					RowSpan:      max(1, cell.RowSpan),
					ColSpan:      max(1, cell.ColSpan),
					RawText:      normalized,
					DisplayValue: normalized,
					SourceRef:    fmt.Sprintf("第%d页/OCR表格%d/单元格R%dC%d", pageNo, table.TableNo, cell.RowIndex+1, cell.ColIndex+1),
				})
			}
			if len(rows) == 0 && len(richCells) == 0 {
				continue
			}
			fingerprint := buildOCRTableFingerprint(pageNo, rows, richCells)
			if fingerprint != "" && existingFingerprints[fingerprint] {
				continue
			}
			title := fmt.Sprintf("%s - 第%d页OCR表格%d", version.OriginName, pageNo, table.TableNo)
			bboxJSON := string(mustJSON(map[string]any{
				"page":  pageNo,
				"table": table.TableNo,
				"bbox":  table.BBox,
				"ocr":   true,
			}))
			tableModel, fragment, tableCells := buildRichStructuredTable(caseFile, version, profile, nextVirtualID, title, rows, richCells, pageNo, bboxJSON)
			tableModel.SourceType = model.DocumentSourceTypeOCR
			if table.HeaderRowCount > 0 {
				tableModel.HeaderRowCount = table.HeaderRowCount
			}
			combinedTables = append(combinedTables, tableModel)
			combinedFragments = append(combinedFragments, fragment)
			combinedCells = append(combinedCells, tableCells...)
			nextVirtualID--
			if fingerprint != "" {
				existingFingerprints[fingerprint] = true
			}
		}
	}
	return combinedTables, combinedFragments, combinedCells
}

func buildExistingTableFingerprints(tables []model.DocumentTable, cells []model.DocumentTableCell) map[string]bool {
	out := map[string]bool{}
	cellsByTable := map[int64][]model.DocumentTableCell{}
	for _, cell := range cells {
		cellsByTable[cell.TableID] = append(cellsByTable[cell.TableID], cell)
	}
	for _, table := range tables {
		fingerprint := buildCellFingerprint(table.PageStart, cellsByTable[table.ID])
		if fingerprint == "" {
			continue
		}
		out[fingerprint] = true
	}
	return out
}

func buildOCRTableFingerprint(pageNo int, rows [][]string, cells []structuredCell) string {
	if len(cells) > 0 {
		return buildStructuredCellFingerprint(pageNo, cells)
	}
	return buildRowFingerprint(pageNo, rows)
}

func buildStructuredCellFingerprint(pageNo int, cells []structuredCell) string {
	if len(cells) == 0 {
		return ""
	}
	parts := make([]string, 0, len(cells))
	for _, cell := range cells {
		text := normalizeText(cell.DisplayValue)
		if text == "" {
			text = normalizeText(cell.RawText)
		}
		if text == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d:%d:%d:%d:%s", cell.RowIndex, cell.ColIndex, max(1, cell.RowSpan), max(1, cell.ColSpan), text))
	}
	sort.Strings(parts)
	if len(parts) == 0 {
		return ""
	}
	return fmt.Sprintf("p=%d|%s", max(1, pageNo), strings.Join(parts, "|"))
}

func buildCellFingerprint(pageNo int, cells []model.DocumentTableCell) string {
	if len(cells) == 0 {
		return ""
	}
	parts := make([]string, 0, len(cells))
	for _, cell := range cells {
		text := normalizeText(cell.NormalizedValue)
		if text == "" {
			text = normalizeText(cell.RawText)
		}
		if text == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d:%d:%d:%d:%s", cell.RowIndex, cell.ColIndex, max(1, cell.RowSpan), max(1, cell.ColSpan), text))
	}
	sort.Strings(parts)
	if len(parts) == 0 {
		return ""
	}
	return fmt.Sprintf("p=%d|%s", max(1, pageNo), strings.Join(parts, "|"))
}

func buildRowFingerprint(pageNo int, rows [][]string) string {
	normalized := normalizeRows(rows)
	if len(normalized) == 0 {
		return ""
	}
	lines := make([]string, 0, len(normalized))
	for _, row := range normalized {
		parts := make([]string, 0, len(row))
		for _, cell := range row {
			parts = append(parts, normalizeText(cell))
		}
		lines = append(lines, strings.Join(parts, "\t"))
	}
	if len(lines) == 0 {
		return ""
	}
	return fmt.Sprintf("p=%d|%s", max(1, pageNo), strings.Join(lines, "\n"))
}

func rowsFromOCRCells(cells []OCRResultCell) [][]string {
	return rowsFromOCRCellsWithMergedMarker(cells, "")
}

func dedupAndJoinLines(parts []string) string {
	seen := map[string]bool{}
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized := strings.TrimSpace(part)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	return strings.Join(out, "\n")
}

func buildOCRSupplementSlice(caseFile model.ReportCaseFile, version model.FileVersionDTO, page int, text string, reason string) model.DocumentSlice {
	marked := "[OCR补全]\n" + strings.TrimSpace(text)
	return model.DocumentSlice{
		CaseFileID:  caseFile.ID,
		FileID:      caseFile.FileID,
		VersionNo:   version.VersionNo,
		SliceType:   model.DocumentStructureParagraph,
		SourceType:  model.DocumentSourceTypeOCR,
		Title:       fmt.Sprintf("%s - 第%d页 OCR补全", version.OriginName, max(1, page)),
		PageStart:   max(1, page),
		PageEnd:     max(1, page),
		BBoxJSON:    mustJSON(map[string]any{"ocrSupplement": true, "page": max(1, page), "reason": reason}),
		RawText:     marked,
		CleanText:   marked,
		TableJSON:   json.RawMessage(`null`),
		Confidence:  0.86,
		ParseStatus: model.DocumentParseStatusParsed,
		OCRPending:  false,
	}
}

func normalizedSlicePage(slice model.DocumentSlice) int {
	if slice.PageStart > 0 {
		return slice.PageStart
	}
	if slice.PageEnd > 0 {
		return slice.PageEnd
	}
	return 1
}
