package bootstrap

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/healthcheck"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"

	"sxfgssever/server/internal/handler"
	"sxfgssever/server/internal/db"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type Config struct {
	Port     string
	AppName  string
	APIToken string
}

func NewApp() (*fiber.App, Config) {
	cfg := Config{
		Port:     envOrDefault("PORT", "8080"),
		AppName:  envOrDefault("APP_NAME", "sxfgssever-api"),
		APIToken: envOrDefault("API_TOKEN", "dev-token"),
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
				if fiberError.Code == fiber.StatusNotFound {
					responseCode = response.CodeNotFound
				}
				if fiberError.Code >= fiber.StatusInternalServerError {
					responseCode = response.CodeInternal
				}
				return response.Error(c, fiberError.Code, responseCode, fiberError.Message)
			}
			return response.Error(c, fiber.StatusInternalServerError, response.CodeInternal, "服务器内部错误")
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
	userRepository := repository.NewUserRepository()
	workflowRepository := repository.NewWorkflowRepository()
	templateRepository := repository.NewTemplateRepository()
	authRepository := repository.NewAuthRepository(cfg.APIToken)

	if result, ok, err := db.OpenFromEnv(); err == nil && ok {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := db.Migrate(ctx, result.DB); err == nil {
			userRepository = repository.NewPostgresUserRepository(result.DB)
			workflowRepository = repository.NewPostgresWorkflowRepository(result.DB)
			templateRepository = repository.NewPostgresTemplateRepository(result.DB)
			_ = db.Seed(ctx, result.DB)
		}
	}

	systemService := service.NewSystemService(systemRepository)
	userService := service.NewUserService(userRepository)
	workflowService := service.NewWorkflowService(workflowRepository)
	templateRenderer := service.NewGonjaTemplateRenderer()
	templateService := service.NewTemplateService(templateRepository, templateRenderer)
	authService := service.NewAuthService(authRepository, userRepository)
	authMiddleware := middleware.NewAuthMiddleware(authService)
	healthHandler := handler.NewHealthHandler(systemService)
	authHandler := handler.NewAuthHandler(authService)
	userHandler := handler.NewUserHandler(userService)
	workflowHandler := handler.NewWorkflowHandler(workflowService)
	templateHandler := handler.NewTemplateHandler(templateService)
	handler.RegisterRoutes(api, healthHandler, authHandler, userHandler, workflowHandler, templateHandler, authMiddleware.Require, authMiddleware.RequireAdmin)

	return app, cfg
}

func envOrDefault(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
