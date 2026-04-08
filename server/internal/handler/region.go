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

type regionIDPathRequest struct {
	RegionID int64 `path:"regionId" validate:"required,min=1"`
}

type economyIDPathRequest struct {
	RegionID  int64 `path:"regionId" validate:"required,min=1"`
	EconomyID int64 `path:"economyId" validate:"required,min=1"`
}

type rankIDPathRequest struct {
	RegionID int64 `path:"regionId" validate:"required,min=1"`
	RankID   int64 `path:"rankId" validate:"required,min=1"`
}

type listRegionsRequest struct {
	Page     *int64 `query:"page" validate:"min=1"`
	PageSize *int64 `query:"pageSize" validate:"min=1,max=100"`
	Keyword  string `query:"keyword"`
}

type regionAdminCodeRequest struct {
	AdminCode string `query:"adminCode" validate:"required"`
}

type createRegionRequest struct {
	AdminCode  string                `json:"adminCode" validate:"required"`
	RegionCode string                `json:"regionCode"`
	RegionName string                `json:"regionName"`
	Overview   string                `json:"overview"`
	Economies  []model.RegionEconomy `json:"economies"`
	Ranks      []model.RegionRank    `json:"ranks"`
}

type regionValidateConflictRequest struct {
	ExcludeRegionID *int64                `json:"excludeRegionId" validate:"omitempty,min=1"`
	AdminCode       string                `json:"adminCode" validate:"required"`
	RegionCode      string                `json:"regionCode"`
	RegionName      string                `json:"regionName"`
	Overview        string                `json:"overview"`
	Economies       []model.RegionEconomy `json:"economies"`
	Ranks           []model.RegionRank    `json:"ranks"`
}

type updateRegionRequest struct {
	RegionID   int64                 `path:"regionId" validate:"required,min=1"`
	AdminCode  string                `json:"adminCode" validate:"required"`
	RegionCode string                `json:"regionCode"`
	RegionName string                `json:"regionName"`
	Overview   string                `json:"overview"`
	Economies  []model.RegionEconomy `json:"economies"`
	Ranks      []model.RegionRank    `json:"ranks"`
}

type RegionHandler struct {
	service  service.RegionService
	registry *apimeta.Registry
}

func NewRegionHandler(service service.RegionService, registry *apimeta.Registry) *RegionHandler {
	return &RegionHandler{service: service, registry: registry}
}

func (handler *RegionHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[listRegionsRequest]{
		Method:             fiber.MethodGet,
		Path:               "/regions",
		Summary:            "分页查询区域",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionPageResult](),
	}, handler.List)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionAdminCodeRequest]{
		Method:             fiber.MethodGet,
		Path:               "/regions/by-admin-code",
		Summary:            "按区域编码查询区域",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[*model.RegionDetailDTO](),
	}, handler.GetByAdminCode)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionValidateConflictRequest]{
		Method:             fiber.MethodPost,
		Path:               "/regions/validate-conflict",
		Summary:            "校验区域更新冲突",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ConflictResponse](),
	}, handler.ValidateConflict)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/regions/:regionId",
		Summary:            "查询区域详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionDetailDTO](),
	}, handler.GetByID)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createRegionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/regions",
		Summary:            "创建区域",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionDetailDTO](),
	}, handler.Create)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateRegionRequest]{
		Method:             fiber.MethodPut,
		Path:               "/regions/:regionId",
		Summary:            "更新区域",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionDetailDTO](),
	}, handler.Update)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/regions/:regionId",
		Summary:            "删除区域",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.Delete)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/regions/:regionId/economies",
		Summary:            "查询区域经济列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.RegionEconomy](),
	}, handler.ListEconomies)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/regions/:regionId/economies",
		Summary:            "新增区域经济",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionEconomy](),
	}, handler.CreateEconomy)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[economyIDPathRequest]{
		Method:             fiber.MethodPut,
		Path:               "/regions/:regionId/economies/:economyId",
		Summary:            "更新区域经济",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionEconomy](),
	}, handler.UpdateEconomy)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[economyIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/regions/:regionId/economies/:economyId",
		Summary:            "删除区域经济",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.DeleteEconomy)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/regions/:regionId/ranks",
		Summary:            "查询区域排名列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.RegionRank](),
	}, handler.ListRanks)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[regionIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/regions/:regionId/ranks",
		Summary:            "新增区域排名",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionRank](),
	}, handler.CreateRank)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[rankIDPathRequest]{
		Method:             fiber.MethodPut,
		Path:               "/regions/:regionId/ranks/:rankId",
		Summary:            "更新区域排名",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.RegionRank](),
	}, handler.UpdateRank)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[rankIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/regions/:regionId/ranks/:rankId",
		Summary:            "删除区域排名",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.DeleteRank)
}

