package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
)

type WorkflowNodeGenerateRequest struct {
	Model       string
	NodeType    string
	Description string
	Context     WorkflowNodeGenerateContext
}

type WorkflowNodeGenerateContext struct {
	ActiveNodeType string
	SelectedAPI    *WorkflowNodeGenerateSelectedAPI
}

type WorkflowNodeGenerateSelectedAPI struct {
	Method    string
	Path      string
	Summary   string
	Auth      string
	Params    []WorkflowNodeGenerateAPIParam
	Responses []WorkflowNodeGenerateAPIResponse
}

type WorkflowNodeGenerateAPIParam struct {
	Name        string
	In          string
	Type        string
	Description string
	Validation  WorkflowNodeGenerateAPIParamValidation
}

type WorkflowNodeGenerateAPIParamValidation struct {
	Required bool
	Enum     []string
	Min      *float64
	Max      *float64
	Pattern  string
}

type WorkflowNodeGenerateAPIResponse struct {
	HTTPStatus  int
	Code        string
	ContentType string
	Description string
	DataShape   string
	Example     json.RawMessage
}

type WorkflowNodeGenerateResult struct {
	Model           string          `json:"model"`
	GeneratedConfig json.RawMessage `json:"generatedConfig"`
	SuggestedTitle  string          `json:"suggestedTitle"`
	SuggestedDesc   string          `json:"suggestedDesc"`
}

type WorkflowNodeGenerateService interface {
	Generate(ctx context.Context, userID int64, request WorkflowNodeGenerateRequest) (WorkflowNodeGenerateResult, *model.APIError)
}

type workflowNodeGenerateService struct {
	userConfigService   UserConfigService
	systemConfigService SystemConfigService
	aiClient            ai.ChatCompletionClient
}

func NewWorkflowNodeGenerateService(userConfigService UserConfigService, systemConfigService SystemConfigService, aiClient ai.ChatCompletionClient) WorkflowNodeGenerateService {
	return &workflowNodeGenerateService{
		userConfigService:   userConfigService,
		systemConfigService: systemConfigService,
		aiClient:            aiClient,
	}
}

func (service *workflowNodeGenerateService) Generate(ctx context.Context, userID int64, request WorkflowNodeGenerateRequest) (WorkflowNodeGenerateResult, *model.APIError) {
	if userID <= 0 {
		return WorkflowNodeGenerateResult{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}

	normalized, apiError := normalizeWorkflowNodeGenerateRequest(request)
	if apiError != nil {
		return WorkflowNodeGenerateResult{}, apiError
	}

	if normalized.Model == "" {
		systemConfig, errResp := service.systemConfigService.Get(ctx)
		if errResp != nil {
			return WorkflowNodeGenerateResult{}, errResp
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
		return WorkflowNodeGenerateResult{}, apiError
	}
	baseURL := strings.TrimSpace(config.AIBaseURL)
	apiKey := strings.TrimSpace(config.AIApiKey)
	if baseURL == "" || apiKey == "" {
		return WorkflowNodeGenerateResult{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：AI 服务商地址、AI APIKey")
	}

	assistantText, err := service.aiClient.CreateChatCompletion(ctx, ai.ChatCompletionRequest{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   normalized.Model,
		Messages: buildWorkflowAIMessages(
			buildWorkflowNodeGenerateSystemPrompt(),
			[]workflowAIPromptSection{
				{Title: "任务信息", Body: buildWorkflowNodeGenerateTaskInfo(normalized)},
				{Title: "用户描述", Body: normalized.Description},
			},
			"请直接输出 JSON。",
		),
		Temperature: 0.2,
		Timeout:     60 * time.Second,
	})
	if err != nil {
		return WorkflowNodeGenerateResult{}, model.NewAPIError(502, response.CodeInternal, "AI 调用失败："+err.Error())
	}

	generatedConfig, title, desc, apiError := normalizeWorkflowNodeGenerateResponse(normalized.NodeType, assistantText)
	if apiError != nil {
		return WorkflowNodeGenerateResult{}, apiError
	}

	return WorkflowNodeGenerateResult{
		Model:           normalized.Model,
		GeneratedConfig: generatedConfig,
		SuggestedTitle:  title,
		SuggestedDesc:   desc,
	}, nil
}

func normalizeWorkflowNodeGenerateRequest(request WorkflowNodeGenerateRequest) (WorkflowNodeGenerateRequest, *model.APIError) {
	normalized := request
	normalized.Model = strings.TrimSpace(normalized.Model)
	normalized.NodeType = strings.TrimSpace(normalized.NodeType)
	normalized.Description = strings.TrimSpace(normalized.Description)
	normalized.Context.ActiveNodeType = strings.TrimSpace(normalized.Context.ActiveNodeType)
	normalized.Context.SelectedAPI = normalizeWorkflowNodeGenerateSelectedAPI(normalized.Context.SelectedAPI)

	if normalized.NodeType == "" {
		return WorkflowNodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "nodeType 不能为空")
	}
	if !isAllowedNodeType(normalized.NodeType) {
		return WorkflowNodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "nodeType 不支持")
	}
	if normalized.Description == "" {
		return WorkflowNodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "description 不能为空")
	}
	if normalized.NodeType == "api-request" {
		if normalized.Context.SelectedAPI == nil || normalized.Context.SelectedAPI.Method == "" || normalized.Context.SelectedAPI.Path == "" {
			return WorkflowNodeGenerateRequest{}, model.NewAPIError(400, response.CodeBadRequest, "api-request 节点必须选择有效 API 接口")
		}
	}
	return normalized, nil
}

