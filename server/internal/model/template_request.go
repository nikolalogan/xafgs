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
	TemplateType       string          `json:"templateType"`
	PreprocessJS       string          `json:"preprocessJs"`
}

type UpdateTemplateRequest struct {
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	OutputType         string          `json:"outputType"`
	Status             string          `json:"status"`
	Content            string          `json:"content"`
	DefaultContextJSON json.RawMessage `json:"defaultContextJson"`
	TemplateType       string          `json:"templateType"`
	PreprocessJS       string          `json:"preprocessJs"`
}

type PreviewTemplateRequest struct {
	Content      string          `json:"content"`
	ContextJSON  json.RawMessage `json:"contextJson"`
	TemplateType string          `json:"templateType"`
}

type PreviewTemplateResponse struct {
	PreviewType  string          `json:"previewType"`
	Rendered     string          `json:"rendered"`
	TablePayload json.RawMessage `json:"tablePayload,omitempty"`
}

