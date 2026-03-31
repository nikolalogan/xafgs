package model

import "encoding/json"

type CreateTemplateRequest struct {
	TemplateKey        string          `json:"templateKey"`
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	Engine             string          `json:"engine"`
	OutputType         string          `json:"outputType"`
	Status             string          `json:"status"`
	Content            string          `json:"content"`
	DefaultContextJSON json.RawMessage `json:"defaultContextJson"`
}

type UpdateTemplateRequest struct {
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	OutputType         string          `json:"outputType"`
	Status             string          `json:"status"`
	Content            string          `json:"content"`
	DefaultContextJSON json.RawMessage `json:"defaultContextJson"`
}

type PreviewTemplateRequest struct {
	Content     string          `json:"content"`
	ContextJSON json.RawMessage `json:"contextJson"`
}

type PreviewTemplateResponse struct {
	Rendered string `json:"rendered"`
}