func normalizeWorkflowNodeGenerateSelectedAPI(selectedAPI *WorkflowNodeGenerateSelectedAPI) *WorkflowNodeGenerateSelectedAPI {
	if selectedAPI == nil {
		return nil
	}
	normalized := &WorkflowNodeGenerateSelectedAPI{
		Method:  strings.ToUpper(strings.TrimSpace(selectedAPI.Method)),
		Path:    strings.TrimSpace(selectedAPI.Path),
		Summary: strings.TrimSpace(selectedAPI.Summary),
		Auth:    strings.TrimSpace(selectedAPI.Auth),
	}
	if len(selectedAPI.Params) > 0 {
		normalized.Params = make([]WorkflowNodeGenerateAPIParam, 0, len(selectedAPI.Params))
		for _, param := range selectedAPI.Params {
			nextParam := WorkflowNodeGenerateAPIParam{
				Name:        strings.TrimSpace(param.Name),
				In:          strings.TrimSpace(param.In),
				Type:        strings.TrimSpace(param.Type),
				Description: strings.TrimSpace(param.Description),
				Validation: WorkflowNodeGenerateAPIParamValidation{
					Required: param.Validation.Required,
					Min:      param.Validation.Min,
					Max:      param.Validation.Max,
					Pattern:  strings.TrimSpace(param.Validation.Pattern),
				},
			}
			if len(param.Validation.Enum) > 0 {
				nextParam.Validation.Enum = make([]string, 0, len(param.Validation.Enum))
				for _, item := range param.Validation.Enum {
					trimmed := strings.TrimSpace(item)
					if trimmed != "" {
						nextParam.Validation.Enum = append(nextParam.Validation.Enum, trimmed)
					}
				}
			}
			normalized.Params = append(normalized.Params, nextParam)
		}
	}
	if len(selectedAPI.Responses) > 0 {
		normalized.Responses = make([]WorkflowNodeGenerateAPIResponse, 0, len(selectedAPI.Responses))
		for _, resp := range selectedAPI.Responses {
			nextResponse := WorkflowNodeGenerateAPIResponse{
				HTTPStatus:  resp.HTTPStatus,
				Code:        strings.TrimSpace(resp.Code),
				ContentType: strings.TrimSpace(resp.ContentType),
				Description: strings.TrimSpace(resp.Description),
				DataShape:   strings.TrimSpace(resp.DataShape),
			}
			if len(resp.Example) > 0 {
				nextResponse.Example = append(json.RawMessage(nil), resp.Example...)
			}
			normalized.Responses = append(normalized.Responses, nextResponse)
		}
	}
	if normalized.Method == "" || normalized.Path == "" {
		return nil
	}
	return normalized
}

func isAllowedNodeType(nodeType string) bool {
	switch nodeType {
	case "start", "end", "input", "llm", "if-else", "iteration", "http-request", "api-request", "code":
		return true
	default:
		return false
	}
}

