package workflowruntime

import (
	"context"
	"testing"
)

func TestRuntime_FanOutModeSequential_OrderByNodePosition(t *testing.T) {
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
						"fanOutMode": "sequential",
					},
				},
			},
			{ID: "a", Position: map[string]any{"x": 200, "y": 0}, Data: WorkflowNodeData{Title: "a", Type: "llm", Config: map[string]any{}}},
			{ID: "b", Position: map[string]any{"x": 100, "y": 0}, Data: WorkflowNodeData{Title: "b", Type: "llm", Config: map[string]any{}}},
			{ID: "end", Position: map[string]any{"x": 300, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-a", Source: "start", Target: "a"},
			{ID: "e-start-b", Source: "start", Target: "b"},
			{ID: "e-a-end", Source: "a", Target: "end"},
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

	aStarted := findEventIndex(t, execution.Events, "node.started", "a")
	bStarted := findEventIndex(t, execution.Events, "node.started", "b")
	if bStarted >= aStarted {
		t.Fatalf("期望 sequential 模式下 b 先于 a 执行：aStarted=%d bStarted=%d", aStarted, bStarted)
	}
}

func TestRuntime_FanOutModeParallel_KeepEdgeOrder(t *testing.T) {
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
			{ID: "a", Position: map[string]any{"x": 200, "y": 0}, Data: WorkflowNodeData{Title: "a", Type: "llm", Config: map[string]any{}}},
			{ID: "b", Position: map[string]any{"x": 100, "y": 0}, Data: WorkflowNodeData{Title: "b", Type: "llm", Config: map[string]any{}}},
			{ID: "end", Position: map[string]any{"x": 300, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-a", Source: "start", Target: "a"},
			{ID: "e-start-b", Source: "start", Target: "b"},
			{ID: "e-a-end", Source: "a", Target: "end"},
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

	aStarted := findEventIndex(t, execution.Events, "node.started", "a")
	bStarted := findEventIndex(t, execution.Events, "node.started", "b")
	if aStarted >= bStarted {
		t.Fatalf("期望 parallel 模式下保持连线顺序：aStarted=%d bStarted=%d", aStarted, bStarted)
	}
}
