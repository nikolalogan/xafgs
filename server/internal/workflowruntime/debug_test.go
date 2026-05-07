package workflowruntime

import (
	"context"
	"testing"
)

func TestDebugSession_StartOnlyRunsTargetDependencies(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	debugStore := NewInMemoryDebugSessionStore()
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data:     WorkflowNodeData{Title: "开始", Type: "start", Config: map[string]any{"variables": []any{}}},
			},
			{
				ID:       "side",
				Position: map[string]any{"x": 220, "y": -120},
				Data: WorkflowNodeData{
					Title: "旁路",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { side: 'ignore' } }",
					},
				},
			},
			{
				ID:       "prep",
				Position: map[string]any{"x": 220, "y": 0},
				Data: WorkflowNodeData{
					Title: "准备",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { prepared: input.start.query + '-prep', trace: ['prep'] } }",
						"writebackMappings": []any{
							map[string]any{"expression": "trace", "targetPath": "workflow.trace[]"},
						},
					},
				},
			},
			{
				ID:       "target",
				Position: map[string]any{"x": 440, "y": 0},
				Data: WorkflowNodeData{
					Title: "目标",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { result: input.prep.prepared + '-target' } }",
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e1", Source: "start", Target: "side"},
			{ID: "e2", Source: "start", Target: "prep"},
			{ID: "e3", Source: "prep", Target: "target"},
		},
	}

	session, err := runtime.StartDebugSession(context.Background(), debugStore, StartDebugSessionInput{
		WorkflowID:    1,
		WorkflowDSL:   dsl,
		Input:         map[string]any{"query": "abc"},
		CreatorUserID: 2,
		TargetNodeID:  "target",
	})
	if err != nil {
		t.Fatalf("创建调试会话失败：%v", err)
	}
	if session.Status != DebugSessionStatusTargetSucceeded {
		t.Fatalf("期望执行目标节点成功，实际=%s", session.Status)
	}
	if session.NodeStates["side"].Status != NodeRunStatusPending {
		t.Fatalf("无关旁路节点不应执行，实际=%s", session.NodeStates["side"].Status)
	}
	if session.NodeStates["prep"].Status != NodeRunStatusSucceeded {
		t.Fatalf("依赖节点应已成功，实际=%s", session.NodeStates["prep"].Status)
	}
	if got := session.LastTargetOutput["result"]; got != "abc-prep-target" {
		t.Fatalf("目标节点输出不正确：%v", got)
	}
}

func TestDebugSession_RerunTargetReusesAncestorSnapshot(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	debugStore := NewInMemoryDebugSessionStore()
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data:     WorkflowNodeData{Title: "开始", Type: "start", Config: map[string]any{"variables": []any{}}},
			},
			{
				ID:       "prep",
				Position: map[string]any{"x": 220, "y": 0},
				Data: WorkflowNodeData{
					Title: "准备",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { prepared: input.start.query + '-prep' } }",
					},
				},
			},
			{
				ID:       "target",
				Position: map[string]any{"x": 440, "y": 0},
				Data: WorkflowNodeData{
					Title: "目标",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { result: input.prep.prepared + '-target' } }",
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e1", Source: "start", Target: "prep"},
			{ID: "e2", Source: "prep", Target: "target"},
		},
	}

	session, err := runtime.StartDebugSession(context.Background(), debugStore, StartDebugSessionInput{
		WorkflowID:    1,
		WorkflowDSL:   dsl,
		Input:         map[string]any{"query": "abc"},
		CreatorUserID: 2,
		TargetNodeID:  "target",
	})
	if err != nil {
		t.Fatalf("创建调试会话失败：%v", err)
	}
	workflowBefore, _ := session.Variables["workflow"].(map[string]any)
	traceBefore, _ := workflowBefore["trace"].([]any)
	if len(traceBefore) != 1 {
		t.Fatalf("首次运行后前序 writeback 不符合预期：%#v", workflowBefore["trace"])
	}

	rerun, err := runtime.RerunDebugTarget(context.Background(), debugStore, RerunDebugTargetInput{SessionID: session.ID})
	if err != nil {
		t.Fatalf("重跑目标节点失败：%v", err)
	}
	workflowAfter, _ := rerun.Variables["workflow"].(map[string]any)
	traceAfter, _ := workflowAfter["trace"].([]any)
	if len(traceAfter) != 1 {
		t.Fatalf("重跑目标节点不应重复执行前序 writeback，实际=%#v", workflowAfter["trace"])
	}
	if got := rerun.LastTargetOutput["result"]; got != "abc-prep-target" {
		t.Fatalf("重跑后的目标节点输出不正确：%v", got)
	}
}

