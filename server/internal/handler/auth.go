package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type AuthHandler struct {
	authService service.AuthService
	registry    *apimeta.Registry
}

type loginRequest struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

func NewAuthHandler(authService service.AuthService, registry *apimeta.Registry) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		registry:    registry,
	}
}

func (handler *AuthHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[loginRequest]{
		Method:  fiber.MethodPost,
		Path:    "/auth/login",
		Summary: "登录",
		Auth:    "public",
	}, handler.Login)
}

func (handler *AuthHandler) Login(c *fiber.Ctx, request *loginRequest) error {
	request.Username = strings.TrimSpace(request.Username)
	request.Password = strings.TrimSpace(request.Password)

	loginResponse, apiError := handler.authService.Login(c.UserContext(), request.Username, request.Password)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}

	return response.Success(c, fiber.StatusOK, loginResponse, "登录成功")
}
