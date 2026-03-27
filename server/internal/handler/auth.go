package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type AuthHandler struct {
	authService service.AuthService
}

func NewAuthHandler(authService service.AuthService) *AuthHandler {
	return &AuthHandler{
		authService: authService,
	}
}

func (handler *AuthHandler) Register(router fiber.Router) {
	router.Post("/auth/login", handler.Login)
}

func (handler *AuthHandler) Login(c *fiber.Ctx) error {
	var request model.LoginRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.Username = strings.TrimSpace(request.Username)
	request.Password = strings.TrimSpace(request.Password)

	loginResponse, apiError := handler.authService.Login(c.UserContext(), request.Username, request.Password)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}

	return response.Success(c, fiber.StatusOK, loginResponse, "登录成功")
}
