package service

import (
	"encoding/json"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
)

const (
	defaultTableGridSnapTolerancePx          = 2.0
	defaultTableGridConflictFallbackFraction = 0.15
	defaultMergedMarker                      = "MERGED"
	tableFallbackModeNone                    = "none"
	tableFallbackModeFlat2D                  = "flat_2d"
)

type tableRepairSummary struct {
	ConflictCount   int     `json:"conflictCount"`
	AcceptedCount   int     `json:"acceptedCount"`
	TotalCount      int     `json:"totalCount"`
	SnapTolerancePx float64 `json:"snapTolerancePx"`
	FallbackMode    string  `json:"fallbackMode"`
}

type tableCellCandidate struct {
	Cell       OCRResultCell
	RowIndex   int
	ColIndex   int
	RowSpan    int
	ColSpan    int
	Score      float64
	Confidence float64
}

type gridSlot struct {
	Row int
	Col int
}

func repairOCRTableCells(cells []OCRResultCell) ([]OCRResultCell, tableRepairSummary) {
	summary := tableRepairSummary{
		SnapTolerancePx: tableGridSnapTolerancePx(),
		FallbackMode:    tableFallbackModeNone,
		TotalCount:      len(cells),
	}
	if len(cells) == 0 {
		return nil, summary
	}
	candidates, ok := buildTableCellCandidates(cells, summary.SnapTolerancePx)
	if !ok {
		fallback := flattenCellsWithoutSpan(cells)
		summary.AcceptedCount = len(fallback)
		summary.FallbackMode = tableFallbackModeFlat2D
		return fallback, summary
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Score == candidates[j].Score {
			if candidates[i].RowIndex == candidates[j].RowIndex {
				return candidates[i].ColIndex < candidates[j].ColIndex
			}
			return candidates[i].RowIndex < candidates[j].RowIndex
		}
		return candidates[i].Score > candidates[j].Score
	})

	occupied := map[gridSlot]bool{}
	accepted := make([]tableCellCandidate, 0, len(candidates))
	conflictCount := 0
	for _, candidate := range candidates {
		slots := slotsFor(candidate.RowIndex, candidate.ColIndex, candidate.RowSpan, candidate.ColSpan)
		conflict := false
		for _, slot := range slots {
			if occupied[slot] {
				conflict = true
				break
			}
		}
		if conflict {
			conflictCount++
			continue
		}
		for _, slot := range slots {
			occupied[slot] = true
		}
		accepted = append(accepted, candidate)
	}

	summary.ConflictCount = conflictCount
	summary.AcceptedCount = len(accepted)
	if len(candidates) > 0 {
		conflictRate := float64(conflictCount) / float64(len(candidates))
		if conflictRate > tableGridConflictFallbackThreshold() {
			flat := flattenCellsWithoutSpan(cells)
			summary.AcceptedCount = len(flat)
			summary.FallbackMode = tableFallbackModeFlat2D
			return flat, summary
		}
	}

	sort.SliceStable(accepted, func(i, j int) bool {
		if accepted[i].RowIndex == accepted[j].RowIndex {
			return accepted[i].ColIndex < accepted[j].ColIndex
		}
		return accepted[i].RowIndex < accepted[j].RowIndex
	})
	out := make([]OCRResultCell, 0, len(accepted))
	for _, item := range accepted {
		cell := item.Cell
		cell.RowIndex = item.RowIndex
		cell.ColIndex = item.ColIndex
		cell.RowSpan = max(1, item.RowSpan)
		cell.ColSpan = max(1, item.ColSpan)
		out = append(out, cell)
	}
	return out, summary
}

