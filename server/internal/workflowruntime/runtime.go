package workflowruntime

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

type StartExecutionInput struct {
	WorkflowDSL WorkflowDSL       `json:"workflowDsl"`
	Input       map[string]any    `json:"input"`
}

type ResumeExecutionInput struct {
	ExecutionID string         `json:"executionId"`
	NodeID      string         `json:"nodeId"`
	Input       map[string]any `json:"input"`
}

type Runtime struct {
	store     ExecutionStorePort
	executors map[string]NodeExecutor
}

func NewRuntime(store ExecutionStorePort) *Runtime {
	return &Runtime{
		store:     store,
		executors: CreateExecutorRegistry(),
	}
}

func (runtime *Runtime) Start(ctx context.Context, input StartExecutionInput) (WorkflowExecution, error) {
	createdAt := NowISO()
	plan := BuildExecutionPlan(input.WorkflowDSL)
	nodeStates := map[string]ExecutionNodeState{}
	for _, nodeID := range plan {
		nodeStates[nodeID] = ExecutionNodeState{NodeID: nodeID, Status: NodeRunStatusPending}
	}

	variables := cloneMap(input.Input)
	if variables == nil {
		variables = map[string]any{}
	}
	applyDSLDefaults(variables, input.WorkflowDSL)

	execution := WorkflowExecution{
		ID:              uuid.NewString(),
		WorkflowDSL:     input.WorkflowDSL,
		Status:          ExecutionStatusRunning,
		NodeStates:      nodeStates,
		Variables:       variables,
		LifecycleEvents: []LifecycleEvent{{Type: "BEGIN"}},
		Events:          []ExecutionEvent{},
		CreatedAt:       createdAt,
		UpdatedAt:       createdAt,
	}
	runtime.log(ctx, map[string]any{
		"event":       "execution.started",
		"requestId":   requestIDFromContext(ctx),
		"executionId": execution.ID,
	})

	result := runtime.runUntilPauseOrEnd(ctx, execution, runOptions{})
	_ = runtime.store.Save(result)
	return result, nil
}

func applyDSLDefaults(target map[string]any, dsl WorkflowDSL) {
	if target == nil {
		return
	}

	ensureMap := func(key string) map[string]any {
		if existing, ok := target[key].(map[string]any); ok && existing != nil {
			return existing
		}
		next := map[string]any{}
		target[key] = next
		return next
	}

	workflow := ensureMap("workflow")
	for _, param := range dsl.WorkflowParameters {
		name := strings.TrimSpace(param.Name)
		if name == "" {
			continue
		}
		if _, exists := workflow[name]; exists {
			continue
		}
		workflow[name] = parseScalar(strings.TrimSpace(param.DefaultValue))
	}

	global := ensureMap("global")
	for _, variable := range dsl.GlobalVariables {
		name := strings.TrimSpace(variable.Name)
		if name == "" {
			continue
		}
		if _, exists := global[name]; exists {
			continue
		}
		global[name] = parseScalar(strings.TrimSpace(variable.DefaultValue))
	}

	if _, exists := global["timestamp"]; !exists {
		global["timestamp"] = float64(time.Now().Unix())
	}
}

