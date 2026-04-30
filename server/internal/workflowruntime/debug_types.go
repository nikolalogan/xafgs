package workflowruntime

type DebugSessionStatus string

const (
	DebugSessionStatusReady           DebugSessionStatus = "ready"
	DebugSessionStatusWaitingInput    DebugSessionStatus = "waiting_input"
	DebugSessionStatusTargetSucceeded DebugSessionStatus = "target_succeeded"
	DebugSessionStatusFailed          DebugSessionStatus = "failed"
)

type WorkflowDebugSession struct {
	ID               string                        `json:"id"`
	WorkflowID       int64                         `json:"workflowId"`
	CreatorUserID    int64                         `json:"-"`
	TargetNodeID     string                        `json:"targetNodeId"`
	Status           DebugSessionStatus            `json:"status"`
	WorkflowDSL      WorkflowDSL                   `json:"workflowDsl"`
	Variables        map[string]any                `json:"variables"`
	NodeStates       map[string]ExecutionNodeState `json:"nodeStates"`
	WaitingInput     *ExecutionWaitingInput        `json:"waitingInput,omitempty"`
	LastTargetInput  map[string]any                `json:"lastTargetInput,omitempty"`
	LastTargetOutput map[string]any                `json:"lastTargetOutput,omitempty"`
	LastWritebacks   []Writeback                   `json:"lastWritebacks,omitempty"`
	Error            string                        `json:"error,omitempty"`
	CreatedAt        string                        `json:"createdAt"`
	UpdatedAt        string                        `json:"updatedAt"`
}

