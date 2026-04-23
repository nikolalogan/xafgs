package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"sxfgssever/server/internal/model"
)

func buildParsedDocumentFromOCRTask(caseFile model.ReportCaseFile, version model.FileVersionDTO, profile DocumentProfile, task model.OCRTask) (ParsedDocument, bool) {
	if len(task.ResultPayloadJSON) == 0 || string(task.ResultPayloadJSON) == "null" {
		return ParsedDocument{}, false
	}
	var result OCRTaskResult
	if err := json.Unmarshal(task.ResultPayloadJSON, &result); err != nil {
		return ParsedDocument{}, false
	}

	ocrProfile := profile
	ocrProfile.SourceType = model.DocumentSourceTypeOCR
	ocrProfile.OCRRequired = false
	ocrProfile.ParseStrategy = "docling_async_completed"
	ocrProfile.PageCount = max(1, result.PageCount)
	ocrProfile.HasTextLayer = true

	slices := make([]model.DocumentSlice, 0, len(result.Pages)+1)
	tables := make([]model.DocumentTable, 0)
	fragments := make([]model.DocumentTableFragment, 0)
	cells := make([]model.DocumentTableCell, 0)
	combinedText := make([]string, 0, len(result.Pages))
	virtualTableID := int64(-1)

	for _, page := range result.Pages {
		pageText := normalizeText(page.Text)
		if pageText != "" {
			combinedText = append(combinedText, fmt.Sprintf("[第%d页]\n%s", page.PageNo, pageText))
			slices = append(slices, model.DocumentSlice{
				CaseFileID:  caseFile.ID,
				FileID:      caseFile.FileID,
				VersionNo:   version.VersionNo,
				SliceType:   model.DocumentStructurePage,
				SourceType:  model.DocumentSourceTypeOCR,
				Title:       fmt.Sprintf("%s - 第%d页", version.OriginName, page.PageNo),
				PageStart:   page.PageNo,
				PageEnd:     page.PageNo,
				BBoxJSON:    mustJSON(map[string]any{"page": page.PageNo, "kind": "docling_page"}),
				RawText:     pageText,
				CleanText:   pageText,
				TableJSON:   json.RawMessage(`null`),
				Confidence:  maxFloat(result.Confidence, 0.88),
				ParseStatus: model.DocumentParseStatusParsed,
				OCRPending:  false,
			})
		}
		for _, table := range page.Tables {
			richCells := make([]structuredCell, 0, len(table.Cells))
			for _, cell := range table.Cells {
				sourceRef := fmt.Sprintf("第%d页/表格%d/单元格R%dC%d", page.PageNo, table.TableNo, cell.RowIndex+1, cell.ColIndex+1)
				richCells = append(richCells, structuredCell{
					RowIndex:     cell.RowIndex,
					ColIndex:     cell.ColIndex,
					RowSpan:      max(1, cell.RowSpan),
					ColSpan:      max(1, cell.ColSpan),
					RawText:      normalizeText(cell.Text),
					DisplayValue: normalizeText(cell.Text),
					SourceRef:    sourceRef,
				})
			}
			title := fmt.Sprintf("%s - 第%d页OCR表格%d", version.OriginName, page.PageNo, table.TableNo)
			tableModel, fragment, tableCells := buildRichStructuredTable(caseFile, version, ocrProfile, virtualTableID, title, normalizeRows(table.Rows), richCells, page.PageNo, string(mustJSON(map[string]any{
				"page":  page.PageNo,
				"table": table.TableNo,
				"bbox":  table.BBox,
				"ocr":   true,
			})))
			if table.HeaderRowCount > 0 {
				tableModel.HeaderRowCount = table.HeaderRowCount
			}
			tables = append(tables, tableModel)
			fragments = append(fragments, fragment)
			cells = append(cells, tableCells...)
			virtualTableID--
		}
	}

	if len(combinedText) == 0 {
		combinedText = append(combinedText, strings.TrimSpace(version.OriginName))
	}
	slices = append([]model.DocumentSlice{{
		CaseFileID:  caseFile.ID,
		FileID:      caseFile.FileID,
		VersionNo:   version.VersionNo,
		SliceType:   model.DocumentStructureSection,
		SourceType:  model.DocumentSourceTypeOCR,
		Title:       version.OriginName,
		TitleLevel:  1,
		PageStart:   1,
		PageEnd:     max(1, result.PageCount),
		BBoxJSON:    mustJSON(map[string]any{"kind": "docling_document", "pageStart": 1, "pageEnd": max(1, result.PageCount)}),
		RawText:     strings.Join(combinedText, "\n\n"),
		CleanText:   strings.Join(combinedText, "\n\n"),
		TableJSON:   json.RawMessage(`null`),
		Confidence:  maxFloat(result.Confidence, 0.9),
		ParseStatus: model.DocumentParseStatusParsed,
		OCRPending:  false,
	}}, slices...)

	return ParsedDocument{
		Version:        version,
		Profile:        ocrProfile,
		Markdown:       result.Markdown,
		Text:           result.Text,
		Document:       result.Document,
		Slices:         slices,
		Tables:         tables,
		TableFragments: fragments,
		TableCells:     cells,
	}, true
}
