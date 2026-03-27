package handler

import (
	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type HealthHandler struct {
	systemService service.SystemService
}

func NewHealthHandler(systemService service.SystemService) *HealthHandler {
	return &HealthHandler{
		systemService: systemService,
	}
}

func (handler *HealthHandler) Register(router fiber.Router) {
	router.Get("/health", handler.GetHealth)
}

func (handler *HealthHandler) GetHealth(c *fiber.Ctx) error {
	health := handler.systemService.GetHealth(c.UserContext())
	return response.Success(c, fiber.StatusOK, health, "健康检查成功")
}
