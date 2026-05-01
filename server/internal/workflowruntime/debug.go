package workflowruntime

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/google/uuid"
)

type StartDebugSessionInput struct {
	WorkflowID     int64
	WorkflowDSL    WorkflowDSL
	Input          map[string]any
	CreatorUserID  int64
	TargetNodeID   string
}

type ContinueDebugSessionInput struct {
	SessionID string
	NodeID    string
	Input     map[string]any
}

type RerunDebugTargetInput struct {
	SessionID string
}

type RebuildDebugSessionInput struct {
	SessionID string
	Input     map[string]any
}

type debugRunOptions struct {
	ResumedNodeID string
	ResumedInput  map[string]any
}

func (runtime *Runtime) StartDebugSession(ctx context.Context, store DebugSessionStorePort, input StartDebugSessionInput) (WorkflowDebugSession, error) {
	session, err := runtime.buildDebugSession(input)
	if err != nil {
		return WorkflowDebugSession{}, err
	}
	result := runtime.runDebugSession(ctx, session, debugRunOptions{})
	if err := store.Save(result); err != nil {
		return WorkflowDebugSession{}, err
	}
	return result, nil
}

func (runtime *Runtime) ContinueDebugSession(ctx context.Context, store DebugSessionStorePort, input ContinueDebugSessionInput) (WorkflowDebugSession, error) {
	session, err := store.Get(strings.TrimSpace(input.SessionID))
	if err != nil {
		return WorkflowDebugSession{}, err
	}
	if session == nil {
		return WorkflowDebugSession{}, errors.New("debug session 不存在")
	}
	if session.Status != DebugSessionStatusWaitingInput || session.WaitingInput == nil {
		return WorkflowDebugSession{}, errors.New("当前调试会话不处于 waiting_input")
	}
	if strings.TrimSpace(session.WaitingInput.NodeID) != strings.TrimSpace(input.NodeID) {
		return WorkflowDebugSession{}, errors.New("continue 节点不匹配")
	}

	resumeInput := cloneMap(input.Input)
	if resumeInput == nil {
		resumeInput = map[string]any{}
	}
	node, ok := findNodeByID(session.WorkflowDSL.Nodes, input.NodeID)
	if !ok {
		return WorkflowDebugSession{}, errors.New("等待输入节点不存在")
	}
	if node.Data.Type == "input" {
		normalized, validateErr := ValidateAndNormalizeDynamicInput(ParseInputFields(node.Data.Config), resumeInput)
		if validateErr != nil {
			return WorkflowDebugSession{}, validateErr
		}
		resumeInput = normalized
	}

	next := cloneDebugSessionSnapshot(*session)
	next.WaitingInput = nil
	next.Error = ""
	result := runtime.runDebugSession(ctx, next, debugRunOptions{
		ResumedNodeID: input.NodeID,
		ResumedInput:  resumeInput,
	})
	if err := store.Save(result); err != nil {
		return WorkflowDebugSession{}, err
	}
	return result, nil
}

func (runtime *Runtime) RerunDebugTarget(ctx context.Context, store DebugSessionStorePort, input RerunDebugTargetInput) (WorkflowDebugSession, error) {
	session, err := store.Get(strings.TrimSpace(input.SessionID))
	if err != nil {
		return WorkflowDebugSession{}, err
	}
	if session == nil {
		return WorkflowDebugSession{}, errors.New("debug session 不存在")
	}
	if session.WaitingInput != nil {
		return WorkflowDebugSession{}, errors.New("当前调试会话仍在等待输入，请先 continue")
	}
	next := cloneDebugSessionSnapshot(*session)
	next.Error = ""
	result := runtime.runDebugSession(ctx, next, debugRunOptions{})
	if err := store.Save(result); err != nil {
		return WorkflowDebugSession{}, err
	}
	return result, nil
}

