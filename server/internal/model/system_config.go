package model

import "time"

type SystemModelOption struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
}

type SystemConfig struct {
	BaseEntity
	Models           []SystemModelOption `json:"models"`
	DefaultModel     string              `json:"defaultModel"`
	CodeDefaultModel string              `json:"codeDefaultModel"`
	SearchService    string              `json:"searchService"`
}

type SystemConfigDTO struct {
	Models           []SystemModelOption `json:"models"`
	DefaultModel     string              `json:"defaultModel"`
	CodeDefaultModel string              `json:"codeDefaultModel"`
	SearchService    string              `json:"searchService"`
	UpdatedAt        time.Time           `json:"updatedAt"`
}

type UpdateSystemConfigRequest struct {
	Models           []SystemModelOption `json:"models"`
	DefaultModel     string              `json:"defaultModel"`
	CodeDefaultModel string              `json:"codeDefaultModel"`
	SearchService    string              `json:"searchService"`
}

func (config SystemConfig) ToDTO() SystemConfigDTO {
	models := make([]SystemModelOption, 0, len(config.Models))
	models = append(models, config.Models...)
	return SystemConfigDTO{
		Models:           models,
		DefaultModel:     config.DefaultModel,
		CodeDefaultModel: config.CodeDefaultModel,
		SearchService:    config.SearchService,
		UpdatedAt:        config.UpdatedAt,
	}
}
