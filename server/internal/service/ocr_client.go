package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type OCRClient interface {
	SubmitTask(ctx context.Context, request OCRTaskSubmitRequest) (OCRTaskSubmitResponse, error)
	GetTask(ctx context.Context, taskID string) (OCRTaskStatusResponse, error)
}

type HTTPOCRClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewHTTPOCRClient() OCRClient {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OCR_SERVICE_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "http://ocr-service:8090"
	}
	return &HTTPOCRClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

func (client *HTTPOCRClient) SubmitTask(ctx context.Context, request OCRTaskSubmitRequest) (OCRTaskSubmitResponse, error) {
	officialReq := map[string]any{
		"file":                request.ContentBase64,
		"fileType":            inferOfficialFileType(request.MimeType),
		"useTableRecognition": request.EnableTables,
		"visualize":           false,
	}
	var officialResp paddlexLayoutParsingResponse
	if err := client.postJSON(ctx, "/layout-parsing", officialReq, &officialResp); err != nil {
		return OCRTaskSubmitResponse{}, fmt.Errorf("official paddlex infer failed: %w", err)
	}
	if officialResp.ErrorCode != 0 {
		return OCRTaskSubmitResponse{}, fmt.Errorf(
			"official paddlex infer error: code=%d msg=%s",
			officialResp.ErrorCode,
			strings.TrimSpace(officialResp.ErrorMsg),
		)
	}

	result := convertOfficialResult(officialResp.Result)
	return OCRTaskSubmitResponse{
		TaskID:       strings.TrimSpace(officialResp.LogID),
		Status:       OCRTaskStatusSucceeded,
		Provider:     "paddlex_pp_structurev3_serving",
		Progress:     100,
		PageCount:    result.PageCount,
		Confidence:   result.Confidence,
		ErrorCode:    "",
		ErrorMessage: "",
		Result:       &result,
	}, nil
}

func (client *HTTPOCRClient) GetTask(ctx context.Context, taskID string) (OCRTaskStatusResponse, error) {
	if strings.TrimSpace(taskID) == "" {
		return OCRTaskStatusResponse{}, fmt.Errorf("empty task id")
	}
	url := fmt.Sprintf("%s/health", client.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return OCRTaskStatusResponse{}, err
	}
	resp, err := client.httpClient.Do(req)
	if err != nil {
		return OCRTaskStatusResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return OCRTaskStatusResponse{}, fmt.Errorf("ocr health check failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return OCRTaskStatusResponse{
		TaskID:    strings.TrimSpace(taskID),
		Status:    OCRTaskStatusSucceeded,
		Provider:  "paddlex_pp_structurev3_serving",
		Progress:  100,
		ErrorCode: "",
	}, nil
}

func (client *HTTPOCRClient) postJSON(ctx context.Context, path string, request any, response any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ocr submit task failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return json.NewDecoder(resp.Body).Decode(response)
}

const (
	OCRTaskStatusSucceeded = "succeeded"
)

type paddlexLayoutParsingResponse struct {
	LogID     string                      `json:"logId"`
	ErrorCode int                         `json:"errorCode"`
	ErrorMsg  string                      `json:"errorMsg"`
	Result    paddlexLayoutParsingPayload `json:"result"`
}

type paddlexLayoutParsingPayload struct {
	LayoutParsingResults []paddlexLayoutPage `json:"layoutParsingResults"`
}

type paddlexLayoutPage struct {
	PrunedResult map[string]any      `json:"prunedResult"`
	Markdown     paddlexMarkdownData `json:"markdown"`
}

type paddlexMarkdownData struct {
	Text string `json:"text"`
}

func inferOfficialFileType(mimeType string) int {
	if strings.EqualFold(strings.TrimSpace(mimeType), "application/pdf") {
		return 0
	}
	return 1
}

func convertOfficialResult(payload paddlexLayoutParsingPayload) OCRTaskResult {
	pages := make([]OCRResultPage, 0, len(payload.LayoutParsingResults))
	for idx, item := range payload.LayoutParsingResults {
		pageNo := idx + 1
		pageText := strings.TrimSpace(item.Markdown.Text)
		if pageText == "" {
			pageText = extractTextFromPrunedResult(item.PrunedResult)
		}
		blocks := make([]OCRResultBlock, 0, 1)
		if pageText != "" {
			blocks = append(blocks, OCRResultBlock{
				BlockNo: 1,
				Text:    pageText,
			})
		}
		pages = append(pages, OCRResultPage{
			PageNo: pageNo,
			Text:   pageText,
			Blocks: blocks,
			Tables: []OCRResultTable{},
		})
	}

	confidence := 0.0
	if len(pages) > 0 {
		confidence = 0.9
	}
	return OCRTaskResult{
		Provider:   "paddlex_pp_structurev3_serving",
		PageCount:  len(pages),
		Confidence: confidence,
		Language:   "ch",
		Pages:      pages,
	}
}

func extractTextFromPrunedResult(pruned map[string]any) string {
	if len(pruned) == 0 {
		return ""
	}
	candidates := []string{
		"markdown_text",
		"text",
	}
	for _, key := range candidates {
		if raw, ok := pruned[key]; ok {
			text := strings.TrimSpace(fmt.Sprintf("%v", raw))
			if text != "" {
				return text
			}
		}
	}

	parsing := extractListAny(pruned, "parsing_res_list", "parsingResList")
	parts := make([]string, 0, len(parsing))
	for _, item := range parsing {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content := extractStringAny(row, "block_content", "blockContent")
		if strings.TrimSpace(content) != "" {
			parts = append(parts, strings.TrimSpace(content))
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, "\n")
	}

	ocrRes := extractMapAny(pruned, "overall_ocr_res", "overallOcrRes")
	if len(ocrRes) == 0 {
		return ""
	}
	recTexts := extractListAny(ocrRes, "rec_texts", "recTexts")
	lines := make([]string, 0, len(recTexts))
	for _, text := range recTexts {
		s := strings.TrimSpace(fmt.Sprintf("%v", text))
		if s != "" {
			lines = append(lines, s)
		}
	}
	return strings.Join(lines, "\n")
}

func extractMapAny(raw map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if parsed, ok := value.(map[string]any); ok {
				return parsed
			}
		}
	}
	return map[string]any{}
}

func extractListAny(raw map[string]any, keys ...string) []any {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if parsed, ok := value.([]any); ok {
				return parsed
			}
		}
	}
	return []any{}
}

func extractStringAny(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			switch typed := value.(type) {
			case string:
				return typed
			case float64:
				return strconv.FormatFloat(typed, 'f', -1, 64)
			default:
				return fmt.Sprintf("%v", typed)
			}
		}
	}
	return ""
}
