package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"sxfgssever/server/internal/model"
)

func (service *documentParseService) applyOCRSupplementIfNeeded(ctx context.Context, caseFile model.ReportCaseFile, version model.FileVersionDTO, raw []byte, parsed ParsedDocument) ParsedDocument {
	if service.ocrTaskService == nil {
		return parsed
	}
	if parsed.Profile.BizClass == "std_doc" && isTextualDocumentProfile(parsed.Profile) {
		if strings.TrimSpace(parsed.Profile.OCRSkipReason) == "" {
			parsed.Profile.OCRSkipReason = "std_doc_textual_skip_ocr"
		}
		return parsed
	}
	if !isSupplementCandidateFileType(parsed.Profile.FileType) {
		return parsed
	}
	requiresOCRSupplement := hasUnreadableOrMissingSlices(parsed.Slices)
	forceAppendByBusinessRule := parsed.Profile.BizClass == "std_att"
	if !requiresOCRSupplement && !forceAppendByBusinessRule {
		return parsed
	}

	task, taskError := service.ocrTaskService.EnsureTask(ctx, version, raw, parsed.Profile)
	if taskError != nil {
		return parsed
	}
	parsed.OCRTask = &task
	if task.Status != model.OCRTaskStatusSucceeded {
		return parsed
	}

	ocrResult, ok := parseOCRTaskResult(task)
	if !ok {
		return parsed
	}
	if forceAppendByBusinessRule {
		merged, appendCount := appendOCRSupplementsAfterTextSlices(caseFile, version, parsed.Slices, ocrResult.Pages)
		parsed.Slices = merged
		parsed.Profile.ImageOCRApplied = appendCount > 0
		parsed.Profile.ImageOCRAppendCount = appendCount
		return parsed
	}
	parsed.Slices = mergeSlicesWithOCRSupplements(caseFile, version, parsed.Slices, ocrResult.Pages)
	return parsed
}

func isSupplementCandidateFileType(fileType string) bool {
	switch strings.TrimSpace(strings.ToLower(fileType)) {
	case "pdf", "docodex", "xlsx", "xls", "image", "binary":
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

func appendOCRSupplementsAfterTextSlices(caseFile model.ReportCaseFile, version model.FileVersionDTO, original []model.DocumentSlice, pages []OCRResultPage) ([]model.DocumentSlice, int) {
	supplements := collectOCRSupplements(pages)
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
		out = append(out, buildOCRSupplementSlice(caseFile, version, pageNo, supplementText, "std_att_append_after_text"))
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
