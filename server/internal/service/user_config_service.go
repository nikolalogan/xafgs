package service

import (
	"context"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type UserConfigService interface {
	GetByUserID(ctx context.Context, userID int64) (model.UserConfigDTO, *model.APIError)
	UpdateByUserID(ctx context.Context, userID int64, request model.UpdateUserConfigRequest, operatorID int64) (model.UserConfigDTO, *model.APIError)
}

type userConfigService struct {
	repository repository.UserConfigRepository
}

func NewUserConfigService(repository repository.UserConfigRepository) UserConfigService {
	return &userConfigService{
		repository: repository,
	}
}

func (service *userConfigService) GetByUserID(_ context.Context, userID int64) (model.UserConfigDTO, *model.APIError) {
	if userID <= 0 {
		return model.UserConfigDTO{}, model.NewAPIError(400, response.CodeBadRequest, "userId 不合法")
	}
	config, ok := service.repository.FindByUserID(userID)
	if ok {
		return config, nil
	}
	return model.UserConfigDTO{
		UserID:          userID,
		WarningAccount:  "",
		WarningPassword: "",
		AIBaseURL:       "",
		AIApiKey:        "",
	}, nil
}

func (service *userConfigService) UpdateByUserID(
	_ context.Context,
	userID int64,
	request model.UpdateUserConfigRequest,
	operatorID int64,
) (model.UserConfigDTO, *model.APIError) {
	if userID <= 0 {
		return model.UserConfigDTO{}, model.NewAPIError(400, response.CodeBadRequest, "userId 不合法")
	}
	if operatorID <= 0 {
		return model.UserConfigDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}

	request.WarningAccount = strings.TrimSpace(request.WarningAccount)
	request.WarningPassword = strings.TrimSpace(request.WarningPassword)
	request.AIBaseURL = strings.TrimSpace(request.AIBaseURL)
	request.AIApiKey = strings.TrimSpace(request.AIApiKey)

	updated, ok := service.repository.Upsert(model.UserConfig{
		BaseEntity: model.BaseEntity{
			UpdatedBy: operatorID,
			CreatedBy: operatorID,
		},
		UserID:          userID,
		WarningAccount:  request.WarningAccount,
		WarningPassword: request.WarningPassword,
		AIBaseURL:       request.AIBaseURL,
		AIApiKey:        request.AIApiKey,
	})
	if !ok {
		return model.UserConfigDTO{}, model.NewAPIError(500, response.CodeInternal, "更新用户配置失败")
	}
	return updated, nil
}

