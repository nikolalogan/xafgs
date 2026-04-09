package workflowruntime

import "time"

type ExecutionStatus string

const (
	ExecutionStatusRunning      ExecutionStatus = "running"
	ExecutionStatusWaitingInput ExecutionStatus = "waiting_input"
	ExecutionStatusCompleted    ExecutionStatus = "completed"
	ExecutionStatusFailed       ExecutionStatus = "failed"
	ExecutionStatusCancelled    ExecutionStatus = "cancelled"
)

type NodeRunStatus string

const (
	NodeRunStatusPending      NodeRunStatus = "pending"
	NodeRunStatusRunning      NodeRunStatus = "running"
	NodeRunStatusWaitingInput NodeRunStatus = "waiting_input"
	NodeRunStatusSucceeded    NodeRunStatus = "succeeded"
	NodeRunStatusFailed       NodeRunStatus = "failed"
	NodeRunStatusSkipped      NodeRunStatus = "skipped"
)

type ExecutionNodeState struct {
	NodeID    string        `json:"nodeId"`
	Status    NodeRunStatus `json:"status"`
	StartedAt string        `json:"startedAt,omitempty"`
	EndedAt   string        `json:"endedAt,omitempty"`
	Error     string        `json:"error,omitempty"`
}

type ExecutionWaitingInput struct {
	NodeID    string         `json:"nodeId"`
	NodeTitle string         `json:"nodeTitle"`
	Schema    map[string]any `json:"schema"`
}

type LifecycleEvent struct {
	Type string `json:"type"`
}

type ExecutionEvent struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	At      string         `json:"at"`
	Payload map[string]any `json:"payload,omitempty"`
}

type WorkflowExecution struct {
	ID             string                        `json:"id"`
	WorkflowID     int64                         `json:"workflowId"`
	WorkflowName   string                        `json:"workflowName"`
	MenuKey        string                        `json:"menuKey"`
	StarterUserID  int64                         `json:"starterUserId"`
	WorkflowDSL    WorkflowDSL                   `json:"workflowDsl"`
	Status         ExecutionStatus               `json:"status"`
	NodeStates     map[string]ExecutionNodeState `json:"nodeStates"`
	Variables      map[string]any                `json:"variables"`
	Outputs        map[string]any                `json:"outputs,omitempty"`
	WaitingInput   *ExecutionWaitingInput        `json:"waitingInput,omitempty"`
	Error          string                        `json:"error,omitempty"`
	LifecycleEvents []LifecycleEvent             `json:"lifecycleEvents"`
	Events         []ExecutionEvent              `json:"events"`
	CreatedAt      string                        `json:"createdAt"`
	UpdatedAt      string                        `json:"updatedAt"`
}

type ExecutionListFilter struct {
	Status        string `json:"status"`
	WorkflowID    int64  `json:"workflowId"`
	MenuKey       string `json:"menuKey"`
	StarterUserID int64  `json:"starterUserId"`
	Keyword       string `json:"keyword"`
	Page          int64  `json:"page"`
	PageSize      int64  `json:"pageSize"`
}

type WorkflowExecutionSummary struct {
	ID            string          `json:"id"`
	WorkflowID    int64           `json:"workflowId"`
	WorkflowName  string          `json:"workflowName"`
	MenuKey       string          `json:"menuKey"`
	StarterUserID int64           `json:"starterUserId"`
	Status        ExecutionStatus `json:"status"`
	WaitingNodeID string          `json:"waitingNodeId,omitempty"`
	WaitingTitle  string          `json:"waitingNodeTitle,omitempty"`
	Error         string          `json:"error,omitempty"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
}

type ExecutionListResult struct {
	Items    []WorkflowExecutionSummary `json:"items"`
	Page     int64                      `json:"page"`
	PageSize int64                      `json:"pageSize"`
	Total    int64                      `json:"total"`
}

func NowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
