package service

import (
	"context"
	"encoding/json"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type TemplateService interface {
	GetByID(ctx context.Context, templateID int64) (model.TemplateDetailDTO, *model.APIError)
	List(ctx context.Context) ([]model.TemplateDTO, *model.APIError)
	Create(ctx context.Context, request model.CreateTemplateRequest, operatorID int64) (model.TemplateDTO, *model.APIError)
	Update(ctx context.Context, templateID int64, request model.UpdateTemplateRequest, operatorID int64) (model.TemplateDTO, *model.APIError)
	Delete(ctx context.Context, templateID int64) *model.APIError
	Preview(ctx context.Context, request model.PreviewTemplateRequest) (model.PreviewTemplateResponse, *model.APIError)
}

type templateService struct {
	templateRepository repository.TemplateRepository
	templateRenderer   TemplateRenderer
}

func NewTemplateService(templateRepository repository.TemplateRepository, templateRenderer TemplateRenderer) TemplateService {
	return &templateService{
		templateRepository: templateRepository,
		templateRenderer:   templateRenderer,
	}
}

func (service *templateService) GetByID(_ context.Context, templateID int64) (model.TemplateDetailDTO, *model.APIError) {
	template, ok := service.templateRepository.FindEntityByID(templateID)
	if !ok {
		return model.TemplateDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "模板不存在")
	}
	if len(template.DefaultContextJSON) == 0 {
		template.DefaultContextJSON = json.RawMessage(`{}`)
	}
	return template.ToDetailDTO(), nil
}

func (service *templateService) List(_ context.Context) ([]model.TemplateDTO, *model.APIError) {
	return service.templateRepository.FindAll(), nil
}

func (service *templateService) Create(
	_ context.Context,
	request model.CreateTemplateRequest,
	operatorID int64,
) (model.TemplateDTO, *model.APIError) {
	request.TemplateKey = strings.TrimSpace(request.TemplateKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Engine = strings.TrimSpace(request.Engine)
	request.OutputType = strings.TrimSpace(request.OutputType)
	request.Status = strings.TrimSpace(request.Status)
	request.Content = strings.TrimSpace(request.Content)

	if request.TemplateKey == "" || request.Name == "" {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateKey、name 不能为空")
	}
	if request.Engine == "" {
		request.Engine = model.TemplateEngineJinja2
	}
	if !model.IsValidTemplateEngine(request.Engine) {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "engine 仅支持 jinja2")
	}
	if request.OutputType == "" {
		request.OutputType = model.TemplateOutputTypeHTML
	}
	if !model.IsValidTemplateOutputType(request.OutputType) {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "outputType 仅支持 text/html")
	}
	if request.Status == "" {
		request.Status = model.TemplateStatusActive
	}
	if !model.IsValidTemplateStatus(request.Status) {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	if request.Content == "" {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "content 不能为空")
	}
	if _, exists := service.templateRepository.FindByTemplateKey(request.TemplateKey); exists {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateKey 已存在")
	}
	defaultContext, apiError := normalizeContextJSON(request.DefaultContextJSON)
	if apiError != nil {
		return model.TemplateDTO{}, apiError
	}

	template := model.Template{
		BaseEntity: model.BaseEntity{
			CreatedBy: operatorID,
			UpdatedBy: operatorID,
		},
		TemplateKey:        request.TemplateKey,
		Name:               request.Name,
		Description:        request.Description,
		Engine:             request.Engine,
		OutputType:         request.OutputType,
		Status:             request.Status,
		Content:            request.Content,
		DefaultContextJSON: defaultContext,
	}
	return service.templateRepository.Create(template), nil
}

func (service *templateService) Update(
	_ context.Context,
	templateID int64,
	request model.UpdateTemplateRequest,
	operatorID int64,
) (model.TemplateDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.OutputType = strings.TrimSpace(request.OutputType)
	request.Status = strings.TrimSpace(request.Status)
	request.Content = strings.TrimSpace(request.Content)

	if request.Name == "" {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "name 不能为空")
	}
	if request.OutputType == "" {
		request.OutputType = model.TemplateOutputTypeHTML
	}
	if !model.IsValidTemplateOutputType(request.OutputType) {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "outputType 仅支持 text/html")
	}
	if request.Status == "" {
		request.Status = model.TemplateStatusActive
	}
	if !model.IsValidTemplateStatus(request.Status) {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	if request.Content == "" {
		return model.TemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "content 不能为空")
	}
	defaultContext, apiError := normalizeContextJSON(request.DefaultContextJSON)
	if apiError != nil {
		return model.TemplateDTO{}, apiError
	}

	updated, ok := service.templateRepository.Update(templateID, model.Template{
		Name:               request.Name,
		Description:        request.Description,
		OutputType:         request.OutputType,
		Status:             request.Status,
		Content:            request.Content,
		DefaultContextJSON: defaultContext,
		BaseEntity: model.BaseEntity{
			UpdatedBy: operatorID,
		},
	})
	if !ok {
		return model.TemplateDTO{}, model.NewAPIError(404, response.CodeNotFound, "模板不存在")
	}
	return updated, nil
}

func (service *templateService) Delete(_ context.Context, templateID int64) *model.APIError {
	if !service.templateRepository.Delete(templateID) {
		return model.NewAPIError(404, response.CodeNotFound, "模板不存在")
	}
	return nil
}

func (service *templateService) Preview(
	_ context.Context,
	request model.PreviewTemplateRequest,
) (model.PreviewTemplateResponse, *model.APIError) {
	request.Content = strings.TrimSpace(request.Content)
	if request.Content == "" {
		return model.PreviewTemplateResponse{}, model.NewAPIError(400, response.CodeBadRequest, "content 不能为空")
	}

	contextObject, apiError := parseContextObject(request.ContextJSON)
	if apiError != nil {
		return model.PreviewTemplateResponse{}, apiError
	}

	rendered, err := service.templateRenderer.Render(request.Content, contextObject)
	if err != nil {
		return model.PreviewTemplateResponse{}, model.NewAPIError(400, response.CodeBadRequest, "模板渲染失败："+err.Error())
	}
	return model.PreviewTemplateResponse{Rendered: rendered}, nil
}

func normalizeContextJSON(raw json.RawMessage) (json.RawMessage, *model.APIError) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "defaultContextJson 不是合法 JSON")
	}
	rootObject, ok := root.(map[string]any)
	if !ok {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "defaultContextJson 必须为 JSON object")
	}
	normalized, err := json.Marshal(rootObject)
	if err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "defaultContextJson 序列化失败")
	}
	return normalized, nil
}

func parseContextObject(raw json.RawMessage) (map[string]any, *model.APIError) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "contextJson 不是合法 JSON")
	}
	rootObject, ok := root.(map[string]any)
	if !ok {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "contextJson 必须为 JSON object")
	}
	return rootObject, nil
}
