package service

import (
	"testing"

	"sxfgssever/server/internal/model"
)

func TestRowsFromOCRCells_BuildGrid(t *testing.T) {
	rows := rowsFromOCRCells([]OCRResultCell{
		{RowIndex: 0, ColIndex: 0, Text: "资产总计"},
		{RowIndex: 0, ColIndex: 1, Text: "100"},
		{RowIndex: 1, ColIndex: 0, Text: "负债总计"},
		{RowIndex: 1, ColIndex: 1, Text: "80"},
	})
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if len(rows[0]) != 2 {
		t.Fatalf("expected 2 cols, got %d", len(rows[0]))
	}
	if rows[1][1] != "80" {
		t.Fatalf("unexpected cell value %q", rows[1][1])
	}
}

func TestBuildExistingLineSet_SplitsByOriginalLines(t *testing.T) {
	lines := buildExistingLineSet([]model.DocumentSlice{
		{
			CleanText: "第一行\n第二行",
		},
	})
	if !lines["第一行"] {
		t.Fatalf("expected first line exists")
	}
	if !lines["第二行"] {
		t.Fatalf("expected second line exists")
	}
}
