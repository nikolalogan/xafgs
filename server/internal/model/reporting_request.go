package model

import "encoding/json"

type CreateReportTemplateRequest struct {
	TemplateKey          string          `json:"templateKey"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
}

type UpdateReportTemplateRequest struct {
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
}

type CreateReportCaseRequest struct {
	TemplateID  int64  `json:"templateId"`
	Name        string `json:"name"`
	SubjectID   int64  `json:"subjectId"`
	SubjectName string `json:"subjectName"`
}

type AttachReportCaseFileRequest struct {
	FileID          int64  `json:"fileId"`
	ManualCategory  string `json:"manualCategory"`
}

type ProcessReportCaseRequest struct {
	Force bool `json:"force"`
}

type ReviewReportCaseDecision struct {
	CaseFileID        int64  `json:"caseFileId"`
	Decision          string `json:"decision"`
	FinalSubCategory  string `json:"finalSubCategory"`
}

type ReviewReportCaseRequest struct {
	Decisions []ReviewReportCaseDecision `json:"decisions"`
}
