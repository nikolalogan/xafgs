package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type userIDPathRequest struct {
	UserID int64 `path:"userId" validate:"required,min=1"`
}

type createUserRequest struct {
	Username string `json:"username" validate:"required"`
	Name     string `json:"name" validate:"required"`
	Password string `json:"password" validate:"required"`
	Role     string `json:"role" validate:"required,oneof=admin user"`
}

type updateUserRequest struct {
	UserID   int64  `path:"userId" validate:"required,min=1"`
	Name     string `json:"name" validate:"required"`
	Password string `json:"password" validate:"required"`
	Role     string `json:"role" validate:"required,oneof=admin user"`
}

type UserHandler struct {
	userService service.UserService
	registry    *apimeta.Registry
}

func NewUserHandler(userService service.UserService, registry *apimeta.Registry) *UserHandler {
	return &UserHandler{
		userService: userService,
		registry:    registry,
	}
}

func (handler *UserHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/me",
		Summary:            "获取当前用户",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.UserDTO](),
	}, handler.GetCurrentUser)

	adminGroup := router.Group("", adminMiddleware)
	apimeta.Register(adminGroup, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/users",
		Summary:            "获取用户列表",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[[]model.UserDTO](),
	}, handler.ListUsers)
	apimeta.Register(adminGroup, handler.registry, apimeta.RouteSpec[userIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/users/:userId",
		Summary:            "获取用户详情",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[model.UserDTO](),
	}, handler.GetUserByID)
	apimeta.Register(adminGroup, handler.registry, apimeta.RouteSpec[createUserRequest]{
		Method:             fiber.MethodPost,
		Path:               "/users",
		Summary:            "创建用户",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[model.UserDTO](),
	}, handler.CreateUser)
	apimeta.Register(adminGroup, handler.registry, apimeta.RouteSpec[updateUserRequest]{
		Method:             fiber.MethodPut,
		Path:               "/users/:userId",
		Summary:            "更新用户",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[model.UserDTO](),
	}, handler.UpdateUser)
	apimeta.Register(adminGroup, handler.registry, apimeta.RouteSpec[userIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/users/:userId",
		Summary:            "删除用户",
		Auth:               "admin",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.DeleteUser)
}

func (handler *UserHandler) GetCurrentUser(c *fiber.Ctx, _ *struct{}) error {
	value := c.Locals(middleware.LocalAuthUser)
	user, ok := value.(model.UserDTO)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	return response.Success(c, fiber.StatusOK, user, "获取当前用户成功")
}

func (handler *UserHandler) GetUserByID(c *fiber.Ctx, request *userIDPathRequest) error {
	user, apiError := handler.userService.GetByID(c.UserContext(), request.UserID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, user, "获取用户成功")
}

func (handler *UserHandler) ListUsers(c *fiber.Ctx, _ *struct{}) error {
	users, apiError := handler.userService.List(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, users, "获取用户列表成功")
}

func (handler *UserHandler) CreateUser(c *fiber.Ctx, request *createUserRequest) error {
	request.Username = strings.TrimSpace(request.Username)
	request.Name = strings.TrimSpace(request.Name)
	request.Password = strings.TrimSpace(request.Password)
	request.Role = strings.TrimSpace(request.Role)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	user, apiError := handler.userService.Create(c.UserContext(), model.CreateUserRequest{
		Username: request.Username,
		Name:     request.Name,
		Password: request.Password,
		Role:     request.Role,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, user, "创建用户成功")
}

func (handler *UserHandler) UpdateUser(c *fiber.Ctx, request *updateUserRequest) error {
	request.Name = strings.TrimSpace(request.Name)
	request.Password = strings.TrimSpace(request.Password)
	request.Role = strings.TrimSpace(request.Role)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	user, apiError := handler.userService.Update(c.UserContext(), request.UserID, model.UpdateUserRequest{
		Name:     request.Name,
		Password: request.Password,
		Role:     request.Role,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, user, "更新用户成功")
}

func (handler *UserHandler) DeleteUser(c *fiber.Ctx, request *userIDPathRequest) error {
	apiError := handler.userService.Delete(c.UserContext(), request.UserID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除用户成功")
}
