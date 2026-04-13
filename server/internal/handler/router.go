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
	reportingHandler *ReportingHandler,
	enterpriseHandler *EnterpriseHandler,
	regionHandler *RegionHandler,
	adminDivisionHandler *AdminDivisionHandler,
	apiMetaHandler *APIMetaHandler,
	userConfigHandler *UserConfigHandler,
	chatHandler *ChatHandler,
	debugFeedbackHandler *DebugFeedbackHandler,
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
	reportingHandler.Register(protectedGroup, adminMiddleware)
	enterpriseHandler.Register(protectedGroup)
	regionHandler.Register(protectedGroup)
	adminDivisionHandler.Register(protectedGroup, adminMiddleware)
	apiMetaHandler.Register(protectedGroup, adminMiddleware)
	debugFeedbackHandler.Register(protectedGroup, adminMiddleware)
}
