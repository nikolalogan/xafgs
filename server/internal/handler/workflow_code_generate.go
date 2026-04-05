package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type workflowCodeGenerateRequest struct {
	Model             string `json:"model"`
	TargetType        string `json:"targetType" validate:"required"`
	NodeType          string `json:"nodeType" validate:"required"`
	Language          string `json:"language"`
	Description       string `json:"description" validate:"required"`
	SelectedVariables []struct {
		Key         string `json:"key"`
		Placeholder string `json:"placeholder"`
		ValueType   string `json:"valueType"`
	} `json:"selectedVariables"`
	CurrentCode string `json:"currentCode"`
	Context     struct {
		NodeID    string `json:"nodeId"`
		FieldName string `json:"fieldName"`
	} `json:"context"`
}

type WorkflowCodeGenerateHandler struct {
	service  service.WorkflowCodeGenerateService
	registry *apimeta.Registry
}

func NewWorkflowCodeGenerateHandler(service service.WorkflowCodeGenerateService, registry *apimeta.Registry) *WorkflowCodeGenerateHandler {
	return &WorkflowCodeGenerateHandler{
		service:  service,
		registry: registry,
	}
}

func (handler *WorkflowCodeGenerateHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowCodeGenerateRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/code-generate",
		Summary:            "工作流代码 AI 生成",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[service.WorkflowCodeGenerateResult](),
	}, handler.Generate)
}

func (handler *WorkflowCodeGenerateHandler) Generate(c *fiber.Ctx, request *workflowCodeGenerateRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	selected := make([]service.WorkflowCodeGenerateVariable, 0, len(request.SelectedVariables))
	for _, item := range request.SelectedVariables {
		selected = append(selected, service.WorkflowCodeGenerateVariable{
			Key:         strings.TrimSpace(item.Key),
			Placeholder: strings.TrimSpace(item.Placeholder),
			ValueType:   strings.TrimSpace(item.ValueType),
		})
	}

	data, apiError := handler.service.Generate(c.UserContext(), userID, service.WorkflowCodeGenerateRequest{
		Model:             strings.TrimSpace(request.Model),
		TargetType:        strings.TrimSpace(request.TargetType),
		NodeType:          strings.TrimSpace(request.NodeType),
		Language:          strings.TrimSpace(request.Language),
		Description:       strings.TrimSpace(request.Description),
		SelectedVariables: selected,
		CurrentCode:       strings.TrimSpace(request.CurrentCode),
		Context: service.WorkflowCodeGenerateContext{
			NodeID:    strings.TrimSpace(request.Context.NodeID),
			FieldName: strings.TrimSpace(request.Context.FieldName),
		},
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}

	return response.Success(c, fiber.StatusOK, data, "生成成功")
}
