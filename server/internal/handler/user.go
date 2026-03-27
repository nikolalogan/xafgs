package handler

import (
	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type userPathParams struct {
	UserID int64 `params:"userId"`
}

type UserHandler struct {
	userService service.UserService
}

func NewUserHandler(userService service.UserService) *UserHandler {
	return &UserHandler{
		userService: userService,
	}
}

func (handler *UserHandler) Register(router fiber.Router) {
	router.Get("/me", handler.GetCurrentUser)
	router.Get("/users/:userId", handler.GetUserByID)
}

func (handler *UserHandler) GetCurrentUser(c *fiber.Ctx) error {
	value := c.Locals(middleware.LocalAuthUser)
	user, ok := value.(model.UserDTO)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	return response.Success(c, fiber.StatusOK, user, "获取当前用户成功")
}

func (handler *UserHandler) GetUserByID(c *fiber.Ctx) error {
	var pathParams userPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.UserID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "userId 必须为正整数")
	}

	user, apiError := handler.userService.GetByID(c.UserContext(), pathParams.UserID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, user, "获取用户成功")
}
