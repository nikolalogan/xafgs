package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"sxfgssever/server/internal/model"
)

func BuildFileParseResultDTO(parsed ParsedDocument) model.FileParseResultDTO {
	profileJSON, _ := json.Marshal(parsed.Profile)
	return model.FileParseResultDTO{
		Version:       parsed.Version,
		Profile:       profileJSON,
		OCRPending:    parsed.OCRTask != nil && parsed.OCRTask.Status != model.OCRTaskStatusSucceeded,
		OCRTaskID:     parseOCRTaskID(parsed.OCRTask),
		OCRTaskStatus: parseOCRTaskStatus(parsed.OCRTask),
		OCRProvider:   parseOCRTaskProvider(parsed.OCRTask),
		OCRError:      parseOCRTaskError(parsed.OCRTask),
		SliceCount:    len(parsed.Slices),
		TableCount:    len(parsed.Tables),
		FigureCount:   len(parsed.Figures),
		FragmentCount: len(parsed.TableFragments),
		CellCount:     len(parsed.TableCells),
		Markdown:      parsed.Markdown,
		Text:          parsed.Text,
		Document:      parsed.Document,
		Slices:        buildSlicePreviews(parsed.Slices),
		Tables:        buildTablePreviews(parsed.Tables, parsed.TableCells),
		Figures:       buildFigurePreviews(parsed.Figures),
	}
}

func parseOCRTaskID(task *model.OCRTask) int64 {
	if task == nil {
		return 0
	}
	return task.ID
}

func parseOCRTaskStatus(task *model.OCRTask) string {
	if task == nil {
		return ""
	}
	return task.Status
}

func parseOCRTaskProvider(task *model.OCRTask) string {
	if task == nil {
		return ""
	}
	if strings.TrimSpace(task.ProviderUsed) != "" {
		return task.ProviderUsed
	}
	return task.ProviderMode
}

func parseOCRTaskError(task *model.OCRTask) string {
	if task == nil {
		return ""
	}
	return task.ErrorMessage
}

func buildSlicePreviews(slices []model.DocumentSlice) []model.FileParseSlicePreviewDTO {
	previews := make([]model.FileParseSlicePreviewDTO, 0, len(slices))
	for _, slice := range slices {
		previews = append(previews, model.FileParseSlicePreviewDTO{
			SliceType:   slice.SliceType,
			Title:       slice.Title,
			PageStart:   slice.PageStart,
			PageEnd:     slice.PageEnd,
			SourceRef:   formatBBoxSourceRef(slice.BBoxJSON, slice.PageStart, slice.PageEnd),
			BBox:        slice.BBoxJSON,
			CleanText:   truncateResultText(slice.CleanText, 180),
			Confidence:  slice.Confidence,
			ParseStatus: slice.ParseStatus,
		})
	}
	return previews
}

func buildTablePreviews(tables []model.DocumentTable, cells []model.DocumentTableCell) []model.FileParseTablePreviewDTO {
	cellsByTable := make(map[int64][]model.DocumentTableCell)
	for _, cell := range cells {
		cellsByTable[cell.TableID] = append(cellsByTable[cell.TableID], cell)
	}
	previews := make([]model.FileParseTablePreviewDTO, 0, len(tables))
	for _, table := range tables {
		previews = append(previews, model.FileParseTablePreviewDTO{
			Title:          table.Title,
			PageStart:      table.PageStart,
			PageEnd:        table.PageEnd,
			HeaderRowCount: table.HeaderRowCount,
			ColumnCount:    table.ColumnCount,
			SourceRef:      formatBBoxSourceRef(table.BBoxJSON, table.PageStart, table.PageEnd),
			BBox:           table.BBoxJSON,
			PreviewRows:    buildTableRowPreviews(cellsByTable[table.ID]),
		})
	}
	return previews
}

func buildTableRowPreviews(cells []model.DocumentTableCell) []model.FileParseTableRowPreviewDTO {
	if len(cells) == 0 {
		return nil
	}
	sort.Slice(cells, func(i, j int) bool {
		if cells[i].RowIndex != cells[j].RowIndex {
			return cells[i].RowIndex < cells[j].RowIndex
		}
		return cells[i].ColIndex < cells[j].ColIndex
	})
	rowMap := make(map[int][]model.FileParseTableCellPreviewDTO)
	rowOrder := make([]int, 0)
	for _, cell := range cells {
		if len(rowOrder) >= 5 && rowMap[cell.RowIndex] == nil {
			continue
		}
		if _, exists := rowMap[cell.RowIndex]; !exists {
			rowOrder = append(rowOrder, cell.RowIndex)
		}
		if len(rowMap[cell.RowIndex]) >= 8 {
			continue
		}
		rowMap[cell.RowIndex] = append(rowMap[cell.RowIndex], model.FileParseTableCellPreviewDTO{
			Text:      truncateResultText(cell.NormalizedValue, 40),
			SourceRef: formatCellSourceRef(cell),
		})
	}
	sort.Ints(rowOrder)
	previews := make([]model.FileParseTableRowPreviewDTO, 0, len(rowOrder))
	for _, rowIndex := range rowOrder {
		previews = append(previews, model.FileParseTableRowPreviewDTO{
			RowIndex: rowIndex + 1,
			Cells:    rowMap[rowIndex],
		})
	}
	return previews
}

