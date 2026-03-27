package handler

import (
	"strings"

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

func (handler *UserHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	router.Get("/me", handler.GetCurrentUser)

	adminGroup := router.Group("/users", adminMiddleware)
	adminGroup.Get("", handler.ListUsers)
	adminGroup.Get("/:userId", handler.GetUserByID)
	adminGroup.Post("", handler.CreateUser)
	adminGroup.Put("/:userId", handler.UpdateUser)
	adminGroup.Delete("/:userId", handler.DeleteUser)
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

func (handler *UserHandler) ListUsers(c *fiber.Ctx) error {
	users, apiError := handler.userService.List(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, users, "获取用户列表成功")
}

func (handler *UserHandler) CreateUser(c *fiber.Ctx) error {
	var request model.CreateUserRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.Username = strings.TrimSpace(request.Username)
	request.Name = strings.TrimSpace(request.Name)
	request.Password = strings.TrimSpace(request.Password)
	request.Role = strings.TrimSpace(request.Role)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	user, apiError := handler.userService.Create(c.UserContext(), request, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, user, "创建用户成功")
}

func (handler *UserHandler) UpdateUser(c *fiber.Ctx) error {
	var pathParams userPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.UserID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "userId 必须为正整数")
	}

	var request model.UpdateUserRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.Name = strings.TrimSpace(request.Name)
	request.Password = strings.TrimSpace(request.Password)
	request.Role = strings.TrimSpace(request.Role)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	user, apiError := handler.userService.Update(c.UserContext(), pathParams.UserID, request, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, user, "更新用户成功")
}

func (handler *UserHandler) DeleteUser(c *fiber.Ctx) error {
	var pathParams userPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.UserID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "userId 必须为正整数")
	}

	apiError := handler.userService.Delete(c.UserContext(), pathParams.UserID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除用户成功")
}
