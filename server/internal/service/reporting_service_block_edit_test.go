package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"sxfgssever/server/internal/model"
)

func TestParseCaseFileBlockEdits_SupportNegativeBlockID(t *testing.T) {
	raw := json.RawMessage(`{
		"blockEdits": {
			"-12": { "html": "<table><tbody><tr><td>A</td></tr></tbody></table>" },
			"7": { "html": "<p>hello</p>" },
			"0": { "html": "<p>ignored</p>" },
			"bad": { "html": "<p>ignored</p>" }
		}
	}`)
	edits := parseCaseFileBlockEdits(raw)
	if len(edits) != 2 {
		t.Fatalf("unexpected edits length: %d", len(edits))
	}
	if edits[-12] == "" {
		t.Fatalf("expected negative block id to be kept")
	}
	if edits[7] == "" {
		t.Fatalf("expected positive block id to be kept")
	}
	if _, ok := edits[0]; ok {
		t.Fatalf("expected block id 0 to be filtered")
	}
}

func TestBuildCaseFileBlocks_ApplyEditedHTMLForTableBlock(t *testing.T) {
	now := time.Now().UTC()
	slices := []model.DocumentSlice{
		{
			ID:        1,
			SliceType: model.DocumentStructureParagraph,
			SourceType: model.DocumentSourceTypeNativeText,
			PageStart: 1,
			PageEnd:   1,
			CleanText: "段落内容",
			CreatedAt: now,
		},
	}
	tables := []model.DocumentTableDTO{
		{
			ID:             9,
			Title:          "测试表格",
			PageStart:      1,
			PageEnd:        1,
			HeaderRowCount: 1,
			SourceType:     model.DocumentSourceTypeNativeText,
			CreatedAt:      now,
		},
	}
	cells := []model.DocumentTableCellDTO{
		{ID: 1, TableID: 9, RowIndex: 0, ColIndex: 0, NormalizedValue: "列1"},
		{ID: 2, TableID: 9, RowIndex: 0, ColIndex: 1, NormalizedValue: "列2"},
		{ID: 3, TableID: 9, RowIndex: 1, ColIndex: 0, NormalizedValue: "值1"},
		{ID: 4, TableID: 9, RowIndex: 1, ColIndex: 1, NormalizedValue: "值2"},
	}
	editedHTML := "<table><tbody><tr><td>Edited</td></tr></tbody></table>"
	_, blocks := buildCaseFileBlocks(slices, tables, cells, map[int64]string{
		-9: editedHTML,
	})
	var tableBlock *model.EnterpriseProjectFileBlockItemDTO
	for index := range blocks {
		if blocks[index].BlockID == -9 {
			tableBlock = &blocks[index]
			break
		}
	}
	if tableBlock == nil {
		t.Fatalf("expected table block -9")
	}
	if !strings.Contains(tableBlock.CurrentHTML, `<div class="table-wrapper">`) || !strings.Contains(tableBlock.CurrentHTML, "<table>") || !strings.Contains(tableBlock.CurrentHTML, "Edited") {
		t.Fatalf("unexpected current html: %s", tableBlock.CurrentHTML)
	}
	if strings.TrimSpace(tableBlock.InitialHTML) == "" {
		t.Fatalf("expected non-empty initial html")
	}
}

func TestNormalizeTableBlockHTMLForEditor_DecodeEscapedHTML(t *testing.T) {
	fallback := `<div class="table-wrapper"><table><tbody><tr><td>fallback</td></tr></tbody></table></div>`
	input := `<p>&lt;table&gt;&lt;tbody&gt;&lt;tr&gt;&lt;td&gt;A&lt;/td&gt;&lt;/tr&gt;&lt;/tbody&gt;&lt;/table&gt;</p>`
	normalized, reasonCode, fallbackUsed := normalizeTableBlockHTMLForEditor(input, fallback)
	if fallbackUsed {
		t.Fatalf("expected non-fallback result, reason=%s", reasonCode)
	}
	if reasonCode != "decoded-table" && reasonCode != "raw-table" {
		t.Fatalf("unexpected reasonCode: %s", reasonCode)
	}
	if !strings.Contains(normalized, `<div class="table-wrapper">`) || !strings.Contains(normalized, "<table>") || !strings.Contains(normalized, "<td>A</td>") {
		t.Fatalf("unexpected normalized html: %s", normalized)
	}
}

func TestNormalizeTableBlockHTMLForEditor_UseFallbackWhenNoTable(t *testing.T) {
	fallback := `<div class="table-wrapper"><table><tbody><tr><td>fallback</td></tr></tbody></table></div>`
	input := `<p>纯文本，没有表格</p>`
	normalized, reasonCode, fallbackUsed := normalizeTableBlockHTMLForEditor(input, fallback)
	if !fallbackUsed {
		t.Fatalf("expected fallback")
	}
	if reasonCode != "no-table-fallback" {
		t.Fatalf("unexpected reasonCode: %s", reasonCode)
	}
	if normalized != fallback {
		t.Fatalf("expected fallback html, got: %s", normalized)
	}
}
