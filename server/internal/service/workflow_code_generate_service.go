package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
)

type WorkflowCodeGenerateVariable struct {
	Key         string
	Placeholder string
	ValueType   string
}

type WorkflowCodeGenerateContext struct {
	NodeID    string
	FieldName string
}

type WorkflowCodeGenerateRequest struct {
	Model             string
	TargetType        string
	NodeType          string
	Language          string
	Description       string
	SelectedVariables []WorkflowCodeGenerateVariable
	CurrentCode       string
	Context           WorkflowCodeGenerateContext
}

type WorkflowCodeGenerateResult struct {
	GeneratedCode string `json:"generatedCode"`
	Model         string `json:"model"`
}

type WorkflowCodeGenerateService interface {
	Generate(ctx context.Context, userID int64, request WorkflowCodeGenerateRequest) (WorkflowCodeGenerateResult, *model.APIError)
}

type workflowCodeGenerateService struct {
	userConfigService   UserConfigService
	systemConfigService SystemConfigService
	aiClient            ai.ChatCompletionClient
}

func NewWorkflowCodeGenerateService(userConfigService UserConfigService, systemConfigService SystemConfigService, aiClient ai.ChatCompletionClient) WorkflowCodeGenerateService {
	return &workflowCodeGenerateService{
		userConfigService:   userConfigService,
		systemConfigService: systemConfigService,
		aiClient:            aiClient,
	}
}

func (service *workflowCodeGenerateService) Generate(ctx context.Context, userID int64, request WorkflowCodeGenerateRequest) (WorkflowCodeGenerateResult, *model.APIError) {
	if userID <= 0 {
		return WorkflowCodeGenerateResult{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}

	normalized, apiError := normalizeWorkflowCodeGenerateRequest(request)
	if apiError != nil {
		return WorkflowCodeGenerateResult{}, apiError
	}
	if normalized.Model == "" {
		systemConfig, getError := service.systemConfigService.Get(ctx)
		if getError != nil {
			return WorkflowCodeGenerateResult{}, getError
		}
		normalized.Model = strings.TrimSpace(systemConfig.CodeDefaultModel)
		if normalized.Model == "" {
			normalized.Model = strings.TrimSpace(systemConfig.DefaultModel)
		}
		if normalized.Model == "" {
			normalized.Model = DefaultSystemModel
		}
	}

	config, apiError := service.userConfigService.GetByUserID(ctx, userID)
	if apiError != nil {
		return WorkflowCodeGenerateResult{}, apiError
	}

	baseURL := strings.TrimSpace(config.AIBaseURL)
	apiKey := strings.TrimSpace(config.AIApiKey)
	if baseURL == "" || apiKey == "" {
		return WorkflowCodeGenerateResult{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：AI 服务商地址、AI APIKey")
	}

	assistantText, err := service.aiClient.CreateChatCompletion(ctx, ai.ChatCompletionRequest{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   normalized.Model,
		Messages: []ai.ChatMessage{
			{Role: "system", Content: buildSystemPrompt(normalized)},
			{Role: "user", Content: buildUserPrompt(normalized)},
		},
		Temperature: 0.2,
		Timeout:     60 * time.Second,
	})
	if err != nil {
		return WorkflowCodeGenerateResult{}, model.NewAPIError(502, response.CodeInternal, "AI 调用失败："+err.Error())
	}

	generated := sanitizeGeneratedCode(assistantText)
	if generated == "" {
		return WorkflowCodeGenerateResult{}, model.NewAPIError(502, response.CodeInternal, "AI 未返回有效代码")
	}

	return WorkflowCodeGenerateResult{
		GeneratedCode: generated,
		Model:         normalized.Model,
	}, nil
}

func normalizeWorkflowCodeGenerateRequest(request WorkflowCodeGenerateRequest) (WorkflowCodeGenerateRequest, *model.APIError) {
	normalized := request
	normalized.Model = strings.TrimSpace(normalized.Model)
	normalized.TargetType = strings.TrimSpace(normalized.TargetType)
	normalized.NodeType = strings.TrimSpace(normalized.NodeType)
	normalized.Language = strings.TrimSpace(normalized.Language)
	normalized.Description = strings.TrimSpace(normalized.Description)
	normalized.CurrentCode = strings.TrimSpace(normalized.CurrentCode)
	normalized.Context.NodeID = strings.TrimSpace(normalized.Context.NodeID)
	normalized.Context.FieldName = strings.TrimSpace(normalized.Context.FieldName)

	if normalized.Description == "" {
		return WorkflowCodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "description 不能为空")
	}

	if normalized.TargetType != "visibleWhen" && normalized.TargetType != "validateWhen" && normalized.TargetType != "code" {
		return WorkflowCodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "targetType 仅支持 visibleWhen/validateWhen/code")
	}
	if normalized.NodeType != "start" && normalized.NodeType != "input" && normalized.NodeType != "code" {
		return WorkflowCodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "nodeType 仅支持 start/input/code")
	}

	if normalized.TargetType == "code" {
		if normalized.NodeType != "code" {
			return WorkflowCodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "code 生成仅支持 code 节点")
		}
		if normalized.Language == "" {
			normalized.Language = "javascript"
		}
		if normalized.Language != "javascript" && normalized.Language != "python3" {
			return WorkflowCodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "language 仅支持 javascript/python3")
		}
	} else {
		if normalized.NodeType != "start" && normalized.NodeType != "input" {
			return WorkflowCodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "规则生成仅支持 start/input 节点")
		}
		normalized.Language = "javascript"
	}

	cleanVariables := make([]WorkflowCodeGenerateVariable, 0, len(normalized.SelectedVariables))
	for _, item := range normalized.SelectedVariables {
		placeholder := strings.TrimSpace(item.Placeholder)
		if placeholder == "" {
			continue
		}
		cleanVariables = append(cleanVariables, WorkflowCodeGenerateVariable{
			Key:         strings.TrimSpace(item.Key),
			Placeholder: placeholder,
			ValueType:   strings.TrimSpace(item.ValueType),
		})
	}
	normalized.SelectedVariables = cleanVariables

	return normalized, nil
}

