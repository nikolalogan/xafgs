package repository

import (
	"time"

	"sxfgssever/server/internal/model"
)

type UserConfigRepository interface {
	FindByUserID(userID int64) (model.UserConfigDTO, bool)
	Upsert(config model.UserConfig) (model.UserConfigDTO, bool)
}

type userConfigRepository struct {
	configs map[int64]model.UserConfig
}

func NewUserConfigRepository() UserConfigRepository {
	return &userConfigRepository{
		configs: map[int64]model.UserConfig{},
	}
}

func (repository *userConfigRepository) FindByUserID(userID int64) (model.UserConfigDTO, bool) {
	entity, ok := repository.configs[userID]
	if !ok {
		return model.UserConfigDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *userConfigRepository) Upsert(config model.UserConfig) (model.UserConfigDTO, bool) {
	now := time.Now().UTC()
	existing, ok := repository.configs[config.UserID]
	if !ok {
		config.CreatedAt = now
		config.UpdatedAt = now
		repository.configs[config.UserID] = config
		return config.ToDTO(), true
	}

	existing.WarningAccount = config.WarningAccount
	existing.WarningPassword = config.WarningPassword
	existing.AIBaseURL = config.AIBaseURL
	existing.AIApiKey = config.AIApiKey
	existing.UpdatedAt = now
	existing.UpdatedBy = config.UpdatedBy
	repository.configs[config.UserID] = existing
	return existing.ToDTO(), true
}