func buildTableCellCandidates(cells []OCRResultCell, tolerance float64) ([]tableCellCandidate, bool) {
	xPoints := make([]float64, 0, len(cells)*2)
	yPoints := make([]float64, 0, len(cells)*2)
	validBBoxCount := 0
	for _, cell := range cells {
		xMin, yMin, xMax, yMax, ok := parseCellBBox(cell.BBox)
		if !ok {
			continue
		}
		validBBoxCount++
		xPoints = append(xPoints, xMin, xMax)
		yPoints = append(yPoints, yMin, yMax)
	}
	if validBBoxCount == 0 {
		return nil, false
	}
	xLines := snapLines(xPoints, tolerance)
	yLines := snapLines(yPoints, tolerance)
	if len(xLines) < 2 || len(yLines) < 2 {
		return nil, false
	}

	out := make([]tableCellCandidate, 0, len(cells))
	for _, cell := range cells {
		xMin, yMin, xMax, yMax, ok := parseCellBBox(cell.BBox)
		if !ok {
			continue
		}
		colStart := nearestLineIndex(xLines, xMin)
		colEnd := nearestLineIndex(xLines, xMax)
		rowStart := nearestLineIndex(yLines, yMin)
		rowEnd := nearestLineIndex(yLines, yMax)
		if colEnd <= colStart {
			colEnd = min(colStart+1, len(xLines)-1)
		}
		if rowEnd <= rowStart {
			rowEnd = min(rowStart+1, len(yLines)-1)
		}
		colSpan := max(1, colEnd-colStart)
		rowSpan := max(1, rowEnd-rowStart)
		confidence := cell.Confidence
		if confidence <= 0 {
			confidence = 0.5
		}
		textWeight := 0.0
		if strings.TrimSpace(cell.Text) != "" {
			textWeight = 0.05
		}
		area := (xMax - xMin) * (yMax - yMin)
		if area <= 0 {
			area = 1
		}
		score := confidence + textWeight + math.Min(1.0, area/100000.0)
		out = append(out, tableCellCandidate{
			Cell:       cell,
			RowIndex:   rowStart,
			ColIndex:   colStart,
			RowSpan:    rowSpan,
			ColSpan:    colSpan,
			Score:      score,
			Confidence: confidence,
		})
	}
	return out, len(out) > 0
}

func flattenCellsWithoutSpan(cells []OCRResultCell) []OCRResultCell {
	if len(cells) == 0 {
		return nil
	}
	normalized := make([]OCRResultCell, 0, len(cells))
	for _, cell := range cells {
		copyCell := cell
		copyCell.RowSpan = 1
		copyCell.ColSpan = 1
		copyCell.RowIndex = max(0, copyCell.RowIndex)
		copyCell.ColIndex = max(0, copyCell.ColIndex)
		normalized = append(normalized, copyCell)
	}
	sort.SliceStable(normalized, func(i, j int) bool {
		if normalized[i].RowIndex == normalized[j].RowIndex {
			return normalized[i].ColIndex < normalized[j].ColIndex
		}
		return normalized[i].RowIndex < normalized[j].RowIndex
	})
	return normalized
}

func rowsFromOCRCellsWithMergedMarker(cells []OCRResultCell, mergedMarker string) [][]string {
	if len(cells) == 0 {
		return nil
	}
	maxRow := 0
	maxCol := 0
	for _, cell := range cells {
		maxRow = max(maxRow, max(0, cell.RowIndex)+max(1, cell.RowSpan))
		maxCol = max(maxCol, max(0, cell.ColIndex)+max(1, cell.ColSpan))
	}
	if maxRow <= 0 || maxCol <= 0 {
		return nil
	}
	rows := make([][]string, maxRow)
	for rowIndex := 0; rowIndex < maxRow; rowIndex++ {
		rows[rowIndex] = make([]string, maxCol)
	}
	for _, cell := range cells {
		rowIndex := max(0, cell.RowIndex)
		colIndex := max(0, cell.ColIndex)
		if rowIndex >= len(rows) || colIndex >= len(rows[rowIndex]) {
			continue
		}
		value := normalizeText(cell.Text)
		rows[rowIndex][colIndex] = value
		for rowOffset := 0; rowOffset < max(1, cell.RowSpan); rowOffset++ {
			for colOffset := 0; colOffset < max(1, cell.ColSpan); colOffset++ {
				targetRow := rowIndex + rowOffset
				targetCol := colIndex + colOffset
				if targetRow >= len(rows) || targetCol >= len(rows[targetRow]) {
					continue
				}
				if rowOffset == 0 && colOffset == 0 {
					continue
				}
				if rows[targetRow][targetCol] == "" {
					rows[targetRow][targetCol] = mergedMarker
				}
			}
		}
	}
	return normalizeRows(rows)
}

