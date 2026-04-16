package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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
	var response OCRTaskSubmitResponse
	if err := client.postJSON(ctx, "/api/ocr/tasks", request, &response); err != nil {
		return OCRTaskSubmitResponse{}, fmt.Errorf("submit ocr task failed: %w", err)
	}
	return response, nil
}

func (client *HTTPOCRClient) GetTask(ctx context.Context, taskID string) (OCRTaskStatusResponse, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return OCRTaskStatusResponse{}, fmt.Errorf("empty task id")
	}
	url := fmt.Sprintf("%s/api/ocr/tasks/%s", client.baseURL, taskID)
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
		return OCRTaskStatusResponse{}, fmt.Errorf("query ocr task failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var payload OCRTaskStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return OCRTaskStatusResponse{}, err
	}
	return payload, nil
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