func (handler *RegionHandler) GetByAdminCode(c *fiber.Ctx, request *regionAdminCodeRequest) error {
	result, apiError := handler.service.GetByAdminCode(c.UserContext(), request.AdminCode)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取区域信息成功")
}

func (handler *RegionHandler) List(c *fiber.Ctx, request *listRegionsRequest) error {
	page := 1
	if request.Page != nil {
		page = int(*request.Page)
	}
	pageSize := 10
	if request.PageSize != nil {
		pageSize = int(*request.PageSize)
	}

	result, apiError := handler.service.List(c.UserContext(), model.RegionListQuery{
		Page:     page,
		PageSize: pageSize,
		Keyword:  strings.TrimSpace(request.Keyword),
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取区域列表成功")
}

func (handler *RegionHandler) GetByID(c *fiber.Ctx, request *regionIDPathRequest) error {
	result, apiError := handler.service.GetByID(c.UserContext(), request.RegionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取区域详情成功")
}

func (handler *RegionHandler) Create(c *fiber.Ctx, request *createRegionRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.service.Create(c.UserContext(), model.CreateRegionRequest{
		AdminCode:  request.AdminCode,
		RegionCode: request.RegionCode,
		RegionName: request.RegionName,
		Overview:   request.Overview,
		Economies:  request.Economies,
		Ranks:      request.Ranks,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "保存区域成功")
}

func (handler *RegionHandler) Update(c *fiber.Ctx, request *updateRegionRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.service.Update(c.UserContext(), request.RegionID, model.UpdateRegionRequest{
		AdminCode:  request.AdminCode,
		RegionCode: request.RegionCode,
		RegionName: request.RegionName,
		Overview:   request.Overview,
		Economies:  request.Economies,
		Ranks:      request.Ranks,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "更新区域成功")
}

func (handler *RegionHandler) Delete(c *fiber.Ctx, request *regionIDPathRequest) error {
	apiError := handler.service.Delete(c.UserContext(), request.RegionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除区域成功")
}

func (handler *RegionHandler) ListEconomies(c *fiber.Ctx, request *regionIDPathRequest) error {
	result, apiError := handler.service.ListEconomies(c.UserContext(), request.RegionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取区域经济成功")
}

func (handler *RegionHandler) CreateEconomy(c *fiber.Ctx, request *regionIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	var payload model.RegionEconomy
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求参数错误")
	}
	result, apiError := handler.service.CreateEconomy(c.UserContext(), request.RegionID, payload, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "创建区域经济成功")
}

func (handler *RegionHandler) UpdateEconomy(c *fiber.Ctx, request *economyIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	var payload model.RegionEconomy
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求参数错误")
	}
	result, apiError := handler.service.UpdateEconomy(c.UserContext(), request.RegionID, request.EconomyID, payload, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "更新区域经济成功")
}

func (handler *RegionHandler) DeleteEconomy(c *fiber.Ctx, request *economyIDPathRequest) error {
	apiError := handler.service.DeleteEconomy(c.UserContext(), request.RegionID, request.EconomyID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除区域经济成功")
}

func (handler *RegionHandler) ValidateConflict(c *fiber.Ctx, request *regionValidateConflictRequest) error {
	result, apiError := handler.service.ValidateConflict(c.UserContext(), model.CreateRegionRequest{
		AdminCode:  request.AdminCode,
		RegionCode: request.RegionCode,
		RegionName: request.RegionName,
		Overview:   request.Overview,
		Economies:  request.Economies,
		Ranks:      request.Ranks,
	}, request.ExcludeRegionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "区域冲突校验完成")
}

func (handler *RegionHandler) ListRanks(c *fiber.Ctx, request *regionIDPathRequest) error {
	result, apiError := handler.service.ListRanks(c.UserContext(), request.RegionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取区域排名成功")
}

func (handler *RegionHandler) CreateRank(c *fiber.Ctx, request *regionIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	var payload model.RegionRank
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求参数错误")
	}
	result, apiError := handler.service.CreateRank(c.UserContext(), request.RegionID, payload, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "创建区域排名成功")
}

func (handler *RegionHandler) UpdateRank(c *fiber.Ctx, request *rankIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	var payload model.RegionRank
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求参数错误")
	}
	result, apiError := handler.service.UpdateRank(c.UserContext(), request.RegionID, request.RankID, payload, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "更新区域排名成功")
}

func (handler *RegionHandler) DeleteRank(c *fiber.Ctx, request *rankIDPathRequest) error {
	apiError := handler.service.DeleteRank(c.UserContext(), request.RegionID, request.RankID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除区域排名成功")
}