func buildWorkflowNodeGenerateSystemPrompt() string {
	return "你是工作流节点配置生成器。必须严格输出 JSON 对象，禁止 Markdown、禁止解释。输出格式固定：{\"config\":{...},\"title\":\"...\",\"desc\":\"...\"}。其中 config 必须是对象。"
}

func buildWorkflowNodeGenerateTaskInfo(request WorkflowNodeGenerateRequest) string {
	var taskBuilder strings.Builder
	taskBuilder.WriteString("请按以下信息生成单个节点配置。\n")
	taskBuilder.WriteString(fmt.Sprintf("- nodeType: %s\n", request.NodeType))
	if request.Context.ActiveNodeType != "" {
		taskBuilder.WriteString(fmt.Sprintf("- activeNodeType: %s\n", request.Context.ActiveNodeType))
	}
	taskBuilder.WriteString("- 生成目标：只生成该节点的 config，不生成工作流 DSL，不生成 nodes/edges。\n")
	constraintText := buildNodeTypeConstraintText(request)
	if constraintText != "" {
		taskBuilder.WriteString("- 节点类型补充约束：\n")
		taskBuilder.WriteString(constraintText)
	}
	if request.NodeType == "api-request" && request.Context.SelectedAPI != nil {
		selectedAPI := request.Context.SelectedAPI
		taskBuilder.WriteString("- API 请求节点约束：生成配置必须严格基于已选接口，不得切换方法或路径。\n")
		taskBuilder.WriteString(fmt.Sprintf("- 已选接口: %s %s\n", selectedAPI.Method, selectedAPI.Path))
		if selectedAPI.Summary != "" {
			taskBuilder.WriteString(fmt.Sprintf("- 接口说明: %s\n", selectedAPI.Summary))
		}
		if selectedAPI.Auth != "" {
			taskBuilder.WriteString(fmt.Sprintf("- 鉴权要求: %s\n", selectedAPI.Auth))
		}
		if len(selectedAPI.Params) > 0 {
			taskBuilder.WriteString("- 接口参数:\n")
			for _, param := range selectedAPI.Params {
				taskBuilder.WriteString(fmt.Sprintf("  - %s (%s, %s)", param.Name, param.In, param.Type))
				if param.Description != "" {
					taskBuilder.WriteString(fmt.Sprintf(" - %s", param.Description))
				}
				if param.Validation.Required {
					taskBuilder.WriteString(" [required]")
				}
				if len(param.Validation.Enum) > 0 {
					taskBuilder.WriteString(fmt.Sprintf(" [enum=%s]", strings.Join(param.Validation.Enum, ",")))
				}
				if param.Validation.Min != nil {
					taskBuilder.WriteString(fmt.Sprintf(" [min=%v]", *param.Validation.Min))
				}
				if param.Validation.Max != nil {
					taskBuilder.WriteString(fmt.Sprintf(" [max=%v]", *param.Validation.Max))
				}
				if param.Validation.Pattern != "" {
					taskBuilder.WriteString(fmt.Sprintf(" [pattern=%s]", param.Validation.Pattern))
				}
				taskBuilder.WriteString("\n")
			}
		}
		if len(selectedAPI.Responses) > 0 {
			taskBuilder.WriteString("- 接口响应:\n")
			for _, resp := range selectedAPI.Responses {
				taskBuilder.WriteString(fmt.Sprintf("  - HTTP %d, code=%s", resp.HTTPStatus, resp.Code))
				if resp.ContentType != "" {
					taskBuilder.WriteString(fmt.Sprintf(", contentType=%s", resp.ContentType))
				}
				if resp.Description != "" {
					taskBuilder.WriteString(fmt.Sprintf(", description=%s", resp.Description))
				}
				if resp.DataShape != "" {
					taskBuilder.WriteString(fmt.Sprintf(", dataShape=%s", resp.DataShape))
				}
				taskBuilder.WriteString("\n")
				if len(resp.Example) > 0 {
					taskBuilder.WriteString("    example: ")
					taskBuilder.Write(resp.Example)
					taskBuilder.WriteString("\n")
				}
			}
		}
	}
	return taskBuilder.String()
}

