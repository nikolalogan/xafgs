package handler

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(
	router fiber.Router,
	healthHandler *HealthHandler,
	authHandler *AuthHandler,
	userHandler *UserHandler,
	workflowHandler *WorkflowHandler,
	workflowExecutionHandler *WorkflowExecutionHandler,
	templateHandler *TemplateHandler,
	apiMetaHandler *APIMetaHandler,
	userConfigHandler *UserConfigHandler,
	chatHandler *ChatHandler,
	authMiddleware fiber.Handler,
	adminMiddleware fiber.Handler,
) {
	publicGroup := router.Group("")
	healthHandler.Register(publicGroup)
	authHandler.Register(publicGroup)

	protectedGroup := router.Group("", authMiddleware)
	userHandler.Register(protectedGroup, adminMiddleware)
	userConfigHandler.Register(protectedGroup)
	chatHandler.Register(protectedGroup)
	workflowHandler.Register(protectedGroup)
	workflowExecutionHandler.Register(protectedGroup, adminMiddleware)
	templateHandler.Register(protectedGroup, adminMiddleware)
	apiMetaHandler.Register(protectedGroup, adminMiddleware)
}
