package service

import "testing"

func TestRepairOCRTableCells_RebuildSpanAndRows(t *testing.T) {
	cells := []OCRResultCell{
		{
			RowIndex: 0, ColIndex: 0, RowSpan: 1, ColSpan: 1,
			Text: "项目", BBox: []float64{0, 0, 200, 100}, Confidence: 0.99,
		},
		{
			RowIndex: 0, ColIndex: 2, RowSpan: 1, ColSpan: 1,
			Text: "金额", BBox: []float64{200, 0, 300, 100}, Confidence: 0.99,
		},
		{
			RowIndex: 1, ColIndex: 0, RowSpan: 1, ColSpan: 1,
			Text: "资产", BBox: []float64{0, 100, 100, 200}, Confidence: 0.98,
		},
		{
			RowIndex: 1, ColIndex: 1, RowSpan: 1, ColSpan: 1,
			Text: "流动资产", BBox: []float64{100, 100, 200, 200}, Confidence: 0.98,
		},
		{
			RowIndex: 1, ColIndex: 2, RowSpan: 1, ColSpan: 1,
			Text: "100", BBox: []float64{200, 100, 300, 200}, Confidence: 0.98,
		},
	}

	repaired, summary := repairOCRTableCells(cells)
	if summary.FallbackMode != tableFallbackModeNone {
		t.Fatalf("expected fallback mode none, got %s", summary.FallbackMode)
	}
	if len(repaired) != 5 {
		t.Fatalf("expected 5 repaired cells, got %d", len(repaired))
	}

	headerFound := false
	for _, cell := range repaired {
		if cell.Text == "项目" {
			headerFound = true
			if cell.ColSpan != 2 {
				t.Fatalf("expected header colSpan=2, got %d", cell.ColSpan)
			}
		}
	}
	if !headerFound {
		t.Fatalf("header cell not found")
	}

	rows := rowsFromOCRCellsWithMergedMarker(repaired, defaultMergedMarker)
	if len(rows) < 2 || len(rows[0]) < 3 {
		t.Fatalf("unexpected rows size: %d x %d", len(rows), len(rows[0]))
	}
	if rows[0][0] != "项目" {
		t.Fatalf("unexpected top-left value: %q", rows[0][0])
	}
	if rows[0][1] != defaultMergedMarker {
		t.Fatalf("expected merged marker at [0][1], got %q", rows[0][1])
	}
}

func TestRepairOCRTableCells_FallbackToFlat2DWhenConflictHigh(t *testing.T) {
	cells := []OCRResultCell{
		{
			RowIndex: 0, ColIndex: 0, RowSpan: 2, ColSpan: 2,
			Text: "冲突1", BBox: []float64{0, 0, 200, 200}, Confidence: 0.9,
		},
		{
			RowIndex: 0, ColIndex: 0, RowSpan: 2, ColSpan: 2,
			Text: "冲突2", BBox: []float64{0, 0, 200, 200}, Confidence: 0.89,
		},
	}

	repaired, summary := repairOCRTableCells(cells)
	if summary.FallbackMode != tableFallbackModeFlat2D {
		t.Fatalf("expected fallback mode %s, got %s", tableFallbackModeFlat2D, summary.FallbackMode)
	}
	if len(repaired) != 2 {
		t.Fatalf("expected 2 repaired cells after fallback, got %d", len(repaired))
	}
	for _, cell := range repaired {
		if cell.RowSpan != 1 || cell.ColSpan != 1 {
			t.Fatalf("expected flat cell span 1x1, got %dx%d", cell.RowSpan, cell.ColSpan)
		}
	}
}

func TestRepairOCRResponseTables_AppendsMetaAndCsvRows(t *testing.T) {
	response := map[string]any{
		"pages": []any{
			map[string]any{
				"tables": []any{
					map[string]any{
						"cells": []any{
							map[string]any{
								"rowIndex":   0,
								"colIndex":   0,
								"rowSpan":    1,
								"colSpan":    1,
								"text":       "项目",
								"bbox":       []any{0.0, 0.0, 200.0, 100.0},
								"confidence": 0.99,
							},
							map[string]any{
								"rowIndex":   0,
								"colIndex":   2,
								"rowSpan":    1,
								"colSpan":    1,
								"text":       "金额",
								"bbox":       []any{200.0, 0.0, 300.0, 100.0},
								"confidence": 0.99,
							},
						},
					},
				},
			},
		},
	}

	meta := repairOCRResponseTables(response)
	if len(meta) != 1 {
		t.Fatalf("expected 1 table meta, got %d", len(meta))
	}
	pages, ok := response["pages"].([]any)
	if !ok || len(pages) == 0 {
		t.Fatalf("pages not found")
	}
	pageMap, ok := pages[0].(map[string]any)
	if !ok {
		t.Fatalf("page type invalid")
	}
	tables, ok := pageMap["tables"].([]any)
	if !ok || len(tables) == 0 {
		t.Fatalf("tables not found")
	}
	tableMap, ok := tables[0].(map[string]any)
	if !ok {
		t.Fatalf("table type invalid")
	}
	if _, exists := tableMap["csvRows"]; !exists {
		t.Fatalf("expected csvRows in repaired table")
	}
}

