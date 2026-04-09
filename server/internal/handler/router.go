package handler

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(
	router fiber.Router,
	healthHandler *HealthHandler,
	authHandler *AuthHandler,
	userHandler *UserHandler,
	systemConfigHandler *SystemConfigHandler,
	workflowCodeGenerateHandler *WorkflowCodeGenerateHandler,
	workflowNodeGenerateHandler *WorkflowNodeGenerateHandler,
	workflowDSLGenerateHandler *WorkflowDSLGenerateHandler,
	workflowHandler *WorkflowHandler,
	workflowExecutionHandler *WorkflowExecutionHandler,
	fileHandler *FileHandler,
	templateHandler *TemplateHandler,
	enterpriseHandler *EnterpriseHandler,
	regionHandler *RegionHandler,
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
	systemConfigHandler.Register(protectedGroup, adminMiddleware)
	chatHandler.Register(protectedGroup)
	workflowCodeGenerateHandler.Register(protectedGroup)
	workflowNodeGenerateHandler.Register(protectedGroup)
	workflowDSLGenerateHandler.Register(protectedGroup)
	workflowHandler.Register(protectedGroup)
	workflowExecutionHandler.Register(protectedGroup, nil)
	fileHandler.Register(protectedGroup)
	templateHandler.Register(protectedGroup, adminMiddleware)
	enterpriseHandler.Register(protectedGroup)
	regionHandler.Register(protectedGroup)
	apiMetaHandler.Register(protectedGroup, adminMiddleware)
}