func (runtime *Runtime) Resume(ctx context.Context, input ResumeExecutionInput) (WorkflowExecution, error) {
	execution, err := runtime.store.Get(input.ExecutionID)
	if err != nil {
		return WorkflowExecution{}, err
	}
	if execution == nil {
		return WorkflowExecution{}, errors.New("execution 不存在")
	}
	if execution.Status != ExecutionStatusWaitingInput {
		return WorkflowExecution{}, errors.New("execution 当前不处于 waiting_input")
	}
	if execution.WaitingInput == nil || execution.WaitingInput.NodeID != input.NodeID {
		return WorkflowExecution{}, errors.New("resume 节点不匹配")
	}

	resumeInput := cloneMap(input.Input)
	if resumeInput == nil {
		resumeInput = map[string]any{}
	}

	if node, ok := findNodeByID(execution.WorkflowDSL.Nodes, input.NodeID); ok {
		if node.Data.Type == "input" {
			fields := ParseInputFields(node.Data.Config)
			normalized, validateErr := ValidateAndNormalizeDynamicInput(fields, resumeInput)
			if validateErr != nil {
				runtime.log(ctx, map[string]any{
					"event":       "node.input_invalid",
					"requestId":   requestIDFromContext(ctx),
					"executionId": execution.ID,
					"nodeId":      input.NodeID,
					"error":       validateErr.Error(),
				})
				return WorkflowExecution{}, validateErr
			}
			resumeInput = normalized
		}
	}

	next := *execution
	next.WaitingInput = nil
	next.LifecycleEvents = append(next.LifecycleEvents, LifecycleEvent{Type: "RESUME"})
	next.Status = StatusFromLifecycleEvents(next.LifecycleEvents)
	next.UpdatedAt = NowISO()
	next.Events = append(next.Events, ExecutionEvent{
		ID:   uuid.NewString(),
		Type: "execution.resumed",
		At:   NowISO(),
		Payload: map[string]any{
			"nodeId": input.NodeID,
		},
	})
	runtime.log(ctx, map[string]any{
		"event":       "execution.resumed",
		"requestId":   requestIDFromContext(ctx),
		"executionId": next.ID,
		"nodeId":      input.NodeID,
	})

	result := runtime.runUntilPauseOrEnd(ctx, next, runOptions{
		ResumedNodeID: input.NodeID,
		ResumedInput:  resumeInput,
	})
	_ = runtime.store.Save(result)
	return result, nil
}

func (runtime *Runtime) Get(_ context.Context, executionID string) (*WorkflowExecution, error) {
	return runtime.store.Get(executionID)
}

func (runtime *Runtime) Cancel(_ context.Context, executionID string) (WorkflowExecution, error) {
	execution, err := runtime.store.Get(executionID)
	if err != nil {
		return WorkflowExecution{}, err
	}
	if execution == nil {
		return WorkflowExecution{}, errors.New("execution 不存在")
	}

	cancelled := *execution
	cancelled.LifecycleEvents = append(cancelled.LifecycleEvents, LifecycleEvent{Type: "CANCEL"})
	cancelled.Status = ExecutionStatusCancelled
	cancelled.UpdatedAt = NowISO()
	cancelled.Events = append(cancelled.Events, ExecutionEvent{
		ID:   uuid.NewString(),
		Type: "execution.cancelled",
		At:   NowISO(),
	})
	runtime.log(context.Background(), map[string]any{
		"event":       "execution.cancelled",
		"executionId": cancelled.ID,
	})
	_ = runtime.store.Save(cancelled)
	return cancelled, nil
}

type runOptions struct {
	ResumedNodeID string
	ResumedInput  map[string]any
}