func (runtime *Runtime) RebuildDebugSession(ctx context.Context, store DebugSessionStorePort, input RebuildDebugSessionInput) (WorkflowDebugSession, error) {
	session, err := store.Get(strings.TrimSpace(input.SessionID))
	if err != nil {
		return WorkflowDebugSession{}, err
	}
	if session == nil {
		return WorkflowDebugSession{}, errors.New("debug session 不存在")
	}
	next, err := runtime.buildDebugSession(StartDebugSessionInput{
		WorkflowID:    session.WorkflowID,
		WorkflowDSL:   session.WorkflowDSL,
		Input:         input.Input,
		CreatorUserID: session.CreatorUserID,
		TargetNodeID:  session.TargetNodeID,
	})
	if err != nil {
		return WorkflowDebugSession{}, err
	}
	next.ID = session.ID
	next.CreatedAt = session.CreatedAt
	result := runtime.runDebugSession(ctx, next, debugRunOptions{})
	if err := store.Save(result); err != nil {
		return WorkflowDebugSession{}, err
	}
	return result, nil
}

func (runtime *Runtime) buildDebugSession(input StartDebugSessionInput) (WorkflowDebugSession, error) {
	if input.WorkflowID <= 0 {
		return WorkflowDebugSession{}, errors.New("workflowId 不能为空")
	}
	targetNodeID := strings.TrimSpace(input.TargetNodeID)
	if targetNodeID == "" {
		return WorkflowDebugSession{}, errors.New("targetNodeId 不能为空")
	}
	if len(input.WorkflowDSL.Nodes) == 0 {
		return WorkflowDebugSession{}, errors.New("workflowDsl 不能为空")
	}
	if _, ok := findNodeByID(input.WorkflowDSL.Nodes, targetNodeID); !ok {
		return WorkflowDebugSession{}, errors.New("targetNodeId 不存在")
	}

	now := NowISO()
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

	session := WorkflowDebugSession{
		ID:                         uuid.NewString(),
		WorkflowID:                 input.WorkflowID,
		CreatorUserID:              input.CreatorUserID,
		TargetNodeID:               targetNodeID,
		Status:                     DebugSessionStatusReady,
		WorkflowDSL:                input.WorkflowDSL,
		WorkflowParametersSnapshot: append([]WorkflowParameter{}, input.WorkflowDSL.WorkflowParameters...),
		Variables:                  variables,
		NodeStates:                 nodeStates,
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}
	return session, nil
}

