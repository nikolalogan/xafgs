package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"io"
	"mime"
	"net/http"
	"time"
	"net/url"
	"path/filepath"
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
	requestPayload := cloneMap(payload)
	delete(requestPayload, "enableVLTableCorrection")
	delete(requestPayload, "model")

	ocrResponse := map[string]any{}
	if err := service.postTATRRecognize(ctx, requestPayload, &ocrResponse); err != nil {
		return nil, model.NewAPIError(http.StatusBadGateway, response.CodeInternal, service.buildReadableError(err))
	}
	return ocrResponse, nil
}

func (service *tableRepairPreviewService) postTATRRecognize(ctx context.Context, payload map[string]any, responseBody any) error {
	baseURL, err := service.resolveBaseURL(ctx)
	if err != nil {
		return err
	}
	requestPayload := cloneMap(payload)
	err = service.postMultipart(ctx, baseURL+"/api/recognize", requestPayload, responseBody)
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
	return service.postMultipart(ctx, baseURL+"/api/recognize", requestPayload, responseBody)
}

func (service *tableRepairPreviewService) postMultipart(ctx context.Context, endpoint string, requestBody map[string]any, responseBody any) error {
	fileRaw := strings.TrimSpace(getString(requestBody["file"]))
	fileBytes, err := decodeBase64Payload(fileRaw)
	if err != nil {
		return err
	}
	filename, _ := resolveUploadMeta(fileBytes, requestBody)
	delete(requestBody, "file")
	formFields := buildTATRFormFields(requestBody)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return err
	}
	if _, err = fileWriter.Write(fileBytes); err != nil {
		return err
	}
	for key, value := range formFields {
		if err = writer.WriteField(key, value); err != nil {
			return err
		}
	}
	if err = writer.Close(); err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())

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
		return "调用 TATR 服务失败: 鉴权配置不匹配" + envHint + "；原始错误: " + raw
	case strings.Contains(lower, "status=403"):
		return "调用 TATR 服务失败: 上游拒绝访问" + envHint + "；原始错误: " + raw
	case strings.Contains(lower, "status=404"):
		return "调用 TATR 服务失败: 上游接口不存在，请检查 remoteOcrTableBaseUrl 是否指向 TATR 服务根地址（应包含 /api/recognize）" + envHint + "；原始错误: " + raw
	case strings.Contains(lower, "status=422"):
		return "调用 TATR 服务失败: 请求体已转发到 TATR，但字段格式不符合 /api/recognize 契约" + envHint + "；原始错误: " + raw
	case strings.Contains(lower, "不可达"), strings.Contains(lower, "connection refused"), strings.Contains(lower, "no such host"), strings.Contains(lower, "timeout"):
		return "调用 TATR 服务失败: 上游不可达，请检查系统设置中的 remoteOcrTableBaseUrl" + envHint + "；原始错误: " + raw
	default:
		return "调用 TATR 服务失败: " + raw + envHint
	}
}

