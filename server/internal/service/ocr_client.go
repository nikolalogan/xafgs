package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type OCRClient interface {
	SubmitTask(ctx context.Context, request OCRTaskSubmitRequest) (OCRTaskSubmitResponse, error)
	GetTask(ctx context.Context, taskID string) (OCRTaskStatusResponse, error)
}

type HTTPOCRClient struct {
	baseURL    string
	httpClient *http.Client
	results    sync.Map
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
	fileType := resolveOfficialFileType(request.MimeType, request.FileName, request.ContentBase64)
	payload := map[string]any{
		"file":                             request.ContentBase64,
		"fileType":                         fileType,
		"useTableRecognition":              request.EnableTables,
		"useRegionDetection":               true,
		"useFormulaRecognition":            true,
		"useWiredTableCellsTransToHtml":    true,
		"useWirelessTableCellsTransToHtml": true,
		"visualize":                        false,
	}
	var raw officialLayoutParsingResponse
	if err := client.postOfficialLayoutParsing(ctx, payload, &raw); err != nil {
		return OCRTaskSubmitResponse{}, fmt.Errorf("submit ocr task failed: %w", err)
	}
	result, err := mapOfficialResponseToTaskResult(raw)
	if err != nil {
		return OCRTaskSubmitResponse{}, fmt.Errorf("parse ocr result failed: %w", err)
	}
	taskID := buildOfficialTaskID(raw.LogID)
	response := OCRTaskSubmitResponse{
		TaskID:     taskID,
		Status:     "succeeded",
		Provider:   "glm-ocr",
		Progress:   100,
		PageCount:  result.PageCount,
		Confidence: result.Confidence,
		Result:     &result,
	}
	client.results.Store(taskID, OCRTaskStatusResponse{
		TaskID:     response.TaskID,
		Status:     response.Status,
		Provider:   response.Provider,
		Progress:   response.Progress,
		PageCount:  response.PageCount,
		Confidence: response.Confidence,
		Result:     response.Result,
	})
	return response, nil
}

func (client *HTTPOCRClient) postOfficialLayoutParsing(ctx context.Context, payload map[string]any, response any) error {
	requestPayload := cloneAnyMap(payload)
	err := client.postJSON(ctx, "/layout-parsing", requestPayload, response)
	if err == nil {
		return nil
	}
	if !isPDFiumDataFormatError(err) {
		return err
	}
	fileType, ok := parseAnyInt(requestPayload["fileType"])
	if !ok || (fileType != 0 && fileType != 1) {
		return err
	}
	requestPayload["fileType"] = 1 - fileType
	return client.postJSON(ctx, "/layout-parsing", requestPayload, response)
}

func (client *HTTPOCRClient) GetTask(ctx context.Context, taskID string) (OCRTaskStatusResponse, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return OCRTaskStatusResponse{}, fmt.Errorf("empty task id")
	}
	if status, ok := client.results.Load(taskID); ok {
		return status.(OCRTaskStatusResponse), nil
	}
	return OCRTaskStatusResponse{}, fmt.Errorf("query ocr task failed: status=404 body=task not found")
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
		return fmt.Errorf("status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return json.NewDecoder(resp.Body).Decode(response)
}

type officialLayoutParsingResponse struct {
	LogID     string `json:"logId"`
	ErrorCode int    `json:"errorCode"`
	ErrorMsg  string `json:"errorMsg"`
	Result    struct {
		LayoutParsingResults []struct {
			PrunedResult map[string]any `json:"prunedResult"`
			Markdown     struct {
				Text string `json:"text"`
			} `json:"markdown"`
		} `json:"layoutParsingResults"`
	} `json:"result"`
}

func mapOfficialResponseToTaskResult(payload officialLayoutParsingResponse) (OCRTaskResult, error) {
	if payload.ErrorCode != 0 {
		return OCRTaskResult{}, fmt.Errorf("official ocr error: code=%d msg=%s", payload.ErrorCode, strings.TrimSpace(payload.ErrorMsg))
	}
	pages := make([]OCRResultPage, 0, len(payload.Result.LayoutParsingResults))
	for index, item := range payload.Result.LayoutParsingResults {
		pageNo := index + 1
		pageText := normalizeText(item.Markdown.Text)
		blocks := parseOfficialBlocks(item.PrunedResult)
		if pageText == "" {
			lines := make([]string, 0, len(blocks))
			for _, block := range blocks {
				if text := normalizeText(block.Text); text != "" {
					lines = append(lines, text)
				}
			}
			pageText = strings.Join(lines, "\n")
		}
		pages = append(pages, OCRResultPage{
			PageNo: pageNo,
			Text:   pageText,
			Blocks: blocks,
			Tables: parseOfficialTables(item.PrunedResult),
		})
	}
	if len(pages) == 0 {
		return OCRTaskResult{}, fmt.Errorf("empty layoutParsingResults")
	}
	return OCRTaskResult{
		Provider:   "glm-ocr",
		PageCount:  len(pages),
		Confidence: 0.9,
		Language:   "zh",
		Pages:      pages,
	}, nil
}

