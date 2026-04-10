package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type listAdminDivisionsRequest struct {
	Page       *int64 `query:"page" validate:"min=1"`
	PageSize   *int64 `query:"pageSize" validate:"min=1,max=100"`
	Keyword    string `query:"keyword"`
	Level      *int64 `query:"level" validate:"omitempty,min=1,max=16"`
	ParentCode string `query:"parentCode"`
}

type adminDivisionCodeRequest struct {
	Code string `query:"code" validate:"required"`
}

type AdminDivisionHandler struct {
	service  service.AdminDivisionService
	registry *apimeta.Registry
}

func NewAdminDivisionHandler(service service.AdminDivisionService, registry *apimeta.Registry) *AdminDivisionHandler {
	return &AdminDivisionHandler{service: service, registry: registry}
}

func (handler *AdminDivisionHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	adminMiddlewares := []fiber.Handler{adminMiddleware}
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[listAdminDivisionsRequest]{
		Method:             fiber.MethodGet,
		Path:               "/admin-divisions",
		Summary:            "分页查询行政区划",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.AdminDivisionPageResult](),
	}, handler.List)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[adminDivisionCodeRequest]{
		Method:             fiber.MethodGet,
		Path:               "/admin-divisions/by-code",
		Summary:            "按编码查询行政区划及父级链路",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.AdminDivisionByCodeResult](),
	}, handler.GetByCode)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[adminDivisionCodeRequest]{
		Method:             fiber.MethodGet,
		Path:               "/admin-divisions/parent-chain",
		Summary:            "按编码查询行政区划父级链路",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[[]model.AdminDivisionChainNode](),
	}, handler.GetParentChain)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[adminDivisionCodeRequest]{
		Method:             fiber.MethodGet,
		Path:               "/admin-divisions/ancestors",
		Summary:            "按编码查询行政区划所有父级节点",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[[]model.AdminDivisionAncestorNode](),
	}, handler.GetAncestors)
}

func (handler *AdminDivisionHandler) List(c *fiber.Ctx, request *listAdminDivisionsRequest) error {
	page := 1
	if request.Page != nil {
		page = int(*request.Page)
	}
	pageSize := 10
	if request.PageSize != nil {
		pageSize = int(*request.PageSize)
	}
	var level *int
	if request.Level != nil {
		converted := int(*request.Level)
		level = &converted
	}

	result, apiError := handler.service.List(c.UserContext(), model.AdminDivisionListQuery{
		Page:       page,
		PageSize:   pageSize,
		Keyword:    strings.TrimSpace(request.Keyword),
		Level:      level,
		ParentCode: strings.TrimSpace(request.ParentCode),
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取行政区划列表成功")
}

func (handler *AdminDivisionHandler) GetByCode(c *fiber.Ctx, request *adminDivisionCodeRequest) error {
	result, apiError := handler.service.GetByCode(c.UserContext(), request.Code)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取行政区划成功")
}

func (handler *AdminDivisionHandler) GetParentChain(c *fiber.Ctx, request *adminDivisionCodeRequest) error {
	result, apiError := handler.service.GetParentChain(c.UserContext(), request.Code)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取行政区划父级链路成功")
}

func (handler *AdminDivisionHandler) GetAncestors(c *fiber.Ctx, request *adminDivisionCodeRequest) error {
	result, apiError := handler.service.GetAncestors(c.UserContext(), request.Code)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取行政区划父级节点成功")
}