func buildFigurePreviews(figures []model.DocumentFigureCandidate) []model.FileParseFigurePreviewDTO {
	previews := make([]model.FileParseFigurePreviewDTO, 0, len(figures))
	for _, figure := range figures {
		previews = append(previews, model.FileParseFigurePreviewDTO{
			Title:       figure.Title,
			FigureType:  figure.FigureType,
			PageNo:      figure.PageNo,
			SourceRef:   formatBBoxSourceRef(figure.BBoxJSON, figure.PageNo, figure.PageNo),
			BBox:        figure.BBoxJSON,
			CleanText:   truncateResultText(figure.CleanText, 180),
			Regions:     buildFigureRegionPreviews(figure.DetailJSON),
			Confidence:  figure.Confidence,
			ParseStatus: figure.ParseStatus,
		})
	}
	return previews
}

func buildFigureRegionPreviews(detailJSON json.RawMessage) []model.FileParseFigureRegionPreviewDTO {
	type detailNode struct {
		RowIndex  int             `json:"rowIndex"`
		Region    string          `json:"region"`
		Text      string          `json:"text"`
		SourceRef string          `json:"sourceRef"`
		BBox      json.RawMessage `json:"bbox"`
	}
	type detailPayload struct {
		Nodes []detailNode `json:"nodes"`
	}
	var payload detailPayload
	if len(detailJSON) == 0 || json.Unmarshal(detailJSON, &payload) != nil || len(payload.Nodes) == 0 {
		return nil
	}
	previews := make([]model.FileParseFigureRegionPreviewDTO, 0, len(payload.Nodes))
	for _, node := range payload.Nodes {
		previews = append(previews, model.FileParseFigureRegionPreviewDTO{
			RowIndex:  node.RowIndex,
			Region:    node.Region,
			Text:      truncateResultText(node.Text, 80),
			SourceRef: node.SourceRef,
			BBox:      node.BBox,
		})
	}
	return previews
}

func formatBBoxSourceRef(bbox json.RawMessage, pageStart int, pageEnd int) string {
	var payload map[string]any
	if len(bbox) > 0 && json.Unmarshal(bbox, &payload) == nil {
		pageNo := toInt(payload["page"])
		block := toInt(payload["block"])
		doclingRef := strings.TrimSpace(firstString(payload["doclingRef"]))
		if pageNo > 0 && block > 0 {
			return fmt.Sprintf("第%d页/块%d", pageNo, block)
		}
		if pageNo > 0 && doclingRef != "" {
			return fmt.Sprintf("第%d页/Docling(%s)", pageNo, doclingRef)
		}
		if pageNo > 0 {
			return fmt.Sprintf("第%d页", pageNo)
		}
		pageStartRef := toInt(payload["pageStart"])
		pageEndRef := toInt(payload["pageEnd"])
		if pageStartRef > 0 && pageEndRef >= pageStartRef {
			if pageStartRef == pageEndRef {
				return fmt.Sprintf("第%d页", pageStartRef)
			}
			return fmt.Sprintf("第%d-%d页", pageStartRef, pageEndRef)
		}
	}
	if pageStart > 0 && pageStart == pageEnd {
		return fmt.Sprintf("第%d页", pageStart)
	}
	if pageStart > 0 && pageEnd >= pageStart {
		return fmt.Sprintf("第%d-%d页", pageStart, pageEnd)
	}
	return "-"
}

func formatCellSourceRef(cell model.DocumentTableCell) string {
	var payload map[string]any
	if len(cell.BBoxJSON) > 0 && json.Unmarshal(cell.BBoxJSON, &payload) == nil {
		ref := strings.TrimSpace(fmt.Sprintf("%v", payload["ref"]))
		if sourceRef := formatPDFCellRef(ref); sourceRef != "" {
			return sourceRef
		}
	}
	return fmt.Sprintf("单元格R%dC%d", cell.RowIndex+1, cell.ColIndex+1)
}

func formatPDFCellRef(ref string) string {
	if ref == "" {
		return ""
	}
	if strings.HasPrefix(ref, "第") {
		return ref
	}
	parts := strings.Split(ref, "!")
	if len(parts) != 2 {
		return ""
	}
	prefix := parts[0]
	address := parts[1]
	pageNo := parseTaggedInt(prefix, "#p")
	blockIndex := parseTaggedInt(prefix, "#b")
	rowNo, colNo, ok := parseExcelAddress(address)
	if !ok {
		return ""
	}
	if pageNo > 0 && blockIndex > 0 {
		return fmt.Sprintf("第%d页/块%d/单元格R%dC%d", pageNo, blockIndex, rowNo, colNo)
	}
	return fmt.Sprintf("单元格R%dC%d", rowNo, colNo)
}

func parseTaggedInt(value string, tag string) int {
	start := strings.Index(value, tag)
	if start < 0 {
		return 0
	}
	start += len(tag)
	end := start
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	number, _ := strconv.Atoi(value[start:end])
	return number
}

func parseExcelAddress(value string) (int, int, bool) {
	value = strings.TrimSpace(strings.ToUpper(value))
	if value == "" {
		return 0, 0, false
	}
	lettersEnd := 0
	for lettersEnd < len(value) && value[lettersEnd] >= 'A' && value[lettersEnd] <= 'Z' {
		lettersEnd++
	}
	if lettersEnd == 0 || lettersEnd == len(value) {
		return 0, 0, false
	}
	rowNo, err := strconv.Atoi(value[lettersEnd:])
	if err != nil || rowNo <= 0 {
		return 0, 0, false
	}
	colNo := 0
	for _, char := range value[:lettersEnd] {
		colNo = colNo*26 + int(char-'A'+1)
	}
	if colNo <= 0 {
		return 0, 0, false
	}
	return rowNo, colNo, true
}

func toInt(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		number, _ := strconv.Atoi(strings.TrimSpace(typed))
		return number
	default:
		return 0
	}
}

func truncateResultText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "…"
}
