package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"sxfgssever/server/internal/model"
)

func TestMapDoclingResponseToTaskResultCollectsPageBlocks(t *testing.T) {
	result := mapDoclingResponseToTaskResult(doclingConvertResponse{
		Filename: "sample.pdf",
		Markdown: "## 完整标题\n\n| A | B |\n| - | - |\n| 1 | 2 |",
		Text:     "完整纯文本",
		Document: map[string]any{
			"pages": map[string]any{"1": map[string]any{}, "2": map[string]any{}},
			"texts": []any{
				map[string]any{
					"self_ref": "#/texts/0",
					"text":     "第一页内容",
					"prov": []any{map[string]any{
						"page_no": float64(1),
						"bbox":    []any{float64(0), float64(1), float64(2), float64(3)},
					}},
				},
				map[string]any{
					"self_ref": "#/texts/1",
					"text":     "第二页内容",
					"prov":     []any{map[string]any{"page_no": float64(2)}},
				},
			},
		},
	})

	if result.Provider != "docling" {
		t.Fatalf("provider = %q", result.Provider)
	}
	if result.PageCount != 2 {
		t.Fatalf("pageCount = %d", result.PageCount)
	}
	if len(result.Pages) != 2 {
		t.Fatalf("pages = %d", len(result.Pages))
	}
	if result.Pages[0].PageNo != 1 || result.Pages[0].Text != "第一页内容" {
		t.Fatalf("unexpected first page: %#v", result.Pages[0])
	}
	if len(result.Pages[0].Blocks) != 1 || len(result.Pages[0].Blocks[0].BBox) != 4 {
		t.Fatalf("unexpected first page blocks: %#v", result.Pages[0].Blocks)
	}
	if result.Markdown != "## 完整标题\n\n| A | B |\n| - | - |\n| 1 | 2 |" {
		t.Fatalf("markdown not preserved: %q", result.Markdown)
	}
	if result.Text != "完整纯文本" {
		t.Fatalf("text not preserved: %q", result.Text)
	}
	if len(result.Document) == 0 {
		t.Fatal("document not preserved")
	}
}

func TestBuildParsedDocumentFromDoclingTaskUsesCoarseSlices(t *testing.T) {
	payload, _ := json.Marshal(OCRTaskResult{
		Provider:   "docling",
		PageCount:  1,
		Confidence: 0.92,
		Markdown:   "## 完整 Markdown\n\n" + strings.Repeat("正文", 120),
		Text:       "完整纯文本",
		Document:   json.RawMessage(`{"texts":[{"text":"完整"}]}`),
		Pages: []OCRResultPage{
			{
				PageNo: 1,
				Text:   "第一页内容",
				Blocks: []OCRResultBlock{
					{BlockNo: 1, Text: "原块一"},
					{BlockNo: 2, Text: "原块二"},
				},
			},
		},
	})
	parsed, ok := buildParsedDocumentFromOCRTask(
		model.ReportCaseFile{BaseEntity: model.BaseEntity{ID: 10}, FileID: 20, VersionNo: 1},
		model.FileVersionDTO{FileID: 20, VersionNo: 1, OriginName: "sample.pdf"},
		DocumentProfile{FileType: "pdf"},
		model.OCRTask{
			ID:                30,
			Status:            model.OCRTaskStatusSucceeded,
			ResultPayloadJSON: payload,
			CreatedAt:         time.Now().UTC(),
			UpdatedAt:         time.Now().UTC(),
		},
	)
	if !ok {
		t.Fatal("expected parsed document")
	}
	if len(parsed.Slices) != 2 {
		t.Fatalf("slice count = %d", len(parsed.Slices))
	}
	for _, slice := range parsed.Slices {
		if slice.SliceType == model.DocumentStructureParagraph {
			t.Fatalf("unexpected paragraph slice: %#v", slice)
		}
	}
	dto := BuildFileParseResultDTO(parsed)
	if dto.Markdown != "## 完整 Markdown\n\n"+strings.Repeat("正文", 120) {
		t.Fatalf("markdown not preserved in dto: %q", dto.Markdown)
	}
	if dto.Text != "完整纯文本" {
		t.Fatalf("text not preserved in dto: %q", dto.Text)
	}
	if string(dto.Document) != `{"texts":[{"text":"完整"}]}` {
		t.Fatalf("document not preserved in dto: %s", string(dto.Document))
	}
	if len([]rune(dto.Slices[0].CleanText)) > 181 {
		t.Fatalf("slice preview should still be truncated: %q", dto.Slices[0].CleanText)
	}
}