func TestDebugSession_RebuildClearsCachedAncestors(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	debugStore := NewInMemoryDebugSessionStore()
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data: WorkflowNodeData{
					Title: "开始",
					Type:  "start",
					Config: map[string]any{
						"variables": []any{
							map[string]any{"name": "query", "label": "Query", "type": "text", "required": true},
						},
					},
				},
			},
			{
				ID:       "prep",
				Position: map[string]any{"x": 220, "y": 0},
				Data: WorkflowNodeData{
					Title: "准备",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { prepared: input.start.query + '-prep', trace: ['prep'] } }",
						"writebackMappings": []any{
							map[string]any{"expression": "trace", "targetPath": "workflow.trace[]"},
						},
					},
				},
			},
			{
				ID:       "target",
				Position: map[string]any{"x": 440, "y": 0},
				Data: WorkflowNodeData{
					Title: "目标",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { result: input.prep.prepared + '-target' } }",
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e1", Source: "start", Target: "prep"},
			{ID: "e2", Source: "prep", Target: "target"},
		},
	}

	session, err := runtime.StartDebugSession(context.Background(), debugStore, StartDebugSessionInput{
		WorkflowID:    1,
		WorkflowDSL:   dsl,
		Input:         map[string]any{"query": "first"},
		CreatorUserID: 2,
		TargetNodeID:  "target",
	})
	if err != nil {
		t.Fatalf("创建调试会话失败：%v", err)
	}
	workflowBefore, _ := session.Variables["workflow"].(map[string]any)
	traceBefore, _ := workflowBefore["trace"].([]any)
	if len(traceBefore) != 1 {
		t.Fatalf("首次运行后前序 writeback 不符合预期：%#v", workflowBefore["trace"])
	}

	rebuilt, err := runtime.RebuildDebugSession(context.Background(), debugStore, RebuildDebugSessionInput{
		SessionID: session.ID,
		Input:     map[string]any{"query": "second"},
	})
	if err != nil {
		t.Fatalf("重建调试会话失败：%v", err)
	}
	if rebuilt.ID != session.ID {
		t.Fatalf("rebuild 应复用原 session id，before=%s after=%s", session.ID, rebuilt.ID)
	}
	workflowAfter, _ := rebuilt.Variables["workflow"].(map[string]any)
	traceAfter, _ := workflowAfter["trace"].([]any)
	if len(traceAfter) != 1 {
		t.Fatalf("重建后应从干净上下文重新补跑，实际=%#v", workflowAfter["trace"])
	}
	if got := rebuilt.LastTargetOutput["result"]; got != "second-prep-target" {
		t.Fatalf("重建后目标节点输出不正确：%v", got)
	}
}

