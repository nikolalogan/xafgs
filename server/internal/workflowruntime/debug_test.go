package workflowruntime

import (
	"context"
	"testing"
)

func TestDebugSession_RerunTargetAppliesWriteback(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	store := NewInMemoryDebugSessionStore()
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
							map[string]any{"name": "query", "label": "查询", "type": "text-input", "required": true},
						},
					},
				},
			},
			{
				ID:       "code",
				Position: map[string]any{"x": 300, "y": 0},
				Data: WorkflowNodeData{
					Title: "代码",
					Type:  "code",
					Config: map[string]any{
						"language": "javascript",
						"code":     "function main(input) { return { result: input.start.query + '-done' } }",
						"writebackMappings": []any{
							map[string]any{"expression": "result", "targetPath": "workflow.answer"},
						},
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e1", Source: "start", Target: "code"},
		},
		WorkflowParameters: []WorkflowParameter{
			{Name: "answer", ValueType: "string"},
		},
	}

	session, err := runtime.StartDebugSession(context.Background(), store, StartDebugSessionInput{
		WorkflowID:    1,
		CreatorUserID: 2,
		WorkflowDSL:   dsl,
		TargetNodeID:  "code",
		Input: map[string]any{
			"start": map[string]any{"query": "abc"},
		},
	})
	if err != nil {
		t.Fatalf("创建调试会话失败：%v", err)
	}
	if session.Status != DebugSessionStatusReady {
		t.Fatalf("期望先进入 ready，实际=%s", session.Status)
	}

	rerun, err := runtime.RerunDebugTarget(context.Background(), store, RerunDebugTargetInput{SessionID: session.ID})
	if err != nil {
		t.Fatalf("重跑目标节点失败：%v", err)
	}
	if rerun.Status != DebugSessionStatusTargetSucceeded {
		t.Fatalf("期望目标节点执行成功，实际=%s", rerun.Status)
	}
	workflowVars, _ := rerun.Variables["workflow"].(map[string]any)
	if got := workflowVars["answer"]; got != "abc-done" {
		t.Fatalf("writeback 未写入调试会话，实际=%v", got)
	}
	if len(rerun.LastWritebacks) != 1 || rerun.LastWritebacks[0].TargetPath != "workflow.answer" {
		t.Fatalf("lastWritebacks 不符合预期：%#v", rerun.LastWritebacks)
	}
}

func TestDebugSession_ContinueWaitingInputBeforeTarget(t *testing.T) {
	runtime := NewRuntime(NewInMemoryExecutionStore())
	store := NewInMemoryDebugSessionStore()
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data: WorkflowNodeData{Title: "开始", Type: "start", Config: map[string]any{"variables": []any{}}},
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

	session, err := runtime.StartDebugSession(context.Background(), store, StartDebugSessionInput{
		WorkflowID:    1,
		CreatorUserID: 2,
		WorkflowDSL:   dsl,
		TargetNodeID:  "code",
		Input:         map[string]any{},
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

	continued, err := runtime.ContinueDebugSession(context.Background(), store, ContinueDebugSessionInput{
		SessionID: session.ID,
		NodeID:    "input",
		Input:     map[string]any{"extra": "next"},
	})
	if err != nil {
		t.Fatalf("继续调试失败：%v", err)
	}
	if continued.Status != DebugSessionStatusReady {
		t.Fatalf("期望继续后到达目标前 ready，实际=%s", continued.Status)
	}
	if state := continued.NodeStates["input"]; state.Status != NodeRunStatusSucceeded {
		t.Fatalf("input 节点状态不正确：%s", state.Status)
	}
}

