package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
	"sxfgssever/server/internal/workflowruntime"
)

type createWorkflowDebugSessionRequest struct {
	WorkflowID  int64          `json:"workflowId" validate:"required,min=1"`
	WorkflowDSL any            `json:"workflowDsl" validate:"required"`
	TargetNodeID string        `json:"targetNodeId" validate:"required"`
	Input       map[string]any `json:"input"`
}

type workflowDebugSessionIDPathRequest struct {
	ID string `path:"id" validate:"required"`
}

type continueWorkflowDebugSessionRequest struct {
	ID     string         `path:"id" validate:"required"`
	NodeID string         `json:"nodeId" validate:"required"`
	Input  map[string]any `json:"input"`
}

type WorkflowDebugHandler struct {
	service           service.WorkflowDebugService
	workflowService   service.WorkflowService
	userConfigService service.UserConfigService
	registry          *apimeta.Registry
}

func NewWorkflowDebugHandler(service service.WorkflowDebugService, workflowService service.WorkflowService, userConfigService service.UserConfigService, registry *apimeta.Registry) *WorkflowDebugHandler {
	return &WorkflowDebugHandler{
		service:           service,
		workflowService:   workflowService,
		userConfigService: userConfigService,
		registry:          registry,
	}
}

func (handler *WorkflowDebugHandler) Register(router fiber.Router) {
	group := router.Group("")
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[createWorkflowDebugSessionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/debug-sessions",
		Summary:            "创建节点调试会话",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowDebugSession](),
	}, handler.Create)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[workflowDebugSessionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/workflow/debug-sessions/:id",
		Summary:            "获取节点调试会话",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowDebugSession](),
	}, handler.Get)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[continueWorkflowDebugSessionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/debug-sessions/:id/continue",
		Summary:            "继续节点调试会话",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowDebugSession](),
	}, handler.Continue)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[workflowDebugSessionIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/debug-sessions/:id/rerun-target",
		Summary:            "重跑当前调试节点",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowDebugSession](),
	}, handler.RerunTarget)
}

func (handler *WorkflowDebugHandler) Create(c *fiber.Ctx, request *createWorkflowDebugSessionRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	_ = role
	dsl, err := workflowruntime.ParseWorkflowDSL(request.WorkflowDSL)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, err.Error())
	}
	if request.Input == nil {
		request.Input = map[string]any{}
	}
	workflow, apiError := handler.workflowService.GetByID(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	startNode, ok := findStartNode(dsl.Nodes)
	if ok {
		fields := workflowruntime.ParseStartFields(startNode.Data.Config)
		if len(fields) > 0 {
			normalized, validateErr := workflowruntime.ValidateAndNormalizeDynamicInput(fields, request.Input)
			if validateErr != nil {
				return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, validateErr.Error())
			}
			request.Input = normalized
		}
	}
	userConfig, apiError := handler.userConfigService.GetByUserID(c.UserContext(), userID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	if missing := detectMissingRequiredUserConfig(request.WorkflowDSL, dsl, userConfig); len(missing) > 0 {
		labels := make([]string, 0, len(missing))
		for _, item := range missing {
			labels = append(labels, item.label)
		}
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少用户配置："+strings.Join(labels, "、"))
	}
	request.Input["user"] = map[string]any{
		"warningAccount":  userConfig.WarningAccount,
		"warningPassword": userConfig.WarningPassword,
		"aiBaseUrl":       userConfig.AIBaseURL,
		"aiApiKey":        userConfig.AIApiKey,
	}
	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Create(ctx, workflowruntime.StartDebugSessionInput{
		WorkflowID:    workflow.ID,
		CreatorUserID: userID,
		WorkflowDSL:   dsl,
		TargetNodeID:  request.TargetNodeID,
		Input:         request.Input,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "创建调试会话成功")
}

func (handler *WorkflowDebugHandler) Get(c *fiber.Ctx, request *workflowDebugSessionIDPathRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	data, apiError := handler.service.Get(c.UserContext(), request.ID, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "获取调试会话成功")
}

func (handler *WorkflowDebugHandler) Continue(c *fiber.Ctx, request *continueWorkflowDebugSessionRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	if request.Input == nil {
		request.Input = map[string]any{}
	}
	data, apiError := handler.service.Continue(c.UserContext(), workflowruntime.ContinueDebugSessionInput{
		SessionID: request.ID,
		NodeID:    request.NodeID,
		Input:     request.Input,
	}, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "继续调试成功")
}

func (handler *WorkflowDebugHandler) RerunTarget(c *fiber.Ctx, request *workflowDebugSessionIDPathRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	data, apiError := handler.service.RerunTarget(c.UserContext(), workflowruntime.RerunDebugTargetInput{
		SessionID: request.ID,
	}, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "重跑调试节点成功")
}