func TestDebugSession_ContinueWaitingInputBeforeTarget(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	debugStore := NewInMemoryDebugSessionStore()
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data:     WorkflowNodeData{Title: "开始", Type: "start", Config: map[string]any{"variables": []any{}}},
			},
			{
				ID:       "input",
				Position: map[string]any{"x": 220, "y": 0},
				Data: WorkflowNodeData{
					Title: "补参",
					Type:  "input",
					Config: map[string]any{
						"fields": []any{
							map[string]any{"name": "extra", "label": "补充", "type": "text", "required": true},
						},
					},
				},
			},
			{
				ID:       "code",
				Position: map[string]any{"x": 440, "y": 0},
				Data: WorkflowNodeData{
					Title: "代码",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { result: input.input.extra } }",
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e1", Source: "start", Target: "input"},
			{ID: "e2", Source: "input", Target: "code"},
		},
	}

	session, err := runtime.StartDebugSession(context.Background(), debugStore, StartDebugSessionInput{
		WorkflowID:    1,
		WorkflowDSL:   dsl,
		Input:         map[string]any{},
		CreatorUserID: 2,
		TargetNodeID:  "code",
	})
	if err != nil {
		t.Fatalf("创建调试会话失败：%v", err)
	}
	if session.Status != DebugSessionStatusWaitingInput {
		t.Fatalf("期望前序 input 进入 waiting_input，实际=%s", session.Status)
	}
	if session.WaitingInput == nil || session.WaitingInput.NodeID != "input" {
		t.Fatalf("waitingInput 不符合预期：%#v", session.WaitingInput)
	}

	continued, err := runtime.ContinueDebugSession(context.Background(), debugStore, ContinueDebugSessionInput{
		SessionID: session.ID,
		NodeID:    "input",
		Input:     map[string]any{"extra": "next"},
	})
	if err != nil {
		t.Fatalf("继续调试失败：%v", err)
	}
	if continued.Status != DebugSessionStatusTargetSucceeded {
		t.Fatalf("期望继续后执行目标成功，实际=%s", continued.Status)
	}
	if state := continued.NodeStates["input"]; state.Status != NodeRunStatusSucceeded {
		t.Fatalf("input 节点状态不正确：%s", state.Status)
	}
	if output := continued.LastTargetOutput["result"]; output != "next" {
		t.Fatalf("目标节点输出不正确：%v", output)
	}
}

func TestExecuteDebugNodeOnce_StartInputOverridesDebugVariables(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data: WorkflowNodeData{
					Title: "开始",
					Type:  "start",
					Config: map[string]any{
						"variables": []any{
							map[string]any{"name": "name", "type": "text", "required": true},
						},
					},
				},
			},
			{
				ID:       "target",
				Position: map[string]any{"x": 200, "y": 0},
				Data: WorkflowNodeData{
					Title: "目标",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { value: input.name } }",
					},
				},
			},
		},
		Edges: []WorkflowEdge{{ID: "e1", Source: "start", Target: "target"}},
	}

	result, err := runtime.ExecuteDebugNodeOnce(context.Background(), ExecuteDebugNodeOnceInput{
		WorkflowID:   1,
		WorkflowDSL:  dsl,
		TargetNodeID: "target",
		StartInput:   map[string]any{"name": "alice"},
		DebugVariables: map[string]any{
			"name": "bob",
		},
	})
	if err != nil {
		t.Fatalf("执行单次调试失败：%v", err)
	}
	if got := result.NodeInput["variables"].(map[string]any)["name"]; got != "alice" {
		t.Fatalf("开始参数应覆盖同名调试变量，actual=%v", got)
	}
}

func TestExecuteDebugNodeOnce_StartNodeNoRecursiveWriteback(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data:     WorkflowNodeData{Title: "开始", Type: "start", Config: map[string]any{"variables": []any{}}},
			},
		},
	}

	debugVariables := map[string]any{}
	for i := 0; i < 10; i++ {
		result, err := runtime.ExecuteDebugNodeOnce(context.Background(), ExecuteDebugNodeOnceInput{
			WorkflowID:      1,
			WorkflowDSL:     dsl,
			TargetNodeID:    "start",
			StartInput:      map[string]any{"name": "alice"},
			DebugVariables:  debugVariables,
			NodeInput:       map[string]any{},
		})
		if err != nil {
			t.Fatalf("第 %d 次执行单次调试失败：%v", i+1, err)
		}
		debugVariables = result.UpdatedDebugVariables
		startValue, hasStart := debugVariables["start"]
		if !hasStart {
			continue
		}
		startMap, ok := startValue.(map[string]any)
		if !ok {
			t.Fatalf("start 变量类型异常：%T", startValue)
		}
		if _, nested := startMap["start"]; nested {
			t.Fatalf("start 节点不应产生递归套娃：%#v", startMap)
		}
	}
}
