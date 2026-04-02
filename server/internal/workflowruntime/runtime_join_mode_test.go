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

