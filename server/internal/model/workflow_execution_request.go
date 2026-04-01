package model

type ResumeWorkflowExecutionRequest struct {
	NodeID string         `json:"nodeId"`
	Input  map[string]any `json:"input"`
}