func parseOfficialBlocks(pruned map[string]any) []OCRResultBlock {
	results, ok := pruned["parsing_res_list"].([]any)
	if !ok {
		return nil
	}
	blocks := make([]OCRResultBlock, 0, len(results))
	for index, item := range results {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text := normalizeText(firstString(
			row["block_content"],
			row["text"],
			row["content"],
			row["markdown"],
			row["md"],
		))
		if text == "" {
			continue
		}
		blocks = append(blocks, OCRResultBlock{
			BlockNo: index + 1,
			BBox:    parseBBox(row["block_bbox"]),
			Text:    text,
		})
	}
	return blocks
}

func parseOfficialTables(pruned map[string]any) []OCRResultTable {
	results, ok := pruned["parsing_res_list"].([]any)
	if !ok {
		return nil
	}
	tables := make([]OCRResultTable, 0)
	for index, item := range results {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := strings.ToLower(strings.TrimSpace(firstString(row["block_label"], row["label"], row["type"])))
		if !strings.Contains(label, "table") {
			continue
		}
		htmlText := strings.TrimSpace(firstString(row["block_content"], row["text"], row["content"]))
		if htmlText == "" {
			continue
		}
		table := OCRResultTable{
			TableNo: index + 1,
			BBox:    parseBBox(row["block_bbox"]),
			Rows:    [][]string{{htmlText}},
			Cells: []OCRResultCell{
				{
					RowIndex:   0,
					ColIndex:   0,
					RowSpan:    1,
					ColSpan:    1,
					Text:       htmlText,
					Confidence: 0.9,
				},
			},
		}
		tables = append(tables, table)
	}
	return tables
}

func parseBBox(value any) []float64 {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	bbox := make([]float64, 0, len(items))
	for _, item := range items {
		switch typed := item.(type) {
		case float64:
			bbox = append(bbox, typed)
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
				bbox = append(bbox, parsed)
			}
		}
	}
	if len(bbox) < 4 {
		return nil
	}
	return bbox
}

func firstString(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			text := strings.TrimSpace(typed)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func buildOfficialTaskID(logID string) string {
	logID = strings.TrimSpace(logID)
	if logID != "" {
		return "official-" + logID
	}
	return fmt.Sprintf("official-%d", time.Now().UnixNano())
}

func resolveOfficialFileType(mimeType string, fileName string, contentBase64 string) int {
	kind := detectBinaryKind(contentBase64)
	switch kind {
	case "pdf":
		return 0
	case "image":
		return 1
	}
	lowerMime := strings.ToLower(strings.TrimSpace(mimeType))
	lowerName := strings.ToLower(strings.TrimSpace(fileName))
	if strings.Contains(lowerMime, "application/pdf") || strings.HasSuffix(lowerName, ".pdf") {
		return 0
	}
	if strings.HasPrefix(lowerMime, "image/") || strings.HasSuffix(lowerName, ".png") || strings.HasSuffix(lowerName, ".jpg") || strings.HasSuffix(lowerName, ".jpeg") || strings.HasSuffix(lowerName, ".bmp") || strings.HasSuffix(lowerName, ".gif") || strings.HasSuffix(lowerName, ".webp") || strings.HasSuffix(lowerName, ".tif") || strings.HasSuffix(lowerName, ".tiff") {
		return 1
	}
	return 0
}

func detectBinaryKind(contentBase64 string) string {
	trimmed := strings.TrimSpace(contentBase64)
	if trimmed == "" {
		return ""
	}
	raw := []byte(trimmed)
	decoded := make([]byte, base64.StdEncoding.DecodedLen(len(raw)))
	size, err := base64.StdEncoding.Decode(decoded, raw)
	if err != nil || size <= 0 {
		return ""
	}
	decoded = decoded[:size]
	if len(decoded) >= 5 && bytes.HasPrefix(decoded, []byte("%PDF-")) {
		return "pdf"
	}
	if len(decoded) >= 3 && bytes.HasPrefix(decoded, []byte{0xFF, 0xD8, 0xFF}) {
		return "image"
	}
	if len(decoded) >= 4 && bytes.HasPrefix(decoded, []byte{0x89, 0x50, 0x4E, 0x47}) {
		return "image"
	}
	if len(decoded) >= 4 && bytes.HasPrefix(decoded, []byte("GIF8")) {
		return "image"
	}
	if len(decoded) >= 2 && bytes.HasPrefix(decoded, []byte("BM")) {
		return "image"
	}
	if len(decoded) >= 4 && (bytes.HasPrefix(decoded, []byte{0x49, 0x49, 0x2A, 0x00}) || bytes.HasPrefix(decoded, []byte{0x4D, 0x4D, 0x00, 0x2A})) {
		return "image"
	}
	if len(decoded) >= 12 && bytes.Equal(decoded[0:4], []byte("RIFF")) && bytes.Equal(decoded[8:12], []byte("WEBP")) {
		return "image"
	}
	return ""
}

func parseAnyInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return int(parsed), true
		}
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func cloneAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}