func (runtime *Runtime) runUntilPauseOrEnd(ctx context.Context, execution WorkflowExecution, options runOptions) WorkflowExecution {
	nodeMap := map[string]WorkflowNode{}
	for _, node := range execution.WorkflowDSL.Nodes {
		nodeMap[node.ID] = node
	}

	outgoingEdgesMap := map[string][]WorkflowEdge{}
	for _, edge := range execution.WorkflowDSL.Edges {
		outgoingEdgesMap[edge.Source] = append(outgoingEdgesMap[edge.Source], edge)
	}

	incomingSourcesMap := map[string]map[string]bool{}
	for _, edge := range execution.WorkflowDSL.Edges {
		if strings.TrimSpace(edge.Source) == "" || strings.TrimSpace(edge.Target) == "" {
			continue
		}
		set := incomingSourcesMap[edge.Target]
		if set == nil {
			set = map[string]bool{}
			incomingSourcesMap[edge.Target] = set
		}
		set[edge.Source] = true
	}

	plan := BuildExecutionPlan(execution.WorkflowDSL)
	maxSteps := int(math.Max(float64(len(plan)*8), 32))

	next := execution
	next.NodeStates = cloneNodeStates(execution.NodeStates)
	next.Variables = cloneMap(execution.Variables)
	next.Events = append([]ExecutionEvent{}, execution.Events...)
	next.UpdatedAt = NowISO()

	queue := []string{}
	pushed := map[string]bool{}
	arrivedSources := map[string]map[string]bool{}

	markArrived := func(targetID string, sourceID string) {
		set := arrivedSources[targetID]
		if set == nil {
			set = map[string]bool{}
			arrivedSources[targetID] = set
		}
		set[sourceID] = true
	}

	enqueue := func(nodeID string) {
		if strings.TrimSpace(nodeID) == "" || pushed[nodeID] {
			return
		}
		node, ok := nodeMap[nodeID]
		if !ok {
			return
		}
		if shouldWaitAllIncoming(node) {
			expected := incomingSourcesMap[nodeID]
			if len(expected) > 0 {
				arrived := arrivedSources[nodeID]
				if len(arrived) < len(expected) {
					return
				}
			}
		}
		queue = append(queue, nodeID)
		pushed[nodeID] = true
	}

	if options.ResumedNodeID != "" {
		enqueue(options.ResumedNodeID)
	} else {
		enqueue(getStartNodeID(execution.WorkflowDSL.Nodes))
	}

	stepCount := 0
	for len(queue) > 0 {
		stepCount++
		if stepCount > maxSteps {
			return runtime.failExecution(next, "检测到可能的循环执行，请检查流程连线")
		}
		if ctx.Err() != nil {
			return runtime.failExecution(next, "执行被取消")
		}

		nodeID := queue[0]
		queue = queue[1:]
		node, ok := nodeMap[nodeID]
		if !ok {
			continue
		}

		state := next.NodeStates[nodeID]
		if state.Status == NodeRunStatusSucceeded || state.Status == NodeRunStatusSkipped {
			continue
		}

		executor := runtime.executors[node.Data.Type]
		if executor == nil {
			executor = runtime.executors["start"]
		}

		if state.StartedAt == "" {
			state.StartedAt = NowISO()
		}
		state.Status = NodeRunStatusRunning
		next.NodeStates[nodeID] = state

		if options.ResumedNodeID == nodeID {
			next.Events = append(next.Events, ExecutionEvent{
				ID:   uuid.NewString(),
				Type: "node.resumed",
				At:   NowISO(),
				Payload: map[string]any{
					"nodeId": nodeID,
				},
			})
			runtime.log(ctx, map[string]any{
				"event":       "node.resumed",
				"requestId":   requestIDFromContext(ctx),
				"executionId": next.ID,
				"nodeId":      nodeID,
			})
		}

		next.Events = append(next.Events, ExecutionEvent{
			ID:   uuid.NewString(),
			Type: "node.started",
			At:   NowISO(),
			Payload: map[string]any{
				"nodeId": nodeID,
			},
		})
		runtime.log(ctx, map[string]any{
			"event":       "node.started",
			"requestId":   requestIDFromContext(ctx),
			"executionId": next.ID,
			"nodeId":      nodeID,
			"nodeType":    node.Data.Type,
		})

		var nodeInput map[string]any
		if options.ResumedNodeID == nodeID {
			nodeInput = options.ResumedInput
		}

		result, _ := executor.Execute(ctx, NodeExecutorContext{
			Node:      node,
			Variables: next.Variables,
			NodeInput: nodeInput,
		})

		switch result.Type {
			case NodeExecutorResultWaitingInput:
				waitingState := next.NodeStates[nodeID]
				waitingState.Status = NodeRunStatusWaitingInput
				next.NodeStates[nodeID] = waitingState
			next.WaitingInput = &ExecutionWaitingInput{
				NodeID:    nodeID,
				NodeTitle: node.Data.Title,
				Schema:    result.Schema,
			}
			next.LifecycleEvents = append(next.LifecycleEvents, LifecycleEvent{Type: "WAIT_INPUT"})
			next.Status = StatusFromLifecycleEvents(next.LifecycleEvents)
			next.UpdatedAt = NowISO()
				next.Events = append(next.Events, ExecutionEvent{
					ID:   uuid.NewString(),
					Type: "node.waiting_input",
					At:   NowISO(),
					Payload: map[string]any{
						"nodeId": nodeID,
					},
				})
				runtime.log(ctx, map[string]any{
					"event":       "node.waiting_input",
					"requestId":   requestIDFromContext(ctx),
					"executionId": next.ID,
					"nodeId":      nodeID,
				})
				return next

			case NodeExecutorResultBranch:
			succeededState := next.NodeStates[nodeID]
			succeededState.Status = NodeRunStatusSucceeded
			succeededState.EndedAt = NowISO()
			next.NodeStates[nodeID] = succeededState
			next.Variables[nodeID] = defaultMap(result.Output)
				next.Events = append(next.Events, ExecutionEvent{
				ID:   uuid.NewString(),
				Type: "node.branch",
				At:   NowISO(),
				Payload: map[string]any{
					"nodeId":      nodeID,
					"handleId":    result.HandleID,
					"branchName":  result.BranchName,
				},
				})
				runtime.log(ctx, map[string]any{
					"event":       "node.branch",
					"requestId":   requestIDFromContext(ctx),
					"executionId": next.ID,
					"nodeId":      nodeID,
					"handleId":    result.HandleID,
					"branchName":  result.BranchName,
				})
			outgoing := outgoingEdgesMap[nodeID]
			for _, edge := range selectIfElseNextEdges(outgoing, result.HandleID) {
				markArrived(edge.Target, nodeID)
				enqueue(edge.Target)
			}
			continue

			case NodeExecutorResultFailed:
			failedState := next.NodeStates[nodeID]
			failedState.Status = NodeRunStatusFailed
			failedState.EndedAt = NowISO()
			failedState.Error = result.Error
			next.NodeStates[nodeID] = failedState
			next.Error = result.Error
			next.LifecycleEvents = append(next.LifecycleEvents, LifecycleEvent{Type: "FAIL"})
			next.Status = StatusFromLifecycleEvents(next.LifecycleEvents)
			next.UpdatedAt = NowISO()
				next.Events = append(next.Events, ExecutionEvent{
				ID:   uuid.NewString(),
				Type: "node.failed",
				At:   NowISO(),
				Payload: map[string]any{
					"nodeId": nodeID,
					"error":  result.Error,
				},
				})
				runtime.log(ctx, map[string]any{
					"event":       "node.failed",
					"requestId":   requestIDFromContext(ctx),
					"executionId": next.ID,
					"nodeId":      nodeID,
					"error":       result.Error,
					"durationMs":  nodeDurationMs(state.StartedAt, failedState.EndedAt),
				})
				return next

			default:
			succeededState := next.NodeStates[nodeID]
			succeededState.Status = NodeRunStatusSucceeded
			succeededState.EndedAt = NowISO()
			next.NodeStates[nodeID] = succeededState
			output := defaultMap(result.Output)
			next.Variables[nodeID] = output
			for _, mapping := range result.Writebacks {
				if strings.TrimSpace(mapping.TargetPath) == "" {
					continue
				}
				setByPath(next.Variables, mapping.TargetPath, mapping.Value)
			}
				next.Events = append(next.Events, ExecutionEvent{
				ID:   uuid.NewString(),
				Type: "node.succeeded",
				At:   NowISO(),
				Payload: map[string]any{
					"nodeId": nodeID,
				},
				})
				runtime.log(ctx, map[string]any{
					"event":       "node.succeeded",
					"requestId":   requestIDFromContext(ctx),
					"executionId": next.ID,
					"nodeId":      nodeID,
					"durationMs":  nodeDurationMs(state.StartedAt, succeededState.EndedAt),
				})
			for _, edge := range outgoingEdgesMap[nodeID] {
				markArrived(edge.Target, nodeID)
				enqueue(edge.Target)
			}
		}
	}

	for nodeID, state := range next.NodeStates {
		if state.Status == NodeRunStatusPending {
			state.Status = NodeRunStatusSkipped
			next.NodeStates[nodeID] = state
			next.Events = append(next.Events, ExecutionEvent{
				ID:   uuid.NewString(),
				Type: "node.skipped",
				At:   NowISO(),
				Payload: map[string]any{
					"nodeId": nodeID,
				},
			})
			runtime.log(ctx, map[string]any{
				"event":       "node.skipped",
				"requestId":   requestIDFromContext(ctx),
				"executionId": next.ID,
				"nodeId":      nodeID,
			})
		}
	}

	next.Outputs = cloneMap(next.Variables)
	next.LifecycleEvents = append(next.LifecycleEvents, LifecycleEvent{Type: "COMPLETE"})
	next.Status = StatusFromLifecycleEvents(next.LifecycleEvents)
	next.UpdatedAt = NowISO()
	next.Events = append(next.Events, ExecutionEvent{
		ID:   uuid.NewString(),
		Type: "execution.completed",
		At:   NowISO(),
	})
	runtime.log(ctx, map[string]any{
		"event":       "execution.completed",
		"requestId":   requestIDFromContext(ctx),
		"executionId": next.ID,
	})

	return next
}

