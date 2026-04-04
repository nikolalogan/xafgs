package model

import "encoding/json"

type CreateWorkflowRequest struct {
	WorkflowKey          string          `json:"workflowKey"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	MenuKey              string          `json:"menuKey"`
	Status               string          `json:"status"`
	BreakerWindowMinutes int             `json:"breakerWindowMinutes"`
	BreakerMaxRequests   int             `json:"breakerMaxRequests"`
	DSL                  json.RawMessage `json:"dsl"`
}

type UpdateWorkflowRequest struct {
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	MenuKey              string          `json:"menuKey"`
	Status               string          `json:"status"`
	BreakerWindowMinutes int             `json:"breakerWindowMinutes"`
	BreakerMaxRequests   int             `json:"breakerMaxRequests"`
	DSL                  json.RawMessage `json:"dsl"`
}

type RollbackWorkflowRequest struct {
	VersionNo int `json:"versionNo"`
}
