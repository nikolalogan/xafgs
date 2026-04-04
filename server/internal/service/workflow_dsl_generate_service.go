package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
)

const (
	maxWorkflowGenerateFileBytes int64 = 50 * 1024 * 1024
	maxWorkflowBinarySnippet     int   = 256 * 1024
	workflowGenerateTimeoutBase        = 90 * time.Second
	workflowGenerateTimeoutMax         = 300 * time.Second
)

type WorkflowDSLGenerateRequest struct {
	Model       string
	Description string
	FileID      int64
	VersionNo   int
}

type WorkflowDSLGenerateResult struct {
	Model        string          `json:"model"`
	GeneratedDSL json.RawMessage `json:"generatedDsl"`
}

type WorkflowDSLGenerateService interface {
	Generate(ctx context.Context, userID int64, request WorkflowDSLGenerateRequest) (WorkflowDSLGenerateResult, *model.APIError)
}

type workflowDSLGenerateService struct {
	userConfigService   UserConfigService
	systemConfigService SystemConfigService
	fileService         FileService
	aiClient            ai.ChatCompletionClient
}

func NewWorkflowDSLGenerateService(
	userConfigService UserConfigService,
	systemConfigService SystemConfigService,
	fileService FileService,
	aiClient ai.ChatCompletionClient,
) WorkflowDSLGenerateService {
	return &workflowDSLGenerateService{
		userConfigService:   userConfigService,
		systemConfigService: systemConfigService,
		fileService:         fileService,
		aiClient:            aiClient,
	}
}

func (service *workflowDSLGenerateService) Generate(ctx context.Context, userID int64, request WorkflowDSLGenerateRequest) (WorkflowDSLGenerateResult, *model.APIError) {
	if userID <= 0 {
		return WorkflowDSLGenerateResult{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	normalized, apiError := normalizeWorkflowDSLGenerateRequest(request)
	if apiError != nil {
		return WorkflowDSLGenerateResult{}, apiError
	}

	systemConfig, apiError := service.systemConfigService.Get(ctx)
	if apiError != nil {
		return WorkflowDSLGenerateResult{}, apiError
	}
	if normalized.Model == "" {
		normalized.Model = strings.TrimSpace(systemConfig.CodeDefaultModel)
		if normalized.Model == "" {
			normalized.Model = strings.TrimSpace(systemConfig.DefaultModel)
		}
		if normalized.Model == "" {
			normalized.Model = DefaultSystemModel
		}
	}

	userConfig, apiError := service.userConfigService.GetByUserID(ctx, userID)
	if apiError != nil {
		return WorkflowDSLGenerateResult{}, apiError
	}
	baseURL := strings.TrimSpace(userConfig.AIBaseURL)
	apiKey := strings.TrimSpace(userConfig.AIApiKey)
	if baseURL == "" || apiKey == "" {
		return WorkflowDSLGenerateResult{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：AI 服务商地址、AI APIKey")
	}

	readmeText := loadWorkflowReadme()
	version, raw, apiError := service.fileService.ReadReferenceContent(ctx, normalized.FileID, normalized.VersionNo, maxWorkflowGenerateFileBytes)
	if apiError != nil {
		log.Printf("workflow-dsl-generate parse-file failed user=%d fileId=%d versionNo=%d err=%s", userID, normalized.FileID, normalized.VersionNo, apiError.Message)
		return WorkflowDSLGenerateResult{}, apiError
	}
	filePayload := buildWorkflowGenerateFilePayload(version.OriginName, version.MimeType, raw)
	log.Printf("workflow-dsl-generate parse-file success user=%d fileId=%d versionNo=%d mime=%s size=%d", userID, version.FileID, version.VersionNo, version.MimeType, len(raw))

	aiTimeout := resolveWorkflowGenerateTimeout(version.SizeBytes)
	log.Printf("workflow-dsl-generate ai-request start user=%d model=%s timeoutMs=%d fileBytes=%d", userID, normalized.Model, aiTimeout.Milliseconds(), version.SizeBytes)
	assistantText, err := service.aiClient.CreateChatCompletion(ctx, ai.ChatCompletionRequest{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   normalized.Model,
		Messages: []ai.ChatMessage{
			{
				Role:    model.ChatMessageRoleSystem,
				Content: "你是工作流 DSL 生成器。你只能输出合法 JSON，且必须是工作流 DSL 根对象，不要 Markdown，不要解释。",
			},
			{
				Role: model.ChatMessageRoleUser,
				Content: fmt.Sprintf("下面是 DSL 规范文档：\n%s\n\n下面是用户上传文件内容：\n%s\n\n用户需求：\n%s\n\n请输出最终 DSL JSON，仅输出 JSON。",
					readmeText,
					filePayload,
					normalized.Description,
				),
			},
		},
		Temperature: 0.2,
		Timeout:     aiTimeout,
	})
	if err != nil {
		if ai.IsTimeoutError(err) {
			log.Printf("workflow-dsl-generate ai-request timeout user=%d model=%s timeoutMs=%d fileBytes=%d err=%v", userID, normalized.Model, aiTimeout.Milliseconds(), version.SizeBytes, err)
			return WorkflowDSLGenerateResult{}, model.NewAPIError(504, response.CodeInternal, "AI 请求超时，请稍后重试")
		}
		log.Printf("workflow-dsl-generate ai-request failed user=%d model=%s timeoutMs=%d fileBytes=%d err=%v", userID, normalized.Model, aiTimeout.Milliseconds(), version.SizeBytes, err)
		return WorkflowDSLGenerateResult{}, model.NewAPIError(502, response.CodeInternal, "AI 调用失败："+err.Error())
	}
	log.Printf("workflow-dsl-generate ai-request success user=%d model=%s timeoutMs=%d fileBytes=%d responseLen=%d", userID, normalized.Model, aiTimeout.Milliseconds(), version.SizeBytes, len(assistantText))

	dslRaw, apiError := normalizeGeneratedWorkflowDSL(assistantText)
	if apiError != nil {
		log.Printf("workflow-dsl-generate dsl-validate failed user=%d model=%s err=%s", userID, normalized.Model, apiError.Message)
		return WorkflowDSLGenerateResult{}, apiError
	}
	log.Printf("workflow-dsl-generate dsl-validate success user=%d model=%s dslBytes=%d", userID, normalized.Model, len(dslRaw))
	return WorkflowDSLGenerateResult{
		Model:        normalized.Model,
		GeneratedDSL: dslRaw,
	}, nil
}

func normalizeWorkflowDSLGenerateRequest(request WorkflowDSLGenerateRequest) (WorkflowDSLGenerateRequest, *model.APIError) {
	normalized := request
	normalized.Model = strings.TrimSpace(normalized.Model)
	normalized.Description = strings.TrimSpace(normalized.Description)
	if normalized.Description == "" {
		return WorkflowDSLGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "description 不能为空")
	}
	if normalized.FileID <= 0 {
		return WorkflowDSLGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	if normalized.VersionNo <= 0 {
		return WorkflowDSLGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "versionNo 不合法")
	}
	return normalized, nil
}

func normalizeGeneratedWorkflowDSL(raw string) (json.RawMessage, *model.APIError) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, model.NewAPIError(502, response.CodeInternal, "AI 未返回 DSL")
	}
	if strings.HasPrefix(trimmed, "```") {
		lines := strings.Split(trimmed, "\n")
		if len(lines) >= 2 {
			end := -1
			for i := len(lines) - 1; i >= 1; i-- {
				if strings.TrimSpace(lines[i]) == "```" {
					end = i
					break
				}
			}
			if end > 0 {
				trimmed = strings.TrimSpace(strings.Join(lines[1:end], "\n"))
			}
		}
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
		return nil, model.NewAPIError(502, response.CodeInternal, "AI 返回的 DSL 不是合法 JSON")
	}
	nodes, ok := root["nodes"].([]any)
	if !ok || len(nodes) == 0 {
		return nil, model.NewAPIError(502, response.CodeInternal, "AI 返回 DSL 缺少有效 nodes")
	}
	normalized, err := json.Marshal(root)
	if err != nil {
		return nil, model.NewAPIError(502, response.CodeInternal, "AI 返回 DSL 序列化失败")
	}
	return normalized, nil
}

