package workflowruntime

import (
	"context"
	"fmt"
	"reflect"
	"strings"
)

func (runtime *Runtime) executeWorkflowNode(ctx context.Context, node WorkflowNode, variables map[string]any, nodeInput map[string]any) (NodeExecutorResult, error) {
	if node.Data.Type == "iteration" {
		return runtime.executeIterationNode(ctx, node, variables)
	}
	executor := runtime.executors[node.Data.Type]
	if executor == nil {
		executor = runtime.executors["start"]
	}
	return executor.Execute(ctx, NodeExecutorContext{
		Node:      node,
		Variables: variables,
		NodeInput: nodeInput,
	})
}

func (runtime *Runtime) executeIterationNode(ctx context.Context, node WorkflowNode, variables map[string]any) (NodeExecutorResult, error) {
	config := node.Data.Config
	if config == nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "迭代节点配置为空"}, nil
	}

	if isParallel, _ := config["isParallel"].(bool); isParallel {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "共享迭代状态对象暂不支持并行模式"}, nil
	}

	rawItems := resolveValue(config["iteratorSource"], variables)
	items, ok := toAnySlice(rawItems)
	if !ok {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "迭代输入必须为数组"}, nil
	}

	outputVar := strings.TrimSpace(toString(config["outputVar"]))
	if outputVar == "" {
		outputVar = "results"
	}
	itemVar := strings.TrimSpace(toString(config["itemVar"]))
	if itemVar == "" {
		itemVar = "item"
	}
	indexVar := strings.TrimSpace(toString(config["indexVar"]))
	if indexVar == "" {
		indexVar = "index"
	}
	errorHandleMode := strings.TrimSpace(toString(config["errorHandleMode"]))
	if errorHandleMode == "" {
		errorHandleMode = "terminated"
	}

	childDSL, err := parseIterationChildrenDSL(config)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: err.Error()}, nil
	}

	state := map[string]any{}
	parentVariables := deepCloneVariables(variables)
	for index, item := range items {
		iterationVariables := deepCloneVariables(parentVariables)
		setByPath(iterationVariables, node.ID, map[string]any{
			itemVar:  item,
			indexVar: index,
			"state":  deepCloneVariables(state),
		})

		executedVariables, runErr := runtime.executeChildWorkflow(ctx, childDSL, iterationVariables)
		if runErr != nil {
			switch errorHandleMode {
			case "continue-on-error", "remove-abnormal-output":
				continue
			default:
				return NodeExecutorResult{
					Type:  NodeExecutorResultFailed,
					Error: fmt.Sprintf("迭代第 %d 项执行失败: %s", index, runErr.Error()),
				}, nil
			}
		}

		nextState, found := getByPath(executedVariables, node.ID+".state")
		if !found {
			nextState = map[string]any{}
		}
		nextStateObject, ok := nextState.(map[string]any)
		if !ok {
			return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "迭代状态对象必须为对象"}, nil
		}

		state = deepCloneVariables(nextStateObject)
		commitIterationReservedRoots(parentVariables, executedVariables)
	}

	return NodeExecutorResult{
		Type: NodeExecutorResultSuccess,
		Output: map[string]any{
			outputVar: state,
		},
	}, nil
}

func parseIterationChildrenDSL(config map[string]any) (WorkflowDSL, error) {
	children, _ := config["children"].(map[string]any)
	if children == nil {
		return WorkflowDSL{}, fmt.Errorf("迭代子流程配置缺失")
	}
	return ParseWorkflowDSL(map[string]any{
		"nodes": children["nodes"],
		"edges": children["edges"],
	})
}

