package model

import (
	"encoding/json"
	"time"
)

const (
	TemplateStatusActive   = "active"
	TemplateStatusDisabled = "disabled"
)

const (
	TemplateEngineJinja2 = "jinja2"
)

const (
	TemplateOutputTypeText = "text"
	TemplateOutputTypeHTML = "html"
)

func IsValidTemplateStatus(status string) bool {
	return status == TemplateStatusActive || status == TemplateStatusDisabled
}

func IsValidTemplateEngine(engine string) bool {
	return engine == TemplateEngineJinja2
}

func IsValidTemplateOutputType(outputType string) bool {
	return outputType == TemplateOutputTypeText || outputType == TemplateOutputTypeHTML
}

type Template struct {
	BaseEntity
	TemplateKey         string          `json:"templateKey"`
	Name                string          `json:"name"`
	Description         string          `json:"description"`
	Engine              string          `json:"engine"`
	OutputType          string          `json:"outputType"`
	Status              string          `json:"status"`
	Content             string          `json:"content"`
	DefaultContextJSON  json.RawMessage `json:"defaultContextJson,omitempty"`
}

type TemplateDTO struct {
	ID          int64     `json:"id"`
	TemplateKey string    `json:"templateKey"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Engine      string    `json:"engine"`
	OutputType  string    `json:"outputType"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type TemplateDetailDTO struct {
	TemplateDTO
	Content            string          `json:"content"`
	DefaultContextJSON json.RawMessage `json:"defaultContextJson"`
}

func (template Template) ToDTO() TemplateDTO {
	return TemplateDTO{
		ID:          template.ID,
		TemplateKey: template.TemplateKey,
		Name:        template.Name,
		Description: template.Description,
		Engine:      template.Engine,
		OutputType:  template.OutputType,
		Status:      template.Status,
		CreatedAt:   template.CreatedAt,
		UpdatedAt:   template.UpdatedAt,
	}
}

func (template Template) ToDetailDTO() TemplateDetailDTO {
	return TemplateDetailDTO{
		TemplateDTO:         template.ToDTO(),
		Content:             template.Content,
		DefaultContextJSON:  template.DefaultContextJSON,
	}
}

