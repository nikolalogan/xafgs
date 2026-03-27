package handler

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(
	router fiber.Router,
	healthHandler *HealthHandler,
	authHandler *AuthHandler,
	userHandler *UserHandler,
	authMiddleware fiber.Handler,
) {
	publicGroup := router.Group("")
	healthHandler.Register(publicGroup)
	authHandler.Register(publicGroup)

	protectedGroup := router.Group("", authMiddleware)
	userHandler.Register(protectedGroup)
}
