package handler

import (
	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type HealthHandler struct {
	systemService service.SystemService
	registry      *apimeta.Registry
}

func NewHealthHandler(systemService service.SystemService, registry *apimeta.Registry) *HealthHandler {
	return &HealthHandler{
		systemService: systemService,
		registry:      registry,
	}
}

func (handler *HealthHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:  fiber.MethodGet,
		Path:    "/health",
		Summary: "健康检查",
		Auth:    "public",
	}, handler.GetHealth)
}

func (handler *HealthHandler) GetHealth(c *fiber.Ctx, _ *struct{}) error {
	health := handler.systemService.GetHealth(c.UserContext())
	return response.Success(c, fiber.StatusOK, health, "健康检查成功")
}