func (runtime *Runtime) failExecution(execution WorkflowExecution, message string) WorkflowExecution {
	next := execution
	next.LifecycleEvents = append(next.LifecycleEvents, LifecycleEvent{Type: "FAIL"})
	next.Status = StatusFromLifecycleEvents(next.LifecycleEvents)
	next.Error = message
	next.UpdatedAt = NowISO()
	next.Events = append(next.Events, ExecutionEvent{
		ID:   uuid.NewString(),
		Type: "execution.failed",
		At:   NowISO(),
		Payload: map[string]any{
			"error": message,
		},
	})
	runtime.log(context.Background(), map[string]any{
		"event":       "execution.failed",
		"executionId": next.ID,
		"error":       message,
	})
	return next
}

func cloneNodeStates(source map[string]ExecutionNodeState) map[string]ExecutionNodeState {
	out := make(map[string]ExecutionNodeState, len(source))
	for k, v := range source {
		out[k] = v
	}
	return out
}

func shouldWaitAllIncoming(node WorkflowNode) bool {
	cfg := node.Data.Config
	if cfg == nil {
		return false
	}
	mode, _ := cfg["joinMode"].(string)
	joinAll, _ := cfg["joinAll"].(bool)
	return joinAll || mode == "all" || mode == "wait_all"
}

