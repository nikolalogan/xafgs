package service

import (
	"testing"

	"sxfgssever/server/internal/model"
)

func TestChooseParseStatus_OCRTaskFailed(t *testing.T) {
	status := chooseParseStatus(ParsedDocument{
		Profile: DocumentProfile{
			FileType:      "pdf",
			ParseStrategy: "image_ocr_failed",
		},
		OCRTask: &model.OCRTask{
			Status:       model.OCRTaskStatusFailed,
			ErrorMessage: "table recognition failed",
		},
		Slices: []model.DocumentSlice{
			{ParseStatus: model.DocumentParseStatusParsed},
		},
	})
	if status != model.DocumentParseStatusFailed {
		t.Fatalf("expected failed status, got %s", status)
	}
}

func TestChooseParseStatus_OCRTaskPending(t *testing.T) {
	status := chooseParseStatus(ParsedDocument{
		Profile: DocumentProfile{
			FileType:      "docx",
			ParseStrategy: "image_ocr_pending",
		},
		OCRTask: &model.OCRTask{
			Status: model.OCRTaskStatusPending,
		},
		Slices: []model.DocumentSlice{
			{ParseStatus: model.DocumentParseStatusParsed},
		},
	})
	if status != model.DocumentParseStatusNeedsOCR {
		t.Fatalf("expected needs_ocr status, got %s", status)
	}
}

func TestBuildParseFailureMessage_PrioritizeOCRTaskError(t *testing.T) {
	message := buildParseFailureMessage(ParsedDocument{
		Profile: DocumentProfile{
			ParseStrategy: "image_ocr_failed",
		},
		OCRTask: &model.OCRTask{
			Status:       model.OCRTaskStatusFailed,
			ErrorMessage: "table structure parse failed",
		},
	})
	if message == "" || message == "文件解析失败" {
		t.Fatalf("expected detailed message, got %q", message)
	}
}
