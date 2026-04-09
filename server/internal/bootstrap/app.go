package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/healthcheck"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/db"
	"sxfgssever/server/internal/handler"
	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
	"sxfgssever/server/internal/workflowruntime"
)

type Config struct {
	Port            string
	AppName         string
	APIToken        string
	FileStorageRoot string
}

func NewApp() (*fiber.App, Config) {
	cfg := Config{
		Port:            envOrDefault("PORT", "8080"),
		AppName:         envOrDefault("APP_NAME", "sxfgssever-api"),
		APIToken:        envOrDefault("API_TOKEN", "dev-token"),
		FileStorageRoot: envOrDefault("FILE_STORAGE_ROOT", "/tmp/sxfg_uploads"),
	}

	app := fiber.New(fiber.Config{
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
		AppName:      cfg.AppName,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			var apiError *model.APIError
			if errors.As(err, &apiError) {
				return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
			}
			var fiberError *fiber.Error
			if errors.As(err, &fiberError) {
				responseCode := response.CodeBadRequest
				message := fiberError.Message
				if fiberError.Code == fiber.StatusNotFound {
					responseCode = response.CodeNotFound
				}
				if fiberError.Code >= fiber.StatusInternalServerError {
					responseCode = response.CodeInternal
					if strings.TrimSpace(message) == "" {
						message = "服务器内部错误"
					} else {
						message = "服务器内部错误：" + message
					}
				}
				return response.Error(c, fiberError.Code, responseCode, message)
			}
			if strings.TrimSpace(err.Error()) == "" {
				return response.Error(c, fiber.StatusInternalServerError, response.CodeInternal, "服务器内部错误")
			}
			return response.Error(c, fiber.StatusInternalServerError, response.CodeInternal, "服务器内部错误："+err.Error())
		},
	})

	app.Use(requestid.New())
	app.Use(recover.New())
	app.Use(middleware.RequestLogger())
	app.Use(compress.New(compress.Config{
		Level: compress.LevelBestSpeed,
	}))
	app.Use(healthcheck.New())

	api := app.Group("/api")
	systemRepository := repository.NewSystemRepository(cfg.AppName)
	systemConfigRepository := repository.NewSystemConfigRepository()
	userRepository := repository.NewUserRepository()
	userConfigRepository := repository.NewUserConfigRepository()
	workflowRepository := repository.NewWorkflowRepository()
	enterpriseRepository := repository.NewEnterpriseRepository()
	regionRepository := repository.NewRegionRepository()
	fileRepository := repository.NewFileRepository()
	templateRepository := repository.NewTemplateRepository()
	chatRepository := repository.NewChatRepository()
	authRepository := repository.NewAuthRepository(cfg.APIToken)

	dsnConfigured := strings.TrimSpace(os.Getenv("DATABASE_URL")) != ""
	result, ok, err := db.OpenFromEnv()
	if dsnConfigured && (err != nil || !ok) {
		panic(fmt.Sprintf("DATABASE_URL 已配置，但连接 PostgreSQL 失败: %v", err))
	}
	if err != nil {
		log.Printf("OpenFromEnv 失败，降级为内存仓储: %v", err)
	}
	if ok {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := db.Migrate(ctx, result.DB); err != nil {
			if dsnConfigured {
				panic(fmt.Sprintf("PostgreSQL 迁移失败: %v", err))
			}
			log.Printf("PostgreSQL 迁移失败，降级为内存仓储: %v", err)
		} else {
			userRepository = repository.NewPostgresUserRepository(result.DB)
			systemConfigRepository = repository.NewPostgresSystemConfigRepository(result.DB)
			userConfigRepository = repository.NewPostgresUserConfigRepository(result.DB)
			workflowRepository = repository.NewPostgresWorkflowRepository(result.DB)
			enterpriseRepository = repository.NewPostgresEnterpriseRepository(result.DB)
			regionRepository = repository.NewPostgresRegionRepository(result.DB)
			fileRepository = repository.NewPostgresFileRepository(result.DB)
			templateRepository = repository.NewPostgresTemplateRepository(result.DB)
			chatRepository = repository.NewPostgresChatRepository(result.DB)
			if err := db.Seed(ctx, result.DB); err != nil {
				log.Printf("PostgreSQL Seed 失败: %v", err)
			}
		}
	}

	systemService := service.NewSystemService(systemRepository)
	systemConfigService := service.NewSystemConfigService(systemConfigRepository)
	userService := service.NewUserService(userRepository)
	userConfigService := service.NewUserConfigService(userConfigRepository)
	workflowService := service.NewWorkflowService(workflowRepository)
	enterpriseService := service.NewEnterpriseService(enterpriseRepository, regionRepository)
	regionService := service.NewRegionService(regionRepository)
	fileStorage := service.NewLocalFileStorage(cfg.FileStorageRoot)
	fileService := service.NewFileService(fileRepository, fileStorage)
	templateRenderer := service.NewGonjaTemplateRenderer()
	templateService := service.NewTemplateService(templateRepository, templateRenderer)
	aiClient := ai.NewOpenAICompatClient(nil)
	webSearchClient := service.NewTavilySearchClient(nil)
	chatService := service.NewChatService(chatRepository, systemConfigService, userConfigService, fileService, webSearchClient, aiClient)
	workflowCodeGenerateService := service.NewWorkflowCodeGenerateService(userConfigService, systemConfigService, aiClient)
	workflowNodeGenerateService := service.NewWorkflowNodeGenerateService(userConfigService, systemConfigService, aiClient)
	workflowDSLGenerateService := service.NewWorkflowDSLGenerateService(userConfigService, systemConfigService, fileService, aiClient)
	executionStore := workflowruntime.ExecutionStorePort(workflowruntime.NewInMemoryExecutionStore())
	if ok {
		executionStore = workflowruntime.NewPostgresExecutionStore(result.DB)
	}
	executionRuntime := workflowruntime.NewRuntime(executionStore, workflowruntime.WithAIClient(aiClient))
	workflowExecutionService := service.NewWorkflowExecutionService(executionRuntime)
	workflowExecutionRateLimiter := service.NewWorkflowExecutionRateLimiter()
	authService := service.NewAuthService(authRepository, userRepository)
	authMiddleware := middleware.NewAuthMiddleware(authService)
	apiRegistry := apimeta.NewRegistry("/api")
	healthHandler := handler.NewHealthHandler(systemService, apiRegistry)
	authHandler := handler.NewAuthHandler(authService, apiRegistry)
	userHandler := handler.NewUserHandler(userService, apiRegistry)
	systemConfigHandler := handler.NewSystemConfigHandler(systemConfigService, apiRegistry)
	userConfigHandler := handler.NewUserConfigHandler(userConfigService, apiRegistry)
	workflowHandler := handler.NewWorkflowHandler(workflowService, apiRegistry)
	enterpriseHandler := handler.NewEnterpriseHandler(enterpriseService, apiRegistry)
	regionHandler := handler.NewRegionHandler(regionService, apiRegistry)
	workflowExecutionHandler := handler.NewWorkflowExecutionHandler(workflowExecutionService, workflowService, workflowExecutionRateLimiter, userConfigService, apiRegistry)
	fileHandler := handler.NewFileHandler(fileService, apiRegistry)
	templateHandler := handler.NewTemplateHandler(templateService, apiRegistry)
	chatHandler := handler.NewChatHandler(chatService, apiRegistry)
	workflowCodeGenerateHandler := handler.NewWorkflowCodeGenerateHandler(workflowCodeGenerateService, apiRegistry)
	workflowNodeGenerateHandler := handler.NewWorkflowNodeGenerateHandler(workflowNodeGenerateService, apiRegistry)
	workflowDSLGenerateHandler := handler.NewWorkflowDSLGenerateHandler(workflowDSLGenerateService, apiRegistry)

	traceStore := apimeta.NewTraceStore(300)
	traceMiddleware := middleware.NewTraceMiddleware(traceStore)
	app.Use(traceMiddleware.Handler())

	apiMetaHandler := handler.NewAPIMetaHandler(apiRegistry, traceStore)
	handler.RegisterRoutes(api, healthHandler, authHandler, userHandler, systemConfigHandler, workflowCodeGenerateHandler, workflowNodeGenerateHandler, workflowDSLGenerateHandler, workflowHandler, workflowExecutionHandler, fileHandler, templateHandler, enterpriseHandler, regionHandler, apiMetaHandler, userConfigHandler, chatHandler, authMiddleware.Require, authMiddleware.RequireAdmin)

	return app, cfg
}

func envOrDefault(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
