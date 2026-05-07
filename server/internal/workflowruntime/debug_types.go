package workflowruntime

type DebugSessionStatus string

const (
	DebugSessionStatusReady           DebugSessionStatus = "ready"
	DebugSessionStatusWaitingInput    DebugSessionStatus = "waiting_input"
	DebugSessionStatusTargetSucceeded DebugSessionStatus = "target_succeeded"
	DebugSessionStatusFailed          DebugSessionStatus = "failed"
)

type DebugSessionMode string

const (
	DebugSessionModeDependencyChain DebugSessionMode = "dependency_chain"
	DebugSessionModeNodeOnly        DebugSessionMode = "node_only"
)

type WorkflowDebugSession struct {
	ID                         string                        `json:"id"`
	WorkflowID                 int64                         `json:"workflowId"`
	CreatorUserID              int64                         `json:"-"`
	TargetNodeID               string                        `json:"targetNodeId"`
	Mode                       DebugSessionMode              `json:"mode"`
	Status                     DebugSessionStatus            `json:"status"`
	WorkflowDSL                WorkflowDSL                   `json:"workflowDsl"`
	WorkflowParametersSnapshot []WorkflowParameter           `json:"workflowParametersSnapshot"`
	DebugVariables             map[string]any                `json:"debugVariables,omitempty"`
	Variables                  map[string]any                `json:"variables"`
	NodeStates                 map[string]ExecutionNodeState `json:"nodeStates"`
	WaitingInput               *ExecutionWaitingInput        `json:"waitingInput,omitempty"`
	LastTargetInput            map[string]any                `json:"lastTargetInput,omitempty"`
	LastTargetOutput           map[string]any                `json:"lastTargetOutput,omitempty"`
	LastWritebacks             []Writeback                   `json:"lastWritebacks,omitempty"`
	Error                      string                        `json:"error,omitempty"`
	CreatedAt                  string                        `json:"createdAt"`
	UpdatedAt                  string                        `json:"updatedAt"`
}

type ExecuteDebugNodeOnceInput struct {
	WorkflowID     int64
	WorkflowDSL    WorkflowDSL
	TargetNodeID   string
	StartInput     map[string]any
	DebugVariables map[string]any
	NodeInput      map[string]any
}

type ExecuteDebugNodeOnceResult struct {
	NodeInput             map[string]any `json:"nodeInput"`
	NodeOutput            map[string]any `json:"nodeOutput,omitempty"`
	Writebacks            []Writeback    `json:"writebacks,omitempty"`
	Error                 string         `json:"error,omitempty"`
	UpdatedDebugVariables map[string]any `json:"updatedDebugVariables"`
}
