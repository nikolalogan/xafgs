package service

import (
	"context"
	"time"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
)

type SystemService interface {
	GetHealth(ctx context.Context) model.HealthDTO
}

type systemService struct {
	systemRepository repository.SystemRepository
}

func NewSystemService(systemRepository repository.SystemRepository) SystemService {
	return &systemService{
		systemRepository: systemRepository,
	}
}

func (service *systemService) GetHealth(_ context.Context) model.HealthDTO {
	return model.HealthDTO{
		Status:    model.HealthStatusOK,
		Service:   service.systemRepository.ServiceName(),
		Timestamp: service.systemRepository.CurrentTime().Format(time.RFC3339),
	}
}