func loadWorkflowReadme() string {
	candidates := []string{
		"docs/workflow-dsl/README.md",
		"../docs/workflow-dsl/README.md",
		"../../docs/workflow-dsl/README.md",
	}
	for _, filePath := range candidates {
		raw, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		text := strings.TrimSpace(string(raw))
		if text != "" {
			return text
		}
	}
	return "工作流 DSL 至少包含 nodes/edges/viewport。nodes 必须非空；每个节点必须有 id/type/position/data。if-else 分支通过 edge.sourceHandle 连接。"
}

func buildWorkflowGenerateFilePayload(fileName, mimeType string, raw []byte) string {
	safeName := strings.TrimSpace(fileName)
	if safeName == "" {
		safeName = "unknown"
	}
	safeMime := strings.ToLower(strings.TrimSpace(mimeType))
	if safeMime == "" {
		safeMime = "application/octet-stream"
	}
	header := fmt.Sprintf("文件名: %s\nMIME: %s\n", safeName, safeMime)
	if isTextMime(safeMime) && utf8.Valid(raw) {
		return header + "文本内容:\n" + string(raw)
	}
	snippet := raw
	if len(snippet) > maxWorkflowBinarySnippet {
		snippet = snippet[:maxWorkflowBinarySnippet]
	}
	return header + "base64片段(可能截断):\n" + base64.StdEncoding.EncodeToString(snippet)
}

func isTextMime(mimeType string) bool {
	if strings.HasPrefix(mimeType, "text/") {
		return true
	}
	switch mimeType {
	case "application/json",
		"application/xml",
		"application/yaml",
		"application/x-yaml",
		"application/csv",
		"text/csv":
		return true
	default:
		return false
	}
}

func resolveWorkflowGenerateTimeout(fileSizeBytes int64) time.Duration {
	if fileSizeBytes <= 0 {
		return workflowGenerateTimeoutBase
	}

	timeout := workflowGenerateTimeoutBase
	switch {
	case fileSizeBytes <= 1*1024*1024:
		timeout = 90 * time.Second
	case fileSizeBytes <= 5*1024*1024:
		timeout = 120 * time.Second
	case fileSizeBytes <= 15*1024*1024:
		timeout = 180 * time.Second
	case fileSizeBytes <= 30*1024*1024:
		timeout = 240 * time.Second
	default:
		timeout = workflowGenerateTimeoutMax
	}
	if timeout > workflowGenerateTimeoutMax {
		return workflowGenerateTimeoutMax
	}
	return timeout
}