func repairOCRResponseTables(response map[string]any) []map[string]any {
	metas := make([]map[string]any, 0)
	if len(response) == 0 {
		return metas
	}
	topLevelTables := toAnySlice(response["tables"])
	for tableIndex, tableValue := range topLevelTables {
		tableMap, ok := tableValue.(map[string]any)
		if !ok {
			continue
		}
		typedCells := decodeOCRCellsFromAny(tableMap["cells"])
		if len(typedCells) == 0 {
			continue
		}
		repairedCells, summary := repairOCRTableCells(typedCells)
		tableMap["cells"] = encodeOCRCellsToAny(repairedCells)
		tableMap["rows"] = toAny2D(rowsFromOCRCellsWithMergedMarker(repairedCells, defaultMergedMarker))
		tableMap["csvRows"] = toAny2D(rowsFromOCRCellsWithMergedMarker(repairedCells, defaultMergedMarker))
		topLevelTables[tableIndex] = tableMap
		metas = append(metas, map[string]any{
			"tableIndex":        tableIndex,
			"gridConflictCount": summary.ConflictCount,
			"snapTolerancePx":   summary.SnapTolerancePx,
			"fallbackMode":      summary.FallbackMode,
			"acceptedCellCount": summary.AcceptedCount,
			"totalCellCount":    summary.TotalCount,
		})
	}
	if len(topLevelTables) > 0 {
		response["tables"] = topLevelTables
	}

	pages := toAnySlice(response["pages"])
	for pageIndex, pageValue := range pages {
		pageMap, ok := pageValue.(map[string]any)
		if !ok {
			continue
		}
		tables := toAnySlice(pageMap["tables"])
		for tableIndex, tableValue := range tables {
			tableMap, ok := tableValue.(map[string]any)
			if !ok {
				continue
			}
			typedCells := decodeOCRCellsFromAny(tableMap["cells"])
			if len(typedCells) == 0 {
				continue
			}
			repairedCells, summary := repairOCRTableCells(typedCells)
			tableMap["cells"] = encodeOCRCellsToAny(repairedCells)
			tableMap["rows"] = toAny2D(rowsFromOCRCellsWithMergedMarker(repairedCells, defaultMergedMarker))
			tableMap["csvRows"] = toAny2D(rowsFromOCRCellsWithMergedMarker(repairedCells, defaultMergedMarker))
			tables[tableIndex] = tableMap
			metas = append(metas, map[string]any{
				"pageIndex":         pageIndex,
				"tableIndex":        tableIndex,
				"gridConflictCount": summary.ConflictCount,
				"snapTolerancePx":   summary.SnapTolerancePx,
				"fallbackMode":      summary.FallbackMode,
				"acceptedCellCount": summary.AcceptedCount,
				"totalCellCount":    summary.TotalCount,
			})
		}
		pageMap["tables"] = tables
		pages[pageIndex] = pageMap
	}
	response["pages"] = pages
	return metas
}

func decodeOCRCellsFromAny(value any) []OCRResultCell {
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil
	}
	out := make([]OCRResultCell, 0, len(items))
	for _, item := range items {
		cellMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, OCRResultCell{
			RowIndex:   parseIntAny(cellMap["rowIndex"], 0),
			ColIndex:   parseIntAny(cellMap["colIndex"], 0),
			RowSpan:    parseIntAny(cellMap["rowSpan"], 1),
			ColSpan:    parseIntAny(cellMap["colSpan"], 1),
			Text:       strings.TrimSpace(parseStringAny(cellMap["text"])),
			BBox:       parseFloat64SliceAny(cellMap["bbox"]),
			Confidence: parseFloatAny(cellMap["confidence"], 0),
		})
	}
	return out
}

