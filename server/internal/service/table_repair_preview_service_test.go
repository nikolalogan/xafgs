package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sxfgssever/server/internal/model"
)

type stubSystemConfigService struct {
	baseURL string
}

func (stub stubSystemConfigService) Get(_ context.Context) (model.SystemConfigDTO, *model.APIError) {
	return model.SystemConfigDTO{RemoteOCRTableBaseURL: stub.baseURL}, nil
}

func (stub stubSystemConfigService) Update(_ context.Context, _ model.UpdateSystemConfigRequest, _ int64) (model.SystemConfigDTO, *model.APIError) {
	return model.SystemConfigDTO{}, nil
}

func TestTableRepairPreviewServiceParseAndRepair_MultipartSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/recognize" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data;") {
			t.Fatalf("unexpected content-type: %s", r.Header.Get("Content-Type"))
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("parse form failed: %v", err)
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("file field missing: %v", err)
		}
		defer file.Close()
		if header.Filename == "" {
			t.Fatal("filename should not be empty")
		}
		if got := r.FormValue("file_type"); got != "1" {
			t.Fatalf("file_type = %q", got)
		}
		if got := r.FormValue("use_table_recognition"); got != "true" {
			t.Fatalf("use_table_recognition = %q", got)
		}
		if got := r.FormValue("detection_threshold"); got != "0.5" {
			t.Fatalf("detection_threshold = %q", got)
		}
		if got := r.FormValue("unknownField"); got != "" {
			t.Fatalf("unknownField should not be forwarded: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tables":[{"html":"<table></table>"}]}`))
	}))
	defer server.Close()

	svc := NewTableRepairPreviewService(stubSystemConfigService{baseURL: server.URL})
	imageBytes := []byte{0x89, 0x50, 0x4E, 0x47, 0x01}
	resp, apiErr := svc.ParseAndRepair(context.Background(), map[string]any{
		"file":                base64.StdEncoding.EncodeToString(imageBytes),
		"fileType":            1,
		"useTableRecognition": true,
		"detection_threshold": 0.5,
		"unknownField":        "x",
	})
	if apiErr != nil {
		t.Fatalf("unexpected api error: %+v", apiErr)
	}
	if _, ok := resp["tables"]; !ok {
		raw, _ := json.Marshal(resp)
		t.Fatalf("tables missing: %s", string(raw))
	}
}

func TestTableRepairPreviewServiceParseAndRepair_BadBase64(t *testing.T) {
	svc := NewTableRepairPreviewService(stubSystemConfigService{baseURL: "http://127.0.0.1:1"})
	_, apiErr := svc.ParseAndRepair(context.Background(), map[string]any{
		"file": "%%%invalid%%%",
	})
	if apiErr == nil {
		t.Fatal("expected api error")
	}
	if apiErr.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("status = %d", apiErr.HTTPStatus)
	}
	if !strings.Contains(apiErr.Message, "base64 无法解码") {
		t.Fatalf("message = %s", apiErr.Message)
	}
}

func TestTableRepairPreviewServiceParseAndRepair_Upstream404(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"detail":"not found"}`, http.StatusNotFound)
	}))
	defer server.Close()

	svc := NewTableRepairPreviewService(stubSystemConfigService{baseURL: server.URL})
	_, apiErr := svc.ParseAndRepair(context.Background(), map[string]any{
		"file": base64.StdEncoding.EncodeToString([]byte("%PDF-1.7")),
	})
	if apiErr == nil {
		t.Fatal("expected api error")
	}
	if apiErr.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("status = %d", apiErr.HTTPStatus)
	}
	if !strings.Contains(apiErr.Message, "上游接口不存在") {
		t.Fatalf("message = %s", apiErr.Message)
	}
}

func TestTableRepairPreviewServiceParseAndRepair_Upstream422(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"detail":[{"loc":["body","file"],"msg":"Field required"}]}`, http.StatusUnprocessableEntity)
	}))
	defer server.Close()

	svc := NewTableRepairPreviewService(stubSystemConfigService{baseURL: server.URL})
	_, apiErr := svc.ParseAndRepair(context.Background(), map[string]any{
		"file": base64.StdEncoding.EncodeToString([]byte("%PDF-1.7")),
	})
	if apiErr == nil {
		t.Fatal("expected api error")
	}
	if apiErr.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("status = %d", apiErr.HTTPStatus)
	}
	if !strings.Contains(apiErr.Message, "字段格式不符合 /api/recognize 契约") {
		t.Fatalf("message = %s", apiErr.Message)
	}
	if !strings.Contains(apiErr.Message, "Field required") {
		t.Fatalf("raw detail missing: %s", apiErr.Message)
	}
}

