package service

import (
	"context"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

const DefaultSystemModel = "gpt-4o-mini"
const DefaultSearchService = "tavily"

type SystemConfigService interface {
	Get(ctx context.Context) (model.SystemConfigDTO, *model.APIError)
	Update(ctx context.Context, request model.UpdateSystemConfigRequest, operatorID int64) (model.SystemConfigDTO, *model.APIError)
}

type systemConfigService struct {
	repository repository.SystemConfigRepository
}

func NewSystemConfigService(repository repository.SystemConfigRepository) SystemConfigService {
	return &systemConfigService{repository: repository}
}

func (service *systemConfigService) Get(_ context.Context) (model.SystemConfigDTO, *model.APIError) {
	config, ok := service.repository.Get()
	if ok {
		return service.normalizeForRead(config), nil
	}
	return service.defaultConfig(), nil
}

func (service *systemConfigService) Update(
	_ context.Context,
	request model.UpdateSystemConfigRequest,
	operatorID int64,
) (model.SystemConfigDTO, *model.APIError) {
	if operatorID <= 0 {
		return model.SystemConfigDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}

	models, defaultModel, codeDefaultModel, searchService, apiError := service.validateAndNormalizeRequest(request)
	if apiError != nil {
		return model.SystemConfigDTO{}, apiError
	}

	updated, ok := service.repository.Upsert(model.SystemConfig{
		BaseEntity: model.BaseEntity{
			CreatedBy: operatorID,
			UpdatedBy: operatorID,
		},
		Models:           models,
		DefaultModel:     defaultModel,
		CodeDefaultModel: codeDefaultModel,
		SearchService:    searchService,
	})
	if !ok {
		return model.SystemConfigDTO{}, model.NewAPIError(500, response.CodeInternal, "更新系统配置失败")
	}
	return service.normalizeForRead(updated), nil
}

func (service *systemConfigService) defaultConfig() model.SystemConfigDTO {
	return model.SystemConfigDTO{
		Models: []model.SystemModelOption{
			{
				Name:    DefaultSystemModel,
				Label:   "GPT-4o mini",
				Enabled: true,
			},
		},
		DefaultModel:     DefaultSystemModel,
		CodeDefaultModel: DefaultSystemModel,
		SearchService:    DefaultSearchService,
	}
}

func (service *systemConfigService) normalizeForRead(config model.SystemConfigDTO) model.SystemConfigDTO {
	models := make([]model.SystemModelOption, 0, len(config.Models))
	for _, item := range config.Models {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		models = append(models, model.SystemModelOption{
			Name:    name,
			Label:   strings.TrimSpace(item.Label),
			Enabled: item.Enabled,
		})
	}
	if len(models) == 0 {
		return service.defaultConfig()
	}

	enabled := make(map[string]struct{})
	for _, item := range models {
		if item.Enabled {
			enabled[item.Name] = struct{}{}
		}
	}
	if len(enabled) == 0 {
		models[0].Enabled = true
		enabled[models[0].Name] = struct{}{}
	}

	defaultModel := strings.TrimSpace(config.DefaultModel)
	if _, ok := enabled[defaultModel]; !ok {
		for _, item := range models {
			if item.Enabled {
				defaultModel = item.Name
				break
			}
		}
	}
	codeDefaultModel := strings.TrimSpace(config.CodeDefaultModel)
	if _, ok := enabled[codeDefaultModel]; !ok {
		codeDefaultModel = defaultModel
	}

	return model.SystemConfigDTO{
		Models:           models,
		DefaultModel:     defaultModel,
		CodeDefaultModel: codeDefaultModel,
		SearchService:    normalizeSearchService(config.SearchService),
		UpdatedAt:        config.UpdatedAt,
	}
}

func (service *systemConfigService) validateAndNormalizeRequest(
	request model.UpdateSystemConfigRequest,
) ([]model.SystemModelOption, string, string, string, *model.APIError) {
	if len(request.Models) == 0 {
		return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "模型列表不能为空")
	}

	models := make([]model.SystemModelOption, 0, len(request.Models))
	seen := make(map[string]struct{})
	enabled := make(map[string]struct{})
	for _, raw := range request.Models {
		name := strings.TrimSpace(raw.Name)
		if name == "" {
			return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "模型名称不能为空")
		}
		if _, exists := seen[name]; exists {
			return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "模型名称不能重复："+name)
		}
		seen[name] = struct{}{}
		item := model.SystemModelOption{
			Name:    name,
			Label:   strings.TrimSpace(raw.Label),
			Enabled: raw.Enabled,
		}
		if item.Enabled {
			enabled[item.Name] = struct{}{}
		}
		models = append(models, item)
	}
	if len(enabled) == 0 {
		return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "至少需要启用一个模型")
	}

	defaultModel := strings.TrimSpace(request.DefaultModel)
	if defaultModel == "" {
		return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "defaultModel 不能为空")
	}
	if _, exists := enabled[defaultModel]; !exists {
		return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "defaultModel 必须是已启用模型")
	}
	codeDefaultModel := strings.TrimSpace(request.CodeDefaultModel)
	if codeDefaultModel == "" {
		codeDefaultModel = defaultModel
	}
	if _, exists := enabled[codeDefaultModel]; !exists {
		return nil, "", "", "", model.NewAPIError(400, response.CodeBadRequest, "codeDefaultModel 必须是已启用模型")
	}
	searchService := normalizeSearchService(request.SearchService)
	return models, defaultModel, codeDefaultModel, searchService, nil
}

func normalizeSearchService(raw string) string {
	if strings.EqualFold(strings.TrimSpace(raw), DefaultSearchService) {
		return DefaultSearchService
	}
	return DefaultSearchService
}