func buildSystemPrompt(request WorkflowCodeGenerateRequest) string {
	if request.TargetType == "code" {
		if request.Language == "python3" {
			return "你是工作流 Python3 代码生成器。严格只输出可直接粘贴执行的 Python 代码，不要 Markdown、不要解释。必须定义 def main(input): 并返回 dict。代码中读取变量时必须使用 {{node.field}} 占位符，不要使用 input.xxx。"
		}
		return "你是工作流 JavaScript 代码生成器。严格只输出可直接粘贴执行的 JavaScript 代码，不要 Markdown、不要解释。必须定义 function main(input) 并返回对象。代码中读取变量时必须使用 {{node.field}} 占位符，不要使用 input.xxx。"
	}
	return "你是工作流规则代码生成器。严格只输出 JavaScript 规则代码，不要 Markdown、不要解释。代码必须返回布尔值。"
}

func buildUserPrompt(request WorkflowCodeGenerateRequest) string {
	var builder strings.Builder
	builder.WriteString("请根据下面信息生成代码：\n")
	builder.WriteString(fmt.Sprintf("- targetType: %s\n", request.TargetType))
	builder.WriteString(fmt.Sprintf("- nodeType: %s\n", request.NodeType))
	if request.TargetType == "code" {
		builder.WriteString(fmt.Sprintf("- language: %s\n", request.Language))
	}
	if request.Context.NodeID != "" {
		builder.WriteString(fmt.Sprintf("- nodeId: %s\n", request.Context.NodeID))
	}
	if request.Context.FieldName != "" {
		builder.WriteString(fmt.Sprintf("- fieldName: %s\n", request.Context.FieldName))
	}
	builder.WriteString("\n规则约束：\n")
	builder.WriteString(buildRuleConstraints(request))
	builder.WriteString("\n\n用户需求：\n")
	builder.WriteString(request.Description)

	if len(request.SelectedVariables) > 0 {
		builder.WriteString("\n\n可引用变量（按需使用）：\n")
		for _, item := range request.SelectedVariables {
			line := fmt.Sprintf("- %s", item.Placeholder)
			if item.ValueType != "" {
				line += fmt.Sprintf(" (%s)", item.ValueType)
			}
			builder.WriteString(line)
			builder.WriteString("\n")
		}
	}

	if request.CurrentCode != "" {
		builder.WriteString("\n当前代码（如无必要请保留语义一致性）：\n")
		builder.WriteString(request.CurrentCode)
	}

	builder.WriteString("\n\n请直接输出最终代码文本。")
	return builder.String()
}

func buildRuleConstraints(request WorkflowCodeGenerateRequest) string {
	if request.TargetType == "code" {
		if request.Language == "python3" {
			return "1) 仅输出 Python3 代码。\n2) 入口必须是 def main(input):。\n3) 返回值必须是 dict。\n4) 变量引用必须使用 {{node.field}} 占位符，不要使用 input.xxx。\n5) 不要输出解释文本。"
		}
		return "1) 仅输出 JavaScript 代码。\n2) 入口必须是 function main(input) { ... }。\n3) 返回值必须是对象。\n4) 变量引用必须使用 {{node.field}} 占位符，不要使用 input.xxx。\n5) 不要输出解释文本。"
	}
	if request.TargetType == "visibleWhen" {
		return "1) 输出 JavaScript 规则代码。\n2) 必须 return true 或 false。\n3) 可通过 {{node.param}} 占位符读取变量。\n4) 不要输出解释文本。"
	}
	return "1) 输出 JavaScript 规则代码。\n2) 必须 return true 或 false。\n3) 可通过 {{node.param}} 占位符读取变量。\n4) 校验逻辑需紧扣用户需求。\n5) 不要输出解释文本。"
}

func sanitizeGeneratedCode(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
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
				content := strings.Join(lines[1:end], "\n")
				return strings.TrimSpace(content)
			}
		}
	}
	return trimmed
}
