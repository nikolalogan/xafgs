package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
	"net/url"
	"strconv"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
)

type TableRepairPreviewService interface {
	ParseAndRepair(ctx context.Context, payload map[string]any) (map[string]any, *model.APIError)
}

type tableRepairPreviewService struct {
	systemConfigService SystemConfigService
	authMode   string
	baseHost   string
	httpClient *http.Client
}

func NewTableRepairPreviewService(systemConfigService SystemConfigService) TableRepairPreviewService {
	authMode := "none"
	baseHost := ""
	return &tableRepairPreviewService{
		systemConfigService: systemConfigService,
		authMode:   authMode,
		baseHost:   baseHost,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

func (service *tableRepairPreviewService) ParseAndRepair(ctx context.Context, payload map[string]any) (map[string]any, *model.APIError) {
	file := strings.TrimSpace(getString(payload["file"]))
	if file == "" {
		return nil, model.NewAPIError(http.StatusBadRequest, response.CodeBadRequest, "file 不能为空")
	}

	modelName := normalizePreviewModel(payload["model"])
	if modelName == "" {
		return nil, model.NewAPIError(http.StatusBadRequest, response.CodeBadRequest, "model 参数无效，仅支持 glm_ocr")
	}

	requestPayload := cloneMap(payload)
	requestPayload["model"] = modelName
	delete(requestPayload, "enableVLTableCorrection")

	ocrResponse := map[string]any{}
	if err := service.postOfficialLayoutParsing(ctx, requestPayload, &ocrResponse); err != nil {
		return nil, model.NewAPIError(http.StatusBadGateway, response.CodeInternal, service.buildReadableError(err))
	}

	tableRepairMeta := repairOCRResponseTables(ocrResponse)
	metaExtensions := map[string]any{
		"tableRepairMeta": tableRepairMeta,
	}
	ocrResponse["metaExtensions"] = metaExtensions
	delete(ocrResponse, "tableRepairMeta")
	delete(ocrResponse, "tableCorrectionMeta")
	ocrResponse["modelMeta"] = map[string]any{
		"model":             modelName,
		"provider":          "glm-ocr",
		"endpoint":          "/layout-parsing",
		"csvSpanPolicy":     "top_left_with_merged_marker",
		"mergedCellMarker":  defaultMergedMarker,
		"snapTolerancePx":   tableGridSnapTolerancePx(),
		"fallbackThreshold": tableGridConflictFallbackThreshold(),
	}
	return ocrResponse, nil
}

func (service *tableRepairPreviewService) postOfficialLayoutParsing(ctx context.Context, payload map[string]any, responseBody any) error {
	baseURL, err := service.resolveBaseURL(ctx)
	if err != nil {
		return err
	}
	requestPayload := cloneMap(payload)
	err = service.postJSON(ctx, baseURL+"/layout-parsing", requestPayload, responseBody)
	if err == nil {
		return nil
	}
	if !isPDFiumDataFormatError(err) {
		return err
	}
	fileType, ok := getOptionalInt(requestPayload["fileType"])
	if !ok || (fileType != 0 && fileType != 1) {
		return err
	}
	requestPayload["fileType"] = 1 - fileType
	return service.postJSON(ctx, baseURL+"/layout-parsing", requestPayload, responseBody)
}

func (service *tableRepairPreviewService) postJSON(ctx context.Context, url string, requestBody any, responseBody any) error {
	raw, err := json.Marshal(requestBody)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	resp, err := service.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return &httpError{statusCode: resp.StatusCode, body: strings.TrimSpace(string(body))}
	}
	return json.NewDecoder(resp.Body).Decode(responseBody)
}

func (service *tableRepairPreviewService) buildReadableError(err error) string {
	raw := strings.TrimSpace(err.Error())
	envHint := ""
	if service.baseHost != "" {
		envHint = "（baseHost=" + service.baseHost + ", authMode=" + service.authMode + "）"
	}
	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(lower, "status=401"):
		return "调用 OCR 服务失败: 鉴权配置不匹配" + envHint + "；原始错误: " + raw
	case strings.Contains(lower, "status=403"):
		return "调用 OCR 服务失败: 上游拒绝访问" + envHint + "；原始错误: " + raw
	case strings.Contains(lower, "不可达"), strings.Contains(lower, "connection refused"), strings.Contains(lower, "no such host"), strings.Contains(lower, "timeout"):
		return "调用 OCR 服务失败: 远程 OCRTable 上游不可达，请检查系统设置中的 remoteOcrTableBaseUrl" + envHint + "；原始错误: " + raw
	default:
		return "调用 OCR 服务失败: " + raw + envHint
	}
}

func (service *tableRepairPreviewService) resolveBaseURL(ctx context.Context) (string, error) {
	config, apiError := service.systemConfigService.Get(ctx)
	if apiError != nil {
		return "", fmt.Errorf("load system config failed: %s", apiError.Message)
	}
	baseURL := strings.TrimRight(strings.TrimSpace(config.RemoteOCRTableBaseURL), "/")
	if baseURL == "" {
		return "", fmt.Errorf("系统设置未配置远程 OCRTable 地址")
	}
	if parsed, err := url.Parse(baseURL); err == nil {
		service.baseHost = parsed.Hostname()
	}
	return baseURL, nil
}

type httpError struct {
	statusCode int
	body       string
}

func (err *httpError) Error() string {
	return "status=" + strconv.Itoa(err.statusCode) + " body=" + err.body
}

func getString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	}
	return ""
}

func getOptionalInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed), true
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func isPDFiumDataFormatError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	if message == "" {
		return false
	}
	return strings.Contains(message, "status=422") && strings.Contains(message, "pdfium: data format error")
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func normalizePreviewModel(value any) string {
	raw := strings.ToLower(strings.TrimSpace(getString(value)))
	switch raw {
	case "", "glm_ocr", "glm-ocr", "glmocr":
		return "glm_ocr"
	default:
		return ""
	}
}