func (runtime *Runtime) executeChildWorkflow(ctx context.Context, dsl WorkflowDSL, variables map[string]any) (map[string]any, error) {
	nodeMap := map[string]WorkflowNode{}
	for _, node := range dsl.Nodes {
		nodeMap[node.ID] = node
	}

	outgoingEdgesMap := map[string][]WorkflowEdge{}
	incomingSourcesMap := map[string]map[string]bool{}
	for _, edge := range dsl.Edges {
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

	enqueue(getStartNodeID(dsl.Nodes))
	maxSteps := len(dsl.Nodes)*8 + 16
	stepCount := 0
	nextVariables := deepCloneVariables(variables)
	for len(queue) > 0 {
		stepCount++
		if stepCount > maxSteps {
			return nil, fmt.Errorf("检测到迭代子流程可能存在循环")
		}
		nodeID := queue[0]
		queue = queue[1:]
		node, ok := nodeMap[nodeID]
		if !ok {
			continue
		}

		result, err := runtime.executeWorkflowNode(ctx, node, nextVariables, nil)
		if err != nil {
			return nil, err
		}

		switch result.Type {
		case NodeExecutorResultWaitingInput:
			return nil, fmt.Errorf("迭代子流程暂不支持输入节点")
		case NodeExecutorResultFailed:
			return nil, fmt.Errorf("%s", result.Error)
		case NodeExecutorResultBranch:
			nextVariables[nodeID] = defaultMap(result.Output)
			nextEdges := orderFanOutEdges(node, selectIfElseNextEdges(outgoingEdgesMap[nodeID], result.HandleID), nodeMap)
			for _, edge := range nextEdges {
				markArrived(edge.Target, nodeID)
				enqueue(edge.Target)
			}
		default:
			nextVariables[nodeID] = defaultMap(result.Output)
			applyWritebacksToVariables(nextVariables, result.Writebacks)
			nextEdges := orderFanOutEdges(node, outgoingEdgesMap[nodeID], nodeMap)
			for _, edge := range nextEdges {
				markArrived(edge.Target, nodeID)
				enqueue(edge.Target)
			}
		}
	}

	return nextVariables, nil
}

func applyWritebacksToVariables(variables map[string]any, writebacks []Writeback) {
	for _, mapping := range writebacks {
		targetPath := strings.TrimSpace(mapping.TargetPath)
		if targetPath == "" {
			continue
		}
		if targetPath == "workflow" || targetPath == "global" || targetPath == "user" {
			continue
		}
		if strings.HasSuffix(targetPath, "[]") {
			if incoming, ok := mapping.Value.([]any); ok {
				appendPath := strings.TrimSuffix(targetPath, "[]")
				appendPath = strings.TrimSuffix(appendPath, ".")
				existing, found := getByPath(variables, appendPath)
				switch typed := existing.(type) {
				case []any:
					combined := make([]any, 0, len(typed)+len(incoming))
					combined = append(combined, typed...)
					combined = append(combined, incoming...)
					setByPath(variables, appendPath, combined)
				default:
					if found {
						setByPath(variables, appendPath, incoming)
					} else {
						setByPath(variables, appendPath, incoming)
					}
				}
				continue
			}
		}
		setByPath(variables, targetPath, mapping.Value)
	}
}

func commitIterationReservedRoots(parentVariables map[string]any, iterationVariables map[string]any) {
	for _, rootKey := range []string{"workflow", "global", "user"} {
		if rootValue, found := getByPath(iterationVariables, rootKey); found {
			switch typed := rootValue.(type) {
			case map[string]any:
				parentVariables[rootKey] = deepCloneVariables(typed)
			default:
				parentVariables[rootKey] = typed
			}
		}
	}
}

func deepCloneVariables(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	cloned, hasCycle := sanitizeForRuntimeJSON(source)
	if hasCycle {
		return cloneMap(source)
	}
	return toObject(cloned)
}

func toAnySlice(value any) ([]any, bool) {
	switch typed := value.(type) {
	case []any:
		return typed, true
	}
	if value == nil {
		return nil, false
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil, false
	}
	result := make([]any, 0, rv.Len())
	for index := 0; index < rv.Len(); index++ {
		result = append(result, rv.Index(index).Interface())
	}
	return result, true
}