func encodeOCRCellsToAny(cells []OCRResultCell) []any {
	out := make([]any, 0, len(cells))
	for _, cell := range cells {
		out = append(out, map[string]any{
			"rowIndex":   cell.RowIndex,
			"colIndex":   cell.ColIndex,
			"rowSpan":    max(1, cell.RowSpan),
			"colSpan":    max(1, cell.ColSpan),
			"text":       strings.TrimSpace(cell.Text),
			"bbox":       cell.BBox,
			"confidence": cell.Confidence,
		})
	}
	return out
}

func parseCellBBox(bbox []float64) (float64, float64, float64, float64, bool) {
	if len(bbox) < 4 {
		return 0, 0, 0, 0, false
	}
	xMin := bbox[0]
	yMin := bbox[1]
	xMax := bbox[2]
	yMax := bbox[3]
	if xMax < xMin {
		xMin, xMax = xMax, xMin
	}
	if yMax < yMin {
		yMin, yMax = yMax, yMin
	}
	if xMax <= xMin || yMax <= yMin {
		return 0, 0, 0, 0, false
	}
	return xMin, yMin, xMax, yMax, true
}

func snapLines(points []float64, tolerance float64) []float64 {
	if len(points) == 0 {
		return nil
	}
	sort.Float64s(points)
	clusters := make([][]float64, 0, len(points))
	for _, point := range points {
		if len(clusters) == 0 {
			clusters = append(clusters, []float64{point})
			continue
		}
		last := clusters[len(clusters)-1]
		center := averageFloat64(last)
		if math.Abs(point-center) <= tolerance {
			clusters[len(clusters)-1] = append(last, point)
			continue
		}
		clusters = append(clusters, []float64{point})
	}
	out := make([]float64, 0, len(clusters))
	for _, cluster := range clusters {
		out = append(out, averageFloat64(cluster))
	}
	return out
}

func averageFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func nearestLineIndex(lines []float64, target float64) int {
	if len(lines) == 0 {
		return 0
	}
	bestIndex := 0
	bestDistance := math.Abs(lines[0] - target)
	for index := 1; index < len(lines); index++ {
		distance := math.Abs(lines[index] - target)
		if distance < bestDistance {
			bestDistance = distance
			bestIndex = index
		}
	}
	return bestIndex
}

func slotsFor(row int, col int, rowSpan int, colSpan int) []gridSlot {
	out := make([]gridSlot, 0, max(1, rowSpan)*max(1, colSpan))
	for rowOffset := 0; rowOffset < max(1, rowSpan); rowOffset++ {
		for colOffset := 0; colOffset < max(1, colSpan); colOffset++ {
			out = append(out, gridSlot{
				Row: max(0, row) + rowOffset,
				Col: max(0, col) + colOffset,
			})
		}
	}
	return out
}

func tableGridSnapTolerancePx() float64 {
	value := strings.TrimSpace(os.Getenv("TABLE_GRID_SNAP_TOLERANCE_PX"))
	if value == "" {
		return defaultTableGridSnapTolerancePx
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return defaultTableGridSnapTolerancePx
	}
	return parsed
}

func tableGridConflictFallbackThreshold() float64 {
	value := strings.TrimSpace(os.Getenv("TABLE_GRID_CONFLICT_FALLBACK_THRESHOLD"))
	if value == "" {
		return defaultTableGridConflictFallbackFraction
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return defaultTableGridConflictFallbackFraction
	}
	return parsed
}

func toAnySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func toAny2D(rows [][]string) []any {
	out := make([]any, 0, len(rows))
	for _, row := range rows {
		rowAny := make([]any, 0, len(row))
		for _, cell := range row {
			rowAny = append(rowAny, cell)
		}
		out = append(out, rowAny)
	}
	return out
}

func parseIntAny(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return int(parsed)
		}
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return fallback
}

func parseFloatAny(value any, fallback float64) float64 {
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
	return fallback
}

func parseStringAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func parseFloat64SliceAny(value any) []float64 {
	switch typed := value.(type) {
	case []float64:
		return typed
	case []any:
		out := make([]float64, 0, len(typed))
		for _, item := range typed {
			out = append(out, parseFloatAny(item, 0))
		}
		return out
	default:
		return nil
	}
}
