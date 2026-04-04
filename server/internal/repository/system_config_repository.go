package repository

import (
	"sync"
	"time"

	"sxfgssever/server/internal/model"
)

type SystemConfigRepository interface {
	Get() (model.SystemConfigDTO, bool)
	Upsert(config model.SystemConfig) (model.SystemConfigDTO, bool)
}

type systemConfigRepository struct {
	mu     sync.Mutex
	config *model.SystemConfig
}

func NewSystemConfigRepository() SystemConfigRepository {
	return &systemConfigRepository{}
}

func (repository *systemConfigRepository) Get() (model.SystemConfigDTO, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	if repository.config == nil {
		return model.SystemConfigDTO{}, false
	}
	return repository.config.ToDTO(), true
}

func (repository *systemConfigRepository) Upsert(config model.SystemConfig) (model.SystemConfigDTO, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	now := time.Now().UTC()
	if repository.config == nil {
		if config.CreatedAt.IsZero() {
			config.CreatedAt = now
		}
		if config.UpdatedAt.IsZero() {
			config.UpdatedAt = now
		}
		config.ID = 1
		stored := config
		repository.config = &stored
		return repository.config.ToDTO(), true
	}

	existing := *repository.config
	existing.Models = append([]model.SystemModelOption{}, config.Models...)
	existing.DefaultModel = config.DefaultModel
	existing.CodeDefaultModel = config.CodeDefaultModel
	existing.SearchService = config.SearchService
	existing.UpdatedAt = now
	existing.UpdatedBy = config.UpdatedBy
	repository.config = &existing
	return repository.config.ToDTO(), true
}
