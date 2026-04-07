package workflowruntime

import (
	"context"
	"testing"
)

func TestRuntime_MultiIncoming_DefaultWaitAll(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{ID: "a", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "a", Type: "llm", Config: map[string]any{}}},
			{ID: "x", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "x", Type: "llm", Config: map[string]any{}}},
			{ID: "b", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "b", Type: "llm", Config: map[string]any{}}},
			{ID: "end", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-a", Source: "start", Target: "a"},
			{ID: "e-start-x", Source: "start", Target: "x"},
			{ID: "e-a-end", Source: "a", Target: "end"},
			{ID: "e-x-b", Source: "x", Target: "b"},
			{ID: "e-b-end", Source: "b", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	endStarted := findEventIndex(t, execution.Events, "node.started", "end")
	bSucceeded := findEventIndex(t, execution.Events, "node.succeeded", "b")
	if endStarted <= bSucceeded {
		t.Fatalf("期望 end 在 b 完成后开始执行：endStarted=%d bSucceeded=%d", endStarted, bSucceeded)
	}
}

func TestRuntime_MultiIncoming_JoinModeAny_AllowsEarlyEnqueue(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{ID: "a", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "a", Type: "llm", Config: map[string]any{}}},
			{ID: "x", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "x", Type: "llm", Config: map[string]any{}}},
			{ID: "b", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "b", Type: "llm", Config: map[string]any{}}},
			{
				ID:       "end",
				Position: map[string]any{"x": 0, "y": 0},
				Data: WorkflowNodeData{
					Title: "end",
					Type:  "end",
					Config: map[string]any{
						"joinMode": "any",
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-a", Source: "start", Target: "a"},
			{ID: "e-start-x", Source: "start", Target: "x"},
			{ID: "e-a-end", Source: "a", Target: "end"},
			{ID: "e-x-b", Source: "x", Target: "b"},
			{ID: "e-b-end", Source: "b", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	endStarted := findEventIndex(t, execution.Events, "node.started", "end")
	bStarted := findEventIndex(t, execution.Events, "node.started", "b")
	if endStarted >= bStarted {
		t.Fatalf("期望 joinMode=any 时 end 可早于 b 执行：endStarted=%d bStarted=%d", endStarted, bStarted)
	}
}

func TestRuntime_JoinModeAll_AfterResume_KeepArrivedSources(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{
				ID:       "start",
				Position: map[string]any{"x": 0, "y": 0},
				Data: WorkflowNodeData{
					Title: "start",
					Type:  "start",
					Config: map[string]any{
						"fanOutMode": "parallel",
					},
				},
			},
			{
				ID:       "a",
				Position: map[string]any{"x": 100, "y": 0},
				Data: WorkflowNodeData{
					Title: "a",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { ok: true } }",
						"outputs": []any{"ok"},
					},
				},
			},
			{
				ID:       "input",
				Position: map[string]any{"x": 100, "y": 100},
				Data: WorkflowNodeData{
					Title: "input",
					Type:  "input",
					Config: map[string]any{
						"fields": []any{
							map[string]any{
								"name":     "confirm",
								"label":    "确认",
								"type":     "text",
								"required": true,
							},
						},
					},
				},
			},
			{
				ID:       "b",
				Position: map[string]any{"x": 220, "y": 100},
				Data: WorkflowNodeData{
					Title: "b",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { ok: true } }",
						"outputs": []any{"ok"},
					},
				},
			},
			{
				ID:       "join",
				Position: map[string]any{"x": 320, "y": 50},
				Data: WorkflowNodeData{
					Title: "join",
					Type:  "code",
					Config: map[string]any{
						"joinMode": "all",
						"code":     "function main(input) { return { merged: true } }",
						"outputs":  []any{"merged"},
					},
				},
			},
			{ID: "end", Position: map[string]any{"x": 420, "y": 50}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-a", Source: "start", Target: "a"},
			{ID: "e-start-input", Source: "start", Target: "input"},
			{ID: "e-a-join", Source: "a", Target: "join"},
			{ID: "e-input-b", Source: "input", Target: "b"},
			{ID: "e-b-join", Source: "b", Target: "join"},
			{ID: "e-join-end", Source: "join", Target: "end"},
		},
	}

	waitingExecution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if waitingExecution.Status != ExecutionStatusWaitingInput {
		t.Fatalf("期望 execution 进入 waiting_input，实际=%s", waitingExecution.Status)
	}

	resumedExecution, err := runtime.Resume(context.Background(), ResumeExecutionInput{
		ExecutionID: waitingExecution.ID,
		NodeID:      "input",
		Input: map[string]any{
			"confirm": "ok",
		},
	})
	if err != nil {
		t.Fatalf("Resume() error: %v", err)
	}

	if resumedExecution.NodeStates["join"].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望 join 在 resume 后执行成功，实际=%s", resumedExecution.NodeStates["join"].Status)
	}
	findEventIndex(t, resumedExecution.Events, "node.started", "join")
}

func findEventIndex(t *testing.T, events []ExecutionEvent, typ string, nodeID string) int {
	t.Helper()
	for idx, event := range events {
		if event.Type != typ {
			continue
		}
		if event.Payload == nil {
			continue
		}
		id, _ := event.Payload["nodeId"].(string)
		if id == nodeID {
			return idx
		}
	}
	t.Fatalf("未找到事件 typ=%q nodeId=%q", typ, nodeID)
	return -1
}
