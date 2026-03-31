package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type templatePathParams struct {
	TemplateID int64 `params:"templateId"`
}

type TemplateHandler struct {
	templateService service.TemplateService
}

func NewTemplateHandler(templateService service.TemplateService) *TemplateHandler {
	return &TemplateHandler{
		templateService: templateService,
	}
}

func (handler *TemplateHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	adminGroup := router.Group("/templates", adminMiddleware)
	adminGroup.Get("", handler.ListTemplates)
	adminGroup.Get("/:templateId", handler.GetTemplateByID)
	adminGroup.Post("", handler.CreateTemplate)
	adminGroup.Post("/preview", handler.PreviewTemplate)
	adminGroup.Put("/:templateId", handler.UpdateTemplate)
	adminGroup.Delete("/:templateId", handler.DeleteTemplate)
}

func (handler *TemplateHandler) ListTemplates(c *fiber.Ctx) error {
	templates, apiError := handler.templateService.List(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, templates, "获取模板列表成功")
}

func (handler *TemplateHandler) GetTemplateByID(c *fiber.Ctx) error {
	var pathParams templatePathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.TemplateID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "templateId 必须为正整数")
	}

	template, apiError := handler.templateService.GetByID(c.UserContext(), pathParams.TemplateID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, template, "获取模板成功")
}

func (handler *TemplateHandler) CreateTemplate(c *fiber.Ctx) error {
	var request model.CreateTemplateRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

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

	created, apiError := handler.templateService.Create(c.UserContext(), request, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, created, "创建模板成功")
}

func (handler *TemplateHandler) UpdateTemplate(c *fiber.Ctx) error {
	var pathParams templatePathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.TemplateID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "templateId 必须为正整数")
	}

	var request model.UpdateTemplateRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.OutputType = strings.TrimSpace(request.OutputType)
	request.Status = strings.TrimSpace(request.Status)
	request.Content = strings.TrimSpace(request.Content)

	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	updated, apiError := handler.templateService.Update(c.UserContext(), pathParams.TemplateID, request, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, updated, "更新模板成功")
}

func (handler *TemplateHandler) DeleteTemplate(c *fiber.Ctx) error {
	var pathParams templatePathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.TemplateID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "templateId 必须为正整数")
	}

	apiError := handler.templateService.Delete(c.UserContext(), pathParams.TemplateID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除模板成功")
}

func (handler *TemplateHandler) PreviewTemplate(c *fiber.Ctx) error {
	var request model.PreviewTemplateRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.Content = strings.TrimSpace(request.Content)

	preview, apiError := handler.templateService.Preview(c.UserContext(), request)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, preview, "预览渲染成功")
}
