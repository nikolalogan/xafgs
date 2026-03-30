package model

import "encoding/json"

type CreateWorkflowRequest struct {
	WorkflowKey string          `json:"workflowKey"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Status      string          `json:"status"`
	DSL         json.RawMessage `json:"dsl"`
}

type UpdateWorkflowRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Status      string          `json:"status"`
	DSL         json.RawMessage `json:"dsl"`
}

type RollbackWorkflowRequest struct {
	VersionNo int `json:"versionNo"`
}