func buildNodeTypeConstraintText(request WorkflowNodeGenerateRequest) string {
	var builder strings.Builder
	writeLine := func(line string) {
		builder.WriteString("  - ")
		builder.WriteString(line)
		builder.WriteString("\n")
	}

	switch request.NodeType {
	case "start":
		writeLine("config 必须包含 variables 数组，每项至少包含 name、label、type、required。")
	case "input":
		writeLine("config 必须包含 fields 数组，每项至少包含 name、label、type、required；可选 prompt（输入提示词）。")
	case "llm":
		writeLine("config 必须包含 model、temperature、maxTokens、systemPrompt、userPrompt、contextEnabled、outputType、outputVar。")
		writeLine("outputType 仅允许 string/json；string 模式下 writebackMappings 置空数组。")
		writeLine("仅当 outputType=json 时允许配置 writebackMappings，元素需包含 sourcePath 或 expression，以及 targetPath。")
	case "if-else":
		writeLine("config 必须包含 conditions 数组与 elseBranchName。")
	case "http-request":
		writeLine("config 必须包含 method、url、query、headers、bodyType、body、timeout、authorization。")
		writeLine("写回映射使用 writebackMappings，元素需包含 sourcePath 与 targetPath。")
		writeLine("若用户描述中提供了 HTTP 响应 JSON 示例，必须按“按 JSON 生成映射”规则生成 writebackMappings：遍历响应 JSON 可映射路径并写入 sourcePath。")
		writeLine("“按 JSON 生成映射”路径规则：对象路径与叶子路径均可映射；数组路径使用 []（例如 data.list[]、data.list[].id）。")
		writeLine("HTTP 节点的 sourcePath 以响应 body 为根路径，不要自动增加 data. 或 body. 前缀。")
		writeLine("若用户明确给出了目标参数关系（例如 a.b -> workflow.x），则填写对应 targetPath；未明确指定时 targetPath 允许为空字符串。")
		writeLine("若描述包含数组逐项映射语义（如 a[].x -> b[].y），保留 [] 语义并按索引聚合字段。")
	case "api-request":
		writeLine("config 必须包含 route、params、paramValues、timeout、successStatusCode、writebackMappings。")
		if request.Context.SelectedAPI != nil {
			writeLine(fmt.Sprintf("route.method 必须是 %s，route.path 必须是 %s。", request.Context.SelectedAPI.Method, request.Context.SelectedAPI.Path))
		}
		writeLine("writebackMappings 元素需包含 sourcePath 与 targetPath。")
	case "code":
		writeLine("config 必须包含 language、code、outputs，可选 outputSchema、writebackMappings。")
	case "iteration":
		writeLine("config 必须包含 iteratorSource、outputVar、itemVar、indexVar、isParallel、parallelNums、errorHandleMode、flattenOutput。")
		writeLine("不要输出 children 字段。")
	case "end":
		writeLine("config 必须包含 outputs 数组，元素需包含 name 与 source；可选 joinMode（all/any）。")
	}
	if request.NodeType != "start" {
		writeLine("可选 joinMode（all/any），用于多入边时控制汇聚策略。")
	}

	return builder.String()
}

func normalizeWorkflowNodeGenerateResponse(nodeType string, raw string) (json.RawMessage, string, string, *model.APIError) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, "", "", model.NewAPIError(502, response.CodeInternal, "AI 未返回有效配置")
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

	var root struct {
		Config json.RawMessage `json:"config"`
		Title  string          `json:"title"`
		Desc   string          `json:"desc"`
	}
	if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
		return nil, "", "", model.NewAPIError(502, response.CodeInternal, "AI 返回不是合法 JSON")
	}
	if len(root.Config) == 0 {
		return nil, "", "", model.NewAPIError(502, response.CodeInternal, "AI 返回缺少 config")
	}

	var configMap map[string]any
	if err := json.Unmarshal(root.Config, &configMap); err != nil {
		return nil, "", "", model.NewAPIError(502, response.CodeInternal, "config 不是合法对象")
	}
	if configMap == nil {
		return nil, "", "", model.NewAPIError(502, response.CodeInternal, "config 不能为空")
	}
	if nodeType == "iteration" {
		delete(configMap, "children")
	}
	normalizedConfig, err := json.Marshal(configMap)
	if err != nil {
		return nil, "", "", model.NewAPIError(502, response.CodeInternal, "config 序列化失败")
	}

	return normalizedConfig, strings.TrimSpace(root.Title), strings.TrimSpace(root.Desc), nil
}