func getStartNodeID(nodes []WorkflowNode) string {
	for _, node := range nodes {
		if node.Data.Type == "start" {
			return node.ID
		}
	}
	if len(nodes) > 0 {
		return nodes[0].ID
	}
	return ""
}

func selectIfElseNextEdges(edges []WorkflowEdge, handleID string) []WorkflowEdge {
	matched := make([]WorkflowEdge, 0)
	for _, edge := range edges {
		if edge.SourceHandle == handleID {
			matched = append(matched, edge)
		}
	}
	if len(matched) > 0 {
		return matched
	}
	if len(edges) > 0 {
		return edges[:1]
	}
	return nil
}

func defaultMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func (runtime *Runtime) log(ctx context.Context, payload map[string]any) {
	if payload == nil {
		return
	}
	if _, ok := payload["requestId"]; !ok {
		payload["requestId"] = requestIDFromContext(ctx)
	}
	writeWorkflowLog(payload)
}

func findNodeByID(nodes []WorkflowNode, nodeID string) (WorkflowNode, bool) {
	for _, node := range nodes {
		if node.ID == nodeID {
			return node, true
		}
	}
	return WorkflowNode{}, false
}

func nodeDurationMs(startedAt string, endedAt string) int64 {
	startTime, startErr := time.Parse(time.RFC3339, startedAt)
	endTime, endErr := time.Parse(time.RFC3339, endedAt)
	if startErr != nil || endErr != nil {
		return 0
	}
	return endTime.Sub(startTime).Milliseconds()
}
