package handler

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
	"sxfgssever/server/internal/workflowruntime"
)

type requiredUserConfigField struct {
	key   string
	label string
}

var requiredUserConfigFields = []requiredUserConfigField{
	{key: "warningAccount", label: "预警通账号"},
	{key: "warningPassword", label: "预警通密码"},
	{key: "aiBaseUrl", label: "AI 服务商地址"},
	{key: "aiApiKey", label: "AI APIKey"},
}

type executionIDPathRequest struct {
	ID string `path:"id" validate:"required"`
}

type startWorkflowExecutionRequest struct {
	WorkflowID  int64          `json:"workflowId" validate:"required,min=1"`
	WorkflowDSL any            `json:"workflowDsl"`
	DSL         any            `json:"dsl"`
	Input       map[string]any `json:"input"`
}

type resumeWorkflowExecutionRequest struct {
	ID     string         `path:"id" validate:"required"`
	NodeID string         `json:"nodeId" validate:"required"`
	Input  map[string]any `json:"input"`
}

type WorkflowExecutionHandler struct {
	service           service.WorkflowExecutionService
	workflowService   service.WorkflowService
	rateLimiter       service.WorkflowExecutionRateLimiter
	userConfigService service.UserConfigService
	registry          *apimeta.Registry
}

func NewWorkflowExecutionHandler(
	service service.WorkflowExecutionService,
	workflowService service.WorkflowService,
	rateLimiter service.WorkflowExecutionRateLimiter,
	userConfigService service.UserConfigService,
	registry *apimeta.Registry,
) *WorkflowExecutionHandler {
	return &WorkflowExecutionHandler{
		service:           service,
		workflowService:   workflowService,
		rateLimiter:       rateLimiter,
		userConfigService: userConfigService,
		registry:          registry,
	}
}

func (handler *WorkflowExecutionHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	group := router.Group("", adminMiddleware)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[startWorkflowExecutionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/executions",
		Summary:            "创建并启动执行",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Start)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/workflow/executions/:id",
		Summary:            "获取执行详情",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Get)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[resumeWorkflowExecutionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/executions/:id/resume",
		Summary:            "提交节点输入并继续",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Resume)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/workflow/executions/:id",
		Summary:            "取消执行",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Cancel)
}

func (handler *WorkflowExecutionHandler) Start(c *fiber.Ctx, request *startWorkflowExecutionRequest) error {
	if request.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	input := request.Input
	if input == nil {
		input = map[string]any{}
	}

	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	workflow, apiError := handler.workflowService.GetByID(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	latestDraftDSL, apiError := handler.workflowService.GetDraftDSLByID(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	dsl, err := workflowruntime.ParseWorkflowDSL(latestDraftDSL)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "当前工作流草稿 DSL 非法："+err.Error())
	}

	startNode, ok := findStartNode(dsl.Nodes)
	if ok {
		fields := workflowruntime.ParseStartFields(startNode.Data.Config)
		if len(fields) > 0 {
			normalized, validateErr := workflowruntime.ValidateAndNormalizeDynamicInput(fields, input)
			if validateErr != nil {
				return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, validateErr.Error())
			}
			input = normalized
		}
	}

	userConfig, apiError := handler.userConfigService.GetByUserID(c.UserContext(), userID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	if missing := detectMissingRequiredUserConfig(latestDraftDSL, userConfig); len(missing) > 0 {
		labels := make([]string, 0, len(missing))
		for _, item := range missing {
			labels = append(labels, item.label)
		}
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少用户配置："+strings.Join(labels, "、"))
	}
	input["user"] = map[string]any{
		"warningAccount":  userConfig.WarningAccount,
		"warningPassword": userConfig.WarningPassword,
		"aiBaseUrl":       userConfig.AIBaseURL,
		"aiApiKey":        userConfig.AIApiKey,
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	window := time.Duration(workflow.BreakerWindowMinutes) * time.Minute
	limiterKey := fmt.Sprintf("%d:%d", userID, request.WorkflowID)
	if !handler.rateLimiter.Allow(limiterKey, time.Now().UTC(), window, workflow.BreakerMaxRequests) {
		return response.Error(c, fiber.StatusTooManyRequests, response.CodeTooManyRequests, "请求过快，请稍后重试")
	}
	data, apiError := handler.service.Start(ctx, dsl, input)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "创建并启动执行成功")
}

func findStartNode(nodes []workflowruntime.WorkflowNode) (workflowruntime.WorkflowNode, bool) {
	for _, node := range nodes {
		if node.Data.Type == "start" {
			return node, true
		}
	}
	return workflowruntime.WorkflowNode{}, false
}

func (handler *WorkflowExecutionHandler) Get(c *fiber.Ctx, request *executionIDPathRequest) error {
	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Get(ctx, request.ID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "获取执行详情成功")
}

func (handler *WorkflowExecutionHandler) Resume(c *fiber.Ctx, request *resumeWorkflowExecutionRequest) error {
	request.NodeID = strings.TrimSpace(request.NodeID)
	if request.Input == nil {
		request.Input = map[string]any{}
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Resume(ctx, request.ID, request.NodeID, request.Input)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "提交输入成功")
}

func (handler *WorkflowExecutionHandler) Cancel(c *fiber.Ctx, request *executionIDPathRequest) error {
	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Cancel(ctx, request.ID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "取消执行成功")
}

func requestID(c *fiber.Ctx) string {
	value := c.GetRespHeader(fiber.HeaderXRequestID)
	if value != "" {
		return value
	}
	local := c.Locals("requestid")
	if local == nil {
		return ""
	}
	requestID, ok := local.(string)
	if !ok {
		return ""
	}
	return requestID
}

func detectMissingRequiredUserConfig(rawDSL any, config model.UserConfigDTO) []requiredUserConfigField {
	raw, err := json.Marshal(rawDSL)
	if err != nil {
		return nil
	}
	text := string(raw)
	if strings.TrimSpace(text) == "" {
		return nil
	}

	values := map[string]string{
		"warningAccount":  strings.TrimSpace(config.WarningAccount),
		"warningPassword": strings.TrimSpace(config.WarningPassword),
		"aiBaseUrl":       strings.TrimSpace(config.AIBaseURL),
		"aiApiKey":        strings.TrimSpace(config.AIApiKey),
	}

	missing := make([]requiredUserConfigField, 0)
	for _, field := range requiredUserConfigFields {
		placeholder := regexp.MustCompile(`\{\{\s*user\.` + regexp.QuoteMeta(field.key) + `\s*\}\}`)
		bare := regexp.MustCompile(`["']\s*user\.` + regexp.QuoteMeta(field.key) + `\s*["']`)
		if !placeholder.MatchString(text) && !bare.MatchString(text) {
			continue
		}
		if values[field.key] != "" {
			continue
		}
		missing = append(missing, field)
	}
	return missing
}
