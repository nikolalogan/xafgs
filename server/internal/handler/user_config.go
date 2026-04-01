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

type updateUserConfigRequest struct {
	WarningAccount  string `json:"warningAccount"`
	WarningPassword string `json:"warningPassword"`
	AIBaseURL       string `json:"aiBaseUrl"`
	AIApiKey        string `json:"aiApiKey"`
}

type UserConfigHandler struct {
	service  service.UserConfigService
	registry *apimeta.Registry
}

func NewUserConfigHandler(service service.UserConfigService, registry *apimeta.Registry) *UserConfigHandler {
	return &UserConfigHandler{
		service:  service,
		registry: registry,
	}
}

func (handler *UserConfigHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:  fiber.MethodGet,
		Path:    "/user-config",
		Summary: "获取当前用户配置",
		Auth:    "auth",
	}, handler.GetCurrentUserConfig)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateUserConfigRequest]{
		Method:  fiber.MethodPut,
		Path:    "/user-config",
		Summary: "更新当前用户配置",
		Auth:    "auth",
	}, handler.UpdateCurrentUserConfig)
}

func (handler *UserConfigHandler) GetCurrentUserConfig(c *fiber.Ctx, _ *struct{}) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	config, apiError := handler.service.GetByUserID(c.UserContext(), userID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, config, "获取用户配置成功")
}

func (handler *UserConfigHandler) UpdateCurrentUserConfig(c *fiber.Ctx, request *updateUserConfigRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	operatorID := userID

	updated, apiError := handler.service.UpdateByUserID(c.UserContext(), userID, model.UpdateUserConfigRequest{
		WarningAccount:  strings.TrimSpace(request.WarningAccount),
		WarningPassword: strings.TrimSpace(request.WarningPassword),
		AIBaseURL:       strings.TrimSpace(request.AIBaseURL),
		AIApiKey:        strings.TrimSpace(request.AIApiKey),
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, updated, "更新用户配置成功")
}