func (runtime *Runtime) runDebugSession(ctx context.Context, session WorkflowDebugSession, options debugRunOptions) WorkflowDebugSession {
	nodeMap := map[string]WorkflowNode{}
	for _, node := range session.WorkflowDSL.Nodes {
		nodeMap[node.ID] = node
	}

	outgoingEdgesMap := map[string][]WorkflowEdge{}
	incomingSourcesMap := map[string]map[string]bool{}
	for _, edge := range session.WorkflowDSL.Edges {
		outgoingEdgesMap[edge.Source] = append(outgoingEdgesMap[edge.Source], edge)
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

	requiredNodes := collectDebugRequiredNodes(session.TargetNodeID, session.WorkflowDSL.Edges)
	plan := BuildExecutionPlan(session.WorkflowDSL)
	maxSteps := int(math.Max(float64(len(plan)*8), 32))

	next := cloneDebugSessionSnapshot(session)
	next.NodeStates = cloneNodeStates(session.NodeStates)
	next.Variables = cloneMap(session.Variables)
	next.WaitingInput = nil
	next.LastTargetInput = nil
	next.LastTargetOutput = nil
	next.LastWritebacks = nil
	next.Error = ""
	next.UpdatedAt = NowISO()
	ensureReservedVariableRoots(next.Variables, next.WorkflowDSL)
	resetDebugTargetState(&next)

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

	seedArrivedFromStates := func() {
		for nodeID, state := range next.NodeStates {
			if state.Status != NodeRunStatusSucceeded {
				continue
			}
			if !requiredNodes[nodeID] {
				continue
			}
			node, ok := nodeMap[nodeID]
			if !ok {
				continue
			}
			outgoing := outgoingEdgesMap[nodeID]
			if node.Data.Type == "if-else" {
				handleID := inferDebugBranchHandle(nodeID, next.Variables, outgoing)
				if strings.TrimSpace(handleID) == "" {
					continue
				}
				for _, edge := range selectIfElseNextEdges(outgoing, handleID) {
					if requiredNodes[edge.Target] {
						markArrived(edge.Target, nodeID)
					}
				}
				continue
			}
			for _, edge := range outgoing {
				if requiredNodes[edge.Target] {
					markArrived(edge.Target, nodeID)
				}
			}
		}
	}
	seedArrivedFromStates()

	isReadyToRun := func(nodeID string) bool {
		node, ok := nodeMap[nodeID]
		if !ok {
			return false
		}
		expected := incomingSourcesMap[nodeID]
		if len(expected) == 0 {
			return true
		}
		if !shouldWaitAllIncoming(node, len(expected)) {
			for sourceID := range expected {
				if arrivedSources[nodeID][sourceID] {
					return true
				}
			}
			return false
		}
		return len(arrivedSources[nodeID]) >= len(expected)
	}

	enqueue := func(nodeID string) {
		if strings.TrimSpace(nodeID) == "" || pushed[nodeID] || !requiredNodes[nodeID] {
			return
		}
		if !isReadyToRun(nodeID) {
			return
		}
		queue = append(queue, nodeID)
		pushed[nodeID] = true
	}

	if options.ResumedNodeID != "" {
		queue = append(queue, options.ResumedNodeID)
		pushed[options.ResumedNodeID] = true
	} else {
		for _, nodeID := range plan {
			state := next.NodeStates[nodeID]
			if !requiredNodes[nodeID] || state.Status == NodeRunStatusSucceeded || state.Status == NodeRunStatusSkipped {
				continue
			}
			enqueue(nodeID)
		}
	}

	stepCount := 0
	for len(queue) > 0 {
		stepCount++
		if stepCount > maxSteps {
			next.Status = DebugSessionStatusFailed
			next.Error = "检测到可能的循环执行，请检查流程连线"
			next.UpdatedAt = NowISO()
			return next
		}
		if ctx.Err() != nil {
			next.Status = DebugSessionStatusFailed
			next.Error = "执行被取消"
			next.UpdatedAt = NowISO()
			return next
		}

		nodeID := queue[0]
		queue = queue[1:]
		node, ok := nodeMap[nodeID]
		if !ok || !requiredNodes[nodeID] {
			continue
		}

		state := next.NodeStates[nodeID]
		if nodeID != next.TargetNodeID && (state.Status == NodeRunStatusSucceeded || state.Status == NodeRunStatusSkipped) {
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
		state.Error = ""
		state.EndedAt = ""
		next.NodeStates[nodeID] = state

		var nodeInput map[string]any
		if options.ResumedNodeID == nodeID {
			nodeInput = options.ResumedInput
		}
		if nodeID == next.TargetNodeID {
			next.LastTargetInput = map[string]any{
				"variables": cloneMap(next.Variables),
				"nodeInput": cloneMap(nodeInput),
			}
		}

		ensureReservedVariableRoots(next.Variables, next.WorkflowDSL)
		result, executeErr := executor.Execute(ctx, NodeExecutorContext{
			Node:      node,
			Variables: next.Variables,
			NodeInput: nodeInput,
		})
		if executeErr != nil {
			result = NodeExecutorResult{Type: NodeExecutorResultFailed, Error: executeErr.Error()}
		}

		switch result.Type {
		case NodeExecutorResultWaitingInput:
			waitingState := next.NodeStates[nodeID]
			waitingState.Status = NodeRunStatusWaitingInput
			waitingState.EndedAt = NowISO()
			next.NodeStates[nodeID] = waitingState
			next.WaitingInput = &ExecutionWaitingInput{
				NodeID:    nodeID,
				NodeTitle: node.Data.Title,
				Schema:    result.Schema,
			}
			next.Status = DebugSessionStatusWaitingInput
			next.UpdatedAt = NowISO()
			return next

		case NodeExecutorResultFailed:
			failedState := next.NodeStates[nodeID]
			failedState.Status = NodeRunStatusFailed
			failedState.EndedAt = NowISO()
			failedState.Error = result.Error
			next.NodeStates[nodeID] = failedState
			next.Status = DebugSessionStatusFailed
			next.Error = result.Error
			next.UpdatedAt = NowISO()
			return next

		case NodeExecutorResultBranch:
			succeededState := next.NodeStates[nodeID]
			succeededState.Status = NodeRunStatusSucceeded
			succeededState.EndedAt = NowISO()
			next.NodeStates[nodeID] = succeededState
			next.Variables[nodeID] = defaultMap(result.Output)
			for _, edge := range orderFanOutEdges(node, selectIfElseNextEdges(outgoingEdgesMap[nodeID], result.HandleID), nodeMap) {
				if !requiredNodes[edge.Target] {
					continue
				}
				markArrived(edge.Target, nodeID)
				enqueue(edge.Target)
			}

		default:
			succeededState := next.NodeStates[nodeID]
			succeededState.Status = NodeRunStatusSucceeded
			succeededState.EndedAt = NowISO()
			next.NodeStates[nodeID] = succeededState
			output := defaultMap(result.Output)
			next.Variables[nodeID] = output
			next.applyDebugWritebacks(result.Writebacks)
			ensureReservedVariableRoots(next.Variables, next.WorkflowDSL)
			if nodeID == next.TargetNodeID {
				next.LastTargetOutput = cloneMap(output)
				next.LastWritebacks = append([]Writeback{}, result.Writebacks...)
				next.Status = DebugSessionStatusTargetSucceeded
				next.UpdatedAt = NowISO()
				return next
			}
			for _, edge := range orderFanOutEdges(node, outgoingEdgesMap[nodeID], nodeMap) {
				if !requiredNodes[edge.Target] {
					continue
				}
				markArrived(edge.Target, nodeID)
				enqueue(edge.Target)
			}
		}
	}

	next.Status = DebugSessionStatusReady
	next.UpdatedAt = NowISO()
	return next
}

func collectDebugRequiredNodes(targetNodeID string, edges []WorkflowEdge) map[string]bool {
	required := map[string]bool{}
	if strings.TrimSpace(targetNodeID) == "" {
		return required
	}
	incoming := map[string][]string{}
	for _, edge := range edges {
		if strings.TrimSpace(edge.Source) == "" || strings.TrimSpace(edge.Target) == "" {
			continue
		}
		incoming[edge.Target] = append(incoming[edge.Target], edge.Source)
	}

	queue := []string{targetNodeID}
	for len(queue) > 0 {
		nodeID := queue[0]
		queue = queue[1:]
		if required[nodeID] {
			continue
		}
		required[nodeID] = true
		queue = append(queue, incoming[nodeID]...)
	}
	return required
}

func inferDebugBranchHandle(nodeID string, variables map[string]any, outgoing []WorkflowEdge) string {
	raw, ok := variables[nodeID]
	if !ok {
		return ""
	}
	output, ok := raw.(map[string]any)
	if !ok {
		return ""
	}
	handleID := strings.TrimSpace(toString(output["handleId"]))
	if handleID == "" {
		handleID = strings.TrimSpace(toString(output["branchHandleId"]))
	}
	if handleID == "" {
		handleID = strings.TrimSpace(toString(output["branchHandle"]))
	}
	if handleID == "" {
		return ""
	}
	for _, edge := range outgoing {
		if strings.TrimSpace(edge.SourceHandle) == handleID {
			return handleID
		}
	}
	return ""
}

func resetDebugTargetState(session *WorkflowDebugSession) {
	if session == nil {
		return
	}
	state := session.NodeStates[session.TargetNodeID]
	state.Status = NodeRunStatusPending
	state.StartedAt = ""
	state.EndedAt = ""
	state.Error = ""
	session.NodeStates[session.TargetNodeID] = state
}

func (session *WorkflowDebugSession) applyDebugWritebacks(writebacks []Writeback) {
	for _, mapping := range writebacks {
		targetPath := strings.TrimSpace(mapping.TargetPath)
		if targetPath == "" || targetPath == "workflow" || targetPath == "global" || targetPath == "user" {
			continue
		}
		if strings.HasSuffix(targetPath, "[]") {
			if incoming, ok := mapping.Value.([]any); ok {
				appendPath := strings.TrimSuffix(strings.TrimSuffix(targetPath, "[]"), ".")
				existing, found := getByPath(session.Variables, appendPath)
				switch typed := existing.(type) {
				case []any:
					combined := make([]any, 0, len(typed)+len(incoming))
					combined = append(combined, typed...)
					combined = append(combined, incoming...)
					setByPath(session.Variables, appendPath, combined)
				default:
					if found {
						setByPath(session.Variables, appendPath, incoming)
					} else {
						setByPath(session.Variables, appendPath, incoming)
					}
				}
				continue
			}
		}
		setByPath(session.Variables, targetPath, mapping.Value)
	}
}
