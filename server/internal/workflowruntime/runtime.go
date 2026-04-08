package workflowruntime

import (
	"context"
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"sxfgssever/server/internal/ai"
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
	aiClient  ai.ChatCompletionClient
	executors map[string]NodeExecutor
}

type RuntimeOption func(*Runtime)

func WithAIClient(client ai.ChatCompletionClient) RuntimeOption {
	return func(runtime *Runtime) {
		runtime.aiClient = client
	}
}

func NewRuntime(store ExecutionStorePort, options ...RuntimeOption) *Runtime {
	runtime := &Runtime{store: store}
	for _, option := range options {
		if option == nil {
			continue
		}
		option(runtime)
	}
	runtime.executors = CreateExecutorRegistry(runtime.aiClient)
	return runtime
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
	ensureReservedVariableRoots(variables, input.WorkflowDSL)

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

func ensureReservedVariableRoots(target map[string]any, dsl WorkflowDSL) {
	if target == nil {
		return
	}

	ensureMapKey := func(key string) map[string]any {
		if existing, ok := target[key].(map[string]any); ok && existing != nil {
			return existing
		}
		next := map[string]any{}
		target[key] = next
		return next
	}

	// 防御：运行时变量可能被节点输出或 writeback 误覆盖为非对象，导致 {{workflow.xxx}} 等占位符解析失败
	_ = ensureMapKey("workflow")
	_ = ensureMapKey("global")
	_ = ensureMapKey("user")

	// 重新回填 DSL 默认值（不会覆盖已有非空值）
	applyDSLDefaults(target, dsl)
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
		if existing, exists := workflow[name]; exists && hasValue(existing) {
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
		if existing, exists := global[name]; exists && hasValue(existing) {
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
	ensureReservedVariableRoots(next.Variables, next.WorkflowDSL)
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

	// resume 场景下，执行会分段进入 runUntilPauseOrEnd。为保证 joinMode=all 正确汇聚，
	// 需要基于历史成功节点恢复“已到达上游”状态，否则会丢失暂停前的到达信息。
	seedArrivedFromHistory := func() {
		// 仅 if-else 需要根据历史分支事件挑选实际经过的出边；
		// 普通节点成功后其所有出边都已尝试入队，视为已到达。
		branchHandleByNode := map[string]string{}
		for _, event := range next.Events {
			if event.Type != "node.branch" || event.Payload == nil {
				continue
			}
			nodeID, _ := event.Payload["nodeId"].(string)
			handleID, _ := event.Payload["handleId"].(string)
			nodeID = strings.TrimSpace(nodeID)
			handleID = strings.TrimSpace(handleID)
			if nodeID == "" || handleID == "" {
				continue
			}
			branchHandleByNode[nodeID] = handleID
		}

		for nodeID, state := range next.NodeStates {
			if state.Status != NodeRunStatusSucceeded {
				continue
			}
			outgoing := outgoingEdgesMap[nodeID]
			if len(outgoing) == 0 {
				continue
			}
			node, ok := nodeMap[nodeID]
			if !ok {
				continue
			}
			if node.Data.Type == "if-else" {
				handleID := branchHandleByNode[nodeID]
				if strings.TrimSpace(handleID) == "" {
					// 未记录分支事件时不做推断，避免误标记未命中分支为 arrived。
					continue
				}
				for _, edge := range selectIfElseNextEdges(outgoing, handleID) {
					markArrived(edge.Target, nodeID)
				}
				continue
			}
			for _, edge := range outgoing {
				markArrived(edge.Target, nodeID)
			}
		}
	}
	seedArrivedFromHistory()

	enqueue := func(nodeID string) {
		if strings.TrimSpace(nodeID) == "" || pushed[nodeID] {
			return
		}
		node, ok := nodeMap[nodeID]
		if !ok {
			return
		}
		if shouldWaitAllIncoming(node, len(incomingSourcesMap[nodeID])) {
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
		// resume 的节点此前已进入 waiting_input：此处应强制入队，避免多入边 join 策略阻塞 resume
		queue = append(queue, options.ResumedNodeID)
		pushed[options.ResumedNodeID] = true
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

		// 防御：确保保留根对象结构与默认值存在，避免 HTTP 节点渲染 {{workflow.xxx}} 时丢参
		ensureReservedVariableRoots(next.Variables, next.WorkflowDSL)

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
				nextEdges := orderFanOutEdges(node, selectIfElseNextEdges(outgoing, result.HandleID), nodeMap)
				for _, edge := range nextEdges {
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
					targetPath := strings.TrimSpace(mapping.TargetPath)
					if targetPath == "" {
						continue
					}
				// 保护：避免 writeback 覆盖保留根对象，导致后续变量解析失败
				// 仅允许写入 workflow.xxx / global.xxx / user.xxx
					if targetPath == "workflow" || targetPath == "global" || targetPath == "user" {
					runtime.log(ctx, map[string]any{
						"event":       "writeback.blocked",
						"requestId":   requestIDFromContext(ctx),
						"executionId": next.ID,
						"nodeId":      nodeID,
						"targetPath":  targetPath,
					})
						continue
					}
					if strings.HasSuffix(targetPath, "[]") {
						if incoming, ok := mapping.Value.([]any); ok {
							appendPath := strings.TrimSuffix(targetPath, "[]")
							appendPath = strings.TrimSuffix(appendPath, ".")
							existing, found := getByPath(next.Variables, appendPath)
							switch typed := existing.(type) {
							case []any:
								combined := make([]any, 0, len(typed)+len(incoming))
								combined = append(combined, typed...)
								combined = append(combined, incoming...)
								setByPath(next.Variables, appendPath, combined)
							default:
								if found {
									// 已有值但不是数组：按覆盖新数组处理，避免类型冲突造成 append 失败。
									setByPath(next.Variables, appendPath, incoming)
								} else {
									setByPath(next.Variables, appendPath, incoming)
								}
							}
							continue
						}
					}
					setByPath(next.Variables, targetPath, mapping.Value)
				}
			runtime.log(ctx, map[string]any{
				"event":       "variables.after_writeback",
				"requestId":   requestIDFromContext(ctx),
				"executionId": next.ID,
				"nodeId":      nodeID,
				"workflow":    next.Variables["workflow"],
			})
			ensureReservedVariableRoots(next.Variables, next.WorkflowDSL)
			runtime.log(ctx, map[string]any{
				"event":       "variables.after_ensure",
				"requestId":   requestIDFromContext(ctx),
				"executionId": next.ID,
				"nodeId":      nodeID,
				"workflow":    next.Variables["workflow"],
			})
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
				nextEdges := orderFanOutEdges(node, outgoingEdgesMap[nodeID], nodeMap)
				for _, edge := range nextEdges {
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

func shouldWaitAllIncoming(node WorkflowNode, incomingCount int) bool {
	cfg := node.Data.Config
	if cfg != nil {
		mode, _ := cfg["joinMode"].(string)
		mode = strings.TrimSpace(mode)
		if mode == "any" || mode == "wait_any" || mode == "first" {
			return false
		}
		joinAll, _ := cfg["joinAll"].(bool)
		if joinAll || mode == "all" || mode == "wait_all" {
			return true
		}
	}

	// 默认策略：当节点存在多入边时，等待所有上游到达再执行。
	return incomingCount > 1
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

func orderFanOutEdges(node WorkflowNode, edges []WorkflowEdge, nodeMap map[string]WorkflowNode) []WorkflowEdge {
	if len(edges) <= 1 {
		return edges
	}
	if fanOutMode(node) == "parallel" {
		return edges
	}
	ordered := append([]WorkflowEdge(nil), edges...)
	sort.SliceStable(ordered, func(i, j int) bool {
		left, leftOK := nodeMap[ordered[i].Target]
		right, rightOK := nodeMap[ordered[j].Target]
		if !leftOK || !rightOK {
			if ordered[i].Target != ordered[j].Target {
				return ordered[i].Target < ordered[j].Target
			}
			return ordered[i].ID < ordered[j].ID
		}
		leftX, leftY := nodeXY(left)
		rightX, rightY := nodeXY(right)
		if leftX != rightX {
			return leftX < rightX
		}
		if leftY != rightY {
			return leftY < rightY
		}
		if left.ID != right.ID {
			return left.ID < right.ID
		}
		return ordered[i].ID < ordered[j].ID
	})
	return ordered
}

func fanOutMode(node WorkflowNode) string {
	if node.Data.Config == nil {
		return "sequential"
	}
	mode, _ := node.Data.Config["fanOutMode"].(string)
	mode = strings.TrimSpace(mode)
	if mode == "parallel" {
		return "parallel"
	}
	return "sequential"
}

func nodeXY(node WorkflowNode) (float64, float64) {
	if node.Position == nil {
		return 0, 0
	}
	x := toFloat(node.Position["x"])
	y := toFloat(node.Position["y"])
	return x, y
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
