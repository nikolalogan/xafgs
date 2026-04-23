package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"sxfgssever/server/internal/model"
)

type HTTPDoclingClient struct {
	baseURL    string
	httpClient *http.Client
	results    sync.Map
}

type doclingConvertRequest struct {
	File     string `json:"file"`
	Filename string `json:"filename"`
}

type doclingConvertResponse struct {
	Filename             string         `json:"filename"`
	DurationMs           int            `json:"durationMs"`
	Markdown             string         `json:"markdown"`
	Text                 string         `json:"text"`
	Document             map[string]any `json:"document"`
	ImageOCRApplied      bool           `json:"imageOcrApplied"`
	ImageOCRCount        int            `json:"imageOcrCount"`
	ImageOCRSkippedCount int            `json:"imageOcrSkippedCount"`
}

type doclingTextBlock struct {
	PageNo     int
	Text       string
	BBox       []float64
	DoclingRef string
}

func NewHTTPDoclingClient() OCRClient {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("DOCLING_SERVICE_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "http://docling-service:8091"
	}
	return &HTTPDoclingClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func (client *HTTPDoclingClient) SubmitTask(ctx context.Context, request OCRTaskSubmitRequest) (OCRTaskSubmitResponse, error) {
	payload := doclingConvertRequest{
		File:     request.ContentBase64,
		Filename: strings.TrimSpace(request.FileName),
	}
	var raw doclingConvertResponse
	if err := client.postJSON(ctx, "/convert", payload, &raw); err != nil {
		return OCRTaskSubmitResponse{}, fmt.Errorf("submit docling task failed: %w", err)
	}
	result := mapDoclingResponseToTaskResult(raw)
	taskID := buildDoclingTaskID(raw.Filename)
	response := OCRTaskSubmitResponse{
		TaskID:     taskID,
		Status:     model.OCRTaskStatusSucceeded,
		Provider:   "docling",
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

func (client *HTTPDoclingClient) GetTask(_ context.Context, taskID string) (OCRTaskStatusResponse, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return OCRTaskStatusResponse{}, fmt.Errorf("empty task id")
	}
	if status, ok := client.results.Load(taskID); ok {
		return status.(OCRTaskStatusResponse), nil
	}
	return OCRTaskStatusResponse{}, fmt.Errorf("query docling task failed: status=404 body=task not found")
}

func (client *HTTPDoclingClient) postJSON(ctx context.Context, path string, request any, response any) error {
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

func mapDoclingResponseToTaskResult(payload doclingConvertResponse) OCRTaskResult {
	pageCount := extractDoclingPageCount(payload.Document)
	blocksByPage := collectDoclingBlocks(payload.Document)
	documentJSON, _ := json.Marshal(payload.Document)
	if len(blocksByPage) == 0 {
		text := normalizeText(payload.Text)
		if text == "" {
			text = normalizeText(payload.Markdown)
		}
		if text != "" {
			blocksByPage[1] = []doclingTextBlock{{
				PageNo: 1,
				Text:   text,
			}}
		}
	}
	pageNos := make([]int, 0, len(blocksByPage))
	for pageNo := range blocksByPage {
		pageNos = append(pageNos, pageNo)
	}
	sort.Ints(pageNos)
	pages := make([]OCRResultPage, 0, len(pageNos))
	for _, pageNo := range pageNos {
		blocks := make([]OCRResultBlock, 0, len(blocksByPage[pageNo]))
		parts := make([]string, 0, len(blocksByPage[pageNo]))
		for index, item := range dedupeDoclingBlocks(blocksByPage[pageNo]) {
			if strings.TrimSpace(item.Text) == "" {
				continue
			}
			parts = append(parts, item.Text)
			blocks = append(blocks, OCRResultBlock{
				BlockNo: index + 1,
				BBox:    item.BBox,
				Text:    item.Text,
			})
		}
		pageText := dedupAndJoinLines(parts)
		if pageText == "" {
			continue
		}
		pages = append(pages, OCRResultPage{
			PageNo: max(1, pageNo),
			Text:   pageText,
			Blocks: blocks,
		})
	}
	if len(pages) == 0 {
		pages = append(pages, OCRResultPage{
			PageNo: 1,
			Text:   strings.TrimSpace(payload.Filename),
		})
	}
	if pageCount < len(pages) {
		pageCount = len(pages)
	}
	return OCRTaskResult{
		Provider:   "docling",
		PageCount:  max(1, pageCount),
		Confidence: 0.92,
		Language:   "zh",
		Markdown:   strings.TrimSpace(payload.Markdown),
		Text:       strings.TrimSpace(payload.Text),
		Document:   documentJSON,
		Pages:      pages,
	}
}

func extractDoclingPageCount(document map[string]any) int {
	pages, ok := document["pages"]
	if !ok {
		return 0
	}
	switch typed := pages.(type) {
	case []any:
		return len(typed)
	case map[string]any:
		return len(typed)
	default:
		return 0
	}
}

func collectDoclingBlocks(document map[string]any) map[int][]doclingTextBlock {
	out := make(map[int][]doclingTextBlock)
	var walk func(value any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			pageNo, bbox, doclingRef, ok := extractDoclingLocator(typed)
			text := extractDoclingNodeText(typed)
			if ok && text != "" {
				out[max(1, pageNo)] = append(out[max(1, pageNo)], doclingTextBlock{
					PageNo:     max(1, pageNo),
					Text:       text,
					BBox:       bbox,
					DoclingRef: doclingRef,
				})
			}
			for _, child := range typed {
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(document)
	return out
}

func extractDoclingLocator(node map[string]any) (int, []float64, string, bool) {
	if pageNo := toInt(node["page_no"]); pageNo > 0 {
		return pageNo, parseBBox(node["bbox"]), strings.TrimSpace(firstString(node["self_ref"], node["label"])), true
	}
	provItems, ok := node["prov"].([]any)
	if !ok || len(provItems) == 0 {
		return 0, nil, "", false
	}
	firstProv, ok := provItems[0].(map[string]any)
	if !ok {
		return 0, nil, "", false
	}
	pageNo := toInt(firstProv["page_no"])
	if pageNo <= 0 {
		return 0, nil, "", false
	}
	bbox := parseBBox(firstProv["bbox"])
	if len(bbox) == 0 {
		bbox = parseBBox(node["bbox"])
	}
	return pageNo, bbox, strings.TrimSpace(firstString(node["self_ref"], node["label"])), true
}

func extractDoclingNodeText(node map[string]any) string {
	text := normalizeText(firstString(node["text"], node["orig"], node["content"]))
	if text == "" {
		return ""
	}
	if _, hasProv := node["prov"]; hasProv {
		return text
	}
	if strings.TrimSpace(firstString(node["self_ref"], node["label"])) != "" {
		return text
	}
	return ""
}

func dedupeDoclingBlocks(items []doclingTextBlock) []doclingTextBlock {
	seen := map[string]bool{}
	out := make([]doclingTextBlock, 0, len(items))
	for _, item := range items {
		key := strings.TrimSpace(item.DoclingRef) + "|" + normalizeText(item.Text)
		if key == "|" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func buildDoclingTaskID(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return fmt.Sprintf("docling-%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("docling-%d-%s", time.Now().UnixNano(), strings.ReplaceAll(filename, " ", "_"))
}
