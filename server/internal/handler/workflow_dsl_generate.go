package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type workflowDSLGenerateRequest struct {
	Model       string `json:"model"`
	Description string `json:"description" validate:"required"`
	FileID      int64  `json:"fileId" validate:"required,min=1"`
	VersionNo   int    `json:"versionNo" validate:"required,min=1"`
}

type WorkflowDSLGenerateHandler struct {
	service  service.WorkflowDSLGenerateService
	registry *apimeta.Registry
}

func NewWorkflowDSLGenerateHandler(service service.WorkflowDSLGenerateService, registry *apimeta.Registry) *WorkflowDSLGenerateHandler {
	return &WorkflowDSLGenerateHandler{
		service:  service,
		registry: registry,
	}
}

func (handler *WorkflowDSLGenerateHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowDSLGenerateRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflow/dsl-generate",
		Summary: "工作流 DSL AI 生成",
		Auth:    "auth",
	}, handler.Generate)
}

func (handler *WorkflowDSLGenerateHandler) Generate(c *fiber.Ctx, request *workflowDSLGenerateRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	data, apiError := handler.service.Generate(c.UserContext(), userID, service.WorkflowDSLGenerateRequest{
		Model:       strings.TrimSpace(request.Model),
		Description: strings.TrimSpace(request.Description),
		FileID:      request.FileID,
		VersionNo:   request.VersionNo,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "生成成功")
}

