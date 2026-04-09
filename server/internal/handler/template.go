package handler

import (
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type templateIDPathRequest struct {
	TemplateID int64 `path:"templateId" validate:"required,min=1"`
}

type createTemplateRequest struct {
	TemplateKey        string          `json:"templateKey" validate:"required"`
	Name               string          `json:"name" validate:"required"`
	Description        string          `json:"description"`
	Engine             string          `json:"engine" validate:"required,oneof=jinja2"`
	OutputType         string          `json:"outputType" validate:"required,oneof=text html"`
	Status             string          `json:"status" validate:"required,oneof=active disabled"`
	Content            string          `json:"content" validate:"required"`
	DefaultContextJSON json.RawMessage `json:"defaultContextJson"`
}

type updateTemplateRequest struct {
	TemplateID         int64           `path:"templateId" validate:"required,min=1"`
	Name               string          `json:"name" validate:"required"`
	Description        string          `json:"description"`
	OutputType         string          `json:"outputType" validate:"required,oneof=text html"`
	Status             string          `json:"status" validate:"required,oneof=active disabled"`
	Content            string          `json:"content" validate:"required"`
	DefaultContextJSON json.RawMessage `json:"defaultContextJson"`
}

type previewTemplateRequest struct {
	Content     string          `json:"content" validate:"required"`
	ContextJSON json.RawMessage `json:"contextJson"`
}

type TemplateHandler struct {
	templateService service.TemplateService
	registry        *apimeta.Registry
}

func NewTemplateHandler(templateService service.TemplateService, registry *apimeta.Registry) *TemplateHandler {
	return &TemplateHandler{
		templateService: templateService,
		registry:        registry,
	}
}

func (handler *TemplateHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	adminMiddlewares := []fiber.Handler{adminMiddleware}
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/templates",
		Summary:            "获取模板列表",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[[]model.TemplateDTO](),
	}, handler.ListTemplates)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[templateIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/templates/:templateId",
		Summary:            "获取模板详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.TemplateDetailDTO](),
	}, handler.GetTemplateByID)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createTemplateRequest]{
		Method:             fiber.MethodPost,
		Path:               "/templates",
		Summary:            "创建模板",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.TemplateDTO](),
	}, handler.CreateTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[previewTemplateRequest]{
		Method:             fiber.MethodPost,
		Path:               "/templates/preview",
		Summary:            "预览模板渲染",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.PreviewTemplateResponse](),
	}, handler.PreviewTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateTemplateRequest]{
		Method:             fiber.MethodPut,
		Path:               "/templates/:templateId",
		Summary:            "更新模板",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.TemplateDTO](),
	}, handler.UpdateTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[templateIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/templates/:templateId",
		Summary:            "删除模板",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.DeleteTemplate)
}

func (handler *TemplateHandler) ListTemplates(c *fiber.Ctx, _ *struct{}) error {
	templates, apiError := handler.templateService.List(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, templates, "获取模板列表成功")
}

func (handler *TemplateHandler) GetTemplateByID(c *fiber.Ctx, request *templateIDPathRequest) error {
	template, apiError := handler.templateService.GetByID(c.UserContext(), request.TemplateID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, template, "获取模板成功")
}

func (handler *TemplateHandler) CreateTemplate(c *fiber.Ctx, request *createTemplateRequest) error {
	request.TemplateKey = strings.TrimSpace(request.TemplateKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Engine = strings.TrimSpace(request.Engine)
	request.OutputType = strings.TrimSpace(request.OutputType)
	request.Status = strings.TrimSpace(request.Status)
	request.Content = strings.TrimSpace(request.Content)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	created, apiError := handler.templateService.Create(c.UserContext(), model.CreateTemplateRequest{
		TemplateKey:        request.TemplateKey,
		Name:               request.Name,
		Description:        request.Description,
		Engine:             request.Engine,
		OutputType:         request.OutputType,
		Status:             request.Status,
		Content:            request.Content,
		DefaultContextJSON: request.DefaultContextJSON,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, created, "创建模板成功")
}

func (handler *TemplateHandler) UpdateTemplate(c *fiber.Ctx, request *updateTemplateRequest) error {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.OutputType = strings.TrimSpace(request.OutputType)
	request.Status = strings.TrimSpace(request.Status)
	request.Content = strings.TrimSpace(request.Content)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	updated, apiError := handler.templateService.Update(c.UserContext(), request.TemplateID, model.UpdateTemplateRequest{
		Name:               request.Name,
		Description:        request.Description,
		OutputType:         request.OutputType,
		Status:             request.Status,
		Content:            request.Content,
		DefaultContextJSON: request.DefaultContextJSON,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, updated, "更新模板成功")
}

func (handler *TemplateHandler) DeleteTemplate(c *fiber.Ctx, request *templateIDPathRequest) error {
	apiError := handler.templateService.Delete(c.UserContext(), request.TemplateID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除模板成功")
}

func (handler *TemplateHandler) PreviewTemplate(c *fiber.Ctx, request *previewTemplateRequest) error {
	request.Content = strings.TrimSpace(request.Content)

	preview, apiError := handler.templateService.Preview(c.UserContext(), model.PreviewTemplateRequest{
		Content:     request.Content,
		ContextJSON: request.ContextJSON,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, preview, "预览渲染成功")
}