func (service *tableRepairPreviewService) resolveBaseURL(ctx context.Context) (string, error) {
	config, apiError := service.systemConfigService.Get(ctx)
	if apiError != nil {
		return "", fmt.Errorf("load system config failed: %s", apiError.Message)
	}
	baseURL := strings.TrimRight(strings.TrimSpace(config.RemoteOCRTableBaseURL), "/")
	if baseURL == "" {
		return "", fmt.Errorf("系统设置未配置 TATR 服务地址")
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

var tableRecognizeAllowedFields = map[string]string{
	"fileType":                    "file_type",
	"file_type":                   "file_type",
	"visualize":                   "visualize",
	"logId":                       "log_id",
	"log_id":                      "log_id",
	"detection_threshold":         "detection_threshold",
	"structure_threshold":         "structure_threshold",
	"use_table_deskew":            "use_table_deskew",
	"useDocOrientationClassify":   "use_doc_orientation_classify",
	"use_doc_orientation_classify": "use_doc_orientation_classify",
	"useDocUnwarping":             "use_doc_unwarping",
	"use_doc_unwarping":           "use_doc_unwarping",
	"useTextlineOrientation":      "use_textline_orientation",
	"use_textline_orientation":    "use_textline_orientation",
	"useSealRecognition":          "use_seal_recognition",
	"use_seal_recognition":        "use_seal_recognition",
	"useTableRecognition":         "use_table_recognition",
	"use_table_recognition":       "use_table_recognition",
	"useFormulaRecognition":       "use_formula_recognition",
	"use_formula_recognition":     "use_formula_recognition",
	"useChartRecognition":         "use_chart_recognition",
	"use_chart_recognition":       "use_chart_recognition",
	"useRegionDetection":          "use_region_detection",
	"use_region_detection":        "use_region_detection",
	"formatBlockContent":          "format_block_content",
	"format_block_content":        "format_block_content",
	"layoutNms":                   "layout_nms",
	"layout_nms":                  "layout_nms",
	"layoutThreshold":             "layout_threshold",
	"layout_threshold":            "layout_threshold",
	"layoutUnclipRatio":           "layout_unclip_ratio",
	"layout_unclip_ratio":         "layout_unclip_ratio",
	"layoutMergeBboxesMode":       "layout_merge_bboxes_mode",
	"layout_merge_bboxes_mode":    "layout_merge_bboxes_mode",
	"textDetLimitSideLen":         "text_det_limit_side_len",
	"text_det_limit_side_len":     "text_det_limit_side_len",
	"textDetLimitType":            "text_det_limit_type",
	"text_det_limit_type":         "text_det_limit_type",
	"textDetThresh":               "text_det_thresh",
	"text_det_thresh":             "text_det_thresh",
	"textDetBoxThresh":            "text_det_box_thresh",
	"text_det_box_thresh":         "text_det_box_thresh",
	"textDetUnclipRatio":          "text_det_unclip_ratio",
	"text_det_unclip_ratio":       "text_det_unclip_ratio",
	"textRecScoreThresh":          "text_rec_score_thresh",
	"text_rec_score_thresh":       "text_rec_score_thresh",
	"sealDetLimitSideLen":         "seal_det_limit_side_len",
	"seal_det_limit_side_len":     "seal_det_limit_side_len",
	"sealDetLimitType":            "seal_det_limit_type",
	"seal_det_limit_type":         "seal_det_limit_type",
	"sealDetThresh":               "seal_det_thresh",
	"seal_det_thresh":             "seal_det_thresh",
	"sealDetBoxThresh":            "seal_det_box_thresh",
	"seal_det_box_thresh":         "seal_det_box_thresh",
	"sealDetUnclipRatio":          "seal_det_unclip_ratio",
	"seal_det_unclip_ratio":       "seal_det_unclip_ratio",
	"sealRecScoreThresh":          "seal_rec_score_thresh",
	"seal_rec_score_thresh":       "seal_rec_score_thresh",
	"useWiredTableCellsTransToHtml": "use_wired_table_cells_trans_to_html",
	"use_wired_table_cells_trans_to_html": "use_wired_table_cells_trans_to_html",
	"useWirelessTableCellsTransToHtml": "use_wireless_table_cells_trans_to_html",
	"use_wireless_table_cells_trans_to_html": "use_wireless_table_cells_trans_to_html",
	"useTableOrientationClassify": "use_table_orientation_classify",
	"use_table_orientation_classify": "use_table_orientation_classify",
	"useOcrResultsWithTableCells": "use_ocr_results_with_table_cells",
	"use_ocr_results_with_table_cells": "use_ocr_results_with_table_cells",
	"useE2eWiredTableRecModel":    "use_e2e_wired_table_rec_model",
	"use_e2e_wired_table_rec_model": "use_e2e_wired_table_rec_model",
	"useE2eWirelessTableRecModel": "use_e2e_wireless_table_rec_model",
	"use_e2e_wireless_table_rec_model": "use_e2e_wireless_table_rec_model",
	"markdownIgnoreLabels":        "markdown_ignore_labels",
	"markdown_ignore_labels":      "markdown_ignore_labels",
	"prettifyMarkdown":            "prettify_markdown",
	"prettify_markdown":           "prettify_markdown",
	"showFormulaNumber":           "show_formula_number",
	"show_formula_number":         "show_formula_number",
}

func buildTATRFormFields(payload map[string]any) map[string]string {
	result := make(map[string]string)
	for key, value := range payload {
		mapped, ok := tableRecognizeAllowedFields[key]
		if !ok {
			continue
		}
		text := toFormValue(value)
		if text == "" {
			continue
		}
		result[mapped] = text
	}
	return result
}

func toFormValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case bool:
		return strconv.FormatBool(typed)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case json.Number:
		return typed.String()
	case []string:
		trimmed := make([]string, 0, len(typed))
		for _, item := range typed {
			item = strings.TrimSpace(item)
			if item != "" {
				trimmed = append(trimmed, item)
			}
		}
		return strings.Join(trimmed, ",")
	case []any:
		trimmed := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(toFormValue(item))
			if text != "" {
				trimmed = append(trimmed, text)
			}
		}
		return strings.Join(trimmed, ",")
	}
	return ""
}

func decodeBase64Payload(file string) ([]byte, error) {
	payload := strings.TrimSpace(file)
	if payload == "" {
		return nil, fmt.Errorf("file 不能为空")
	}
	if idx := strings.Index(payload, ","); idx >= 0 && strings.Contains(payload[:idx], ";base64") {
		payload = payload[idx+1:]
	}
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, fmt.Errorf("file base64 无法解码: %w", err)
	}
	if len(decoded) == 0 {
		return nil, fmt.Errorf("file base64 无法解码: 内容为空")
	}
	return decoded, nil
}

func resolveUploadMeta(fileBytes []byte, payload map[string]any) (string, string) {
	fileType, hasFileType := getOptionalInt(payload["fileType"])
	binaryKind := detectBinaryKind(base64.StdEncoding.EncodeToString(fileBytes))
	if !hasFileType {
		if binaryKind == "image" {
			fileType = 1
		}
	}
	if fileType == 1 {
		return "upload.png", "image/png"
	}
	if binaryKind == "image" {
		contentType := http.DetectContentType(fileBytes)
		exts, _ := mime.ExtensionsByType(contentType)
		ext := ".png"
		if len(exts) > 0 {
			ext = exts[0]
		}
		return "upload" + filepath.Clean(ext), contentType
	}
	return "upload.pdf", "application/pdf"
}

