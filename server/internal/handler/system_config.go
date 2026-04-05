package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type updateSystemConfigRequest struct {
	Models           []model.SystemModelOption `json:"models"`
	DefaultModel     string                    `json:"defaultModel"`
	CodeDefaultModel string                    `json:"codeDefaultModel"`
	SearchService    string                    `json:"searchService"`
}

type SystemConfigHandler struct {
	service  service.SystemConfigService
	registry *apimeta.Registry
}

func NewSystemConfigHandler(service service.SystemConfigService, registry *apimeta.Registry) *SystemConfigHandler {
	return &SystemConfigHandler{
		service:  service,
		registry: registry,
	}
}

func (handler *SystemConfigHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/system-config",
		Summary:            "获取系统配置",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.SystemConfigDTO](),
	}, handler.Get)

	adminGroup := router.Group("", adminMiddleware)
	apimeta.Register(adminGroup, handler.registry, apimeta.RouteSpec[updateSystemConfigRequest]{
		Method:             fiber.MethodPut,
		Path:               "/system-config",
		Summary:            "更新系统配置",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[model.SystemConfigDTO](),
	}, handler.Update)
}

func (handler *SystemConfigHandler) Get(c *fiber.Ctx, _ *struct{}) error {
	config, apiError := handler.service.Get(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, config, "获取系统配置成功")
}

func (handler *SystemConfigHandler) Update(c *fiber.Ctx, request *updateSystemConfigRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	models := make([]model.SystemModelOption, 0, len(request.Models))
	for _, item := range request.Models {
		models = append(models, model.SystemModelOption{
			Name:    strings.TrimSpace(item.Name),
			Label:   strings.TrimSpace(item.Label),
			Enabled: item.Enabled,
		})
	}

	config, apiError := handler.service.Update(c.UserContext(), model.UpdateSystemConfigRequest{
		Models:           models,
		DefaultModel:     strings.TrimSpace(request.DefaultModel),
		CodeDefaultModel: strings.TrimSpace(request.CodeDefaultModel),
		SearchService:    strings.TrimSpace(request.SearchService),
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, config, "更新系统配置成功")
}
