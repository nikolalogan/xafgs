package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
	"sxfgssever/server/internal/workflowruntime"
)

type executionIDPathRequest struct {
	ID string `path:"id" validate:"required"`
}

type startWorkflowExecutionRequest struct {
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
	userConfigService service.UserConfigService
	registry          *apimeta.Registry
}

func NewWorkflowExecutionHandler(
	service service.WorkflowExecutionService,
	userConfigService service.UserConfigService,
	registry *apimeta.Registry,
) *WorkflowExecutionHandler {
	return &WorkflowExecutionHandler{
		service:           service,
		userConfigService: userConfigService,
		registry:          registry,
	}
}

func (handler *WorkflowExecutionHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	group := router.Group("", adminMiddleware)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[startWorkflowExecutionRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflow/executions",
		Summary: "创建并启动执行",
		Auth:    "admin",
	}, handler.Start)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:  fiber.MethodGet,
		Path:    "/workflow/executions/:id",
		Summary: "获取执行详情",
		Auth:    "admin",
	}, handler.Get)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[resumeWorkflowExecutionRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflow/executions/:id/resume",
		Summary: "提交节点输入并继续",
		Auth:    "admin",
	}, handler.Resume)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:  fiber.MethodDelete,
		Path:    "/workflow/executions/:id",
		Summary: "取消执行",
		Auth:    "admin",
	}, handler.Cancel)
}

func (handler *WorkflowExecutionHandler) Start(c *fiber.Ctx, request *startWorkflowExecutionRequest) error {
	rawDsl := request.WorkflowDSL
	if rawDsl == nil {
		rawDsl = request.DSL
	}
	if rawDsl == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowDsl 不能为空")
	}
	dsl, err := workflowruntime.ParseWorkflowDSL(rawDsl)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, err.Error())
	}

	input := request.Input
	if input == nil {
		input = map[string]any{}
	}

	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
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
	input["user"] = map[string]any{
		"warningAccount":  userConfig.WarningAccount,
		"warningPassword": userConfig.WarningPassword,
		"aiBaseUrl":       userConfig.AIBaseURL,
		"aiApiKey":        userConfig.AIApiKey,
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
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
