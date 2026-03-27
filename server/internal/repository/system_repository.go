package repository

import "time"

type SystemRepository interface {
	ServiceName() string
	CurrentTime() time.Time
}

type systemRepository struct {
	serviceName string
}

func NewSystemRepository(serviceName string) SystemRepository {
	if serviceName == "" {
		serviceName = "sxfgssever-api"
	}
	return &systemRepository{
		serviceName: serviceName,
	}
}

func (repository *systemRepository) ServiceName() string {
	return repository.serviceName
}

func (repository *systemRepository) CurrentTime() time.Time {
	return time.Now()
}
