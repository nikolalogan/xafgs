package workflowruntime

import (
	"context"
	"fmt"
	"testing"
)

type flakyExecutor struct {
	failuresLeft int
	calls        int
}

func (executor *flakyExecutor) Execute(_ context.Context, _ NodeExecutorContext) (NodeExecutorResult, error) {
	executor.calls++
	if executor.failuresLeft > 0 {
		executor.failuresLeft--
		return NodeExecutorResult{
			Type:  NodeExecutorResultFailed,
			Error: fmt.Sprintf("fail-%d", executor.calls),
		}, nil
	}
	return NodeExecutorResult{
		Type:   NodeExecutorResultSuccess,
		Output: map[string]any{"ok": true},
	}, nil
}

func TestRuntime_NodeRetry_SucceedsWithinRetryLimit(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)
	executor := &flakyExecutor{failuresLeft: 2}
	runtime.executors["http-request"] = executor

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "http",
				Position: map[string]any{"x": 100, "y": 0},
				Data: WorkflowNodeData{
					Title: "http",
					Type:  "http-request",
					Config: map[string]any{
						"url":        "https://example.com",
						"retryCount": 2,
					},
				},
			},
			{ID: "end", Position: map[string]any{"x": 200, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-http", Source: "start", Target: "http"},
			{ID: "e-http-end", Source: "http", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	if executor.calls != 3 {
		t.Fatalf("期望执行 3 次，实际=%d", executor.calls)
	}
	if execution.Status != ExecutionStatusCompleted {
		t.Fatalf("期望执行成功，实际=%s", execution.Status)
	}
	if execution.NodeStates["http"].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望 http 节点成功，实际=%s", execution.NodeStates["http"].Status)
	}

	retryingCount := countEventType(execution.Events, "node.retrying")
	if retryingCount != 2 {
		t.Fatalf("期望 2 次重试事件，实际=%d", retryingCount)
	}

	succeeded := findEventByTypeAndNode(t, execution.Events, "node.succeeded", "http")
	if got := succeeded.Payload["attempts"]; got != 3 {
		t.Fatalf("期望成功事件 attempts=3，实际=%v", got)
	}
}

func TestRuntime_NodeRetry_FailsAfterRetryLimit(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)
	executor := &flakyExecutor{failuresLeft: 5}
	runtime.executors["api-request"] = executor

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "api",
				Position: map[string]any{"x": 100, "y": 0},
				Data: WorkflowNodeData{
					Title: "api",
					Type:  "api-request",
					Config: map[string]any{
						"route": map[string]any{
							"method": "GET",
							"path":   "/api/mock",
						},
						"retryCount": 2,
					},
				},
			},
			{ID: "end", Position: map[string]any{"x": 200, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-api", Source: "start", Target: "api"},
			{ID: "e-api-end", Source: "api", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	if executor.calls != 3 {
		t.Fatalf("期望执行 3 次，实际=%d", executor.calls)
	}
	if execution.Status != ExecutionStatusFailed {
		t.Fatalf("期望执行失败，实际=%s", execution.Status)
	}
	if execution.NodeStates["api"].Status != NodeRunStatusFailed {
		t.Fatalf("期望 api 节点失败，实际=%s", execution.NodeStates["api"].Status)
	}

	retryingCount := countEventType(execution.Events, "node.retrying")
	if retryingCount != 2 {
		t.Fatalf("期望 2 次重试事件，实际=%d", retryingCount)
	}

	failed := findEventByTypeAndNode(t, execution.Events, "node.failed", "api")
	if got := failed.Payload["attempts"]; got != 3 {
		t.Fatalf("期望失败事件 attempts=3，实际=%v", got)
	}
}

func TestRuntime_NodeRetry_DefaultZero(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)
	executor := &flakyExecutor{failuresLeft: 1}
	runtime.executors["llm"] = executor

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "llm",
				Position: map[string]any{"x": 100, "y": 0},
				Data: WorkflowNodeData{
					Title: "llm",
					Type:  "llm",
					Config: map[string]any{
						"userPrompt": "hello",
					},
				},
			},
			{ID: "end", Position: map[string]any{"x": 200, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-llm", Source: "start", Target: "llm"},
			{ID: "e-llm-end", Source: "llm", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	if executor.calls != 1 {
		t.Fatalf("期望默认不重试，实际执行次数=%d", executor.calls)
	}
	if countEventType(execution.Events, "node.retrying") != 0 {
		t.Fatalf("期望默认不产生重试事件")
	}
}

func countEventType(events []ExecutionEvent, eventType string) int {
	total := 0
	for _, event := range events {
		if event.Type == eventType {
			total++
		}
	}
	return total
}

func findEventByTypeAndNode(t *testing.T, events []ExecutionEvent, eventType string, nodeID string) ExecutionEvent {
	t.Helper()
	for _, event := range events {
		if event.Type != eventType {
			continue
		}
		if event.Payload["nodeId"] == nodeID {
			return event
		}
	}
	t.Fatalf("未找到事件 type=%s node=%s", eventType, nodeID)
	return ExecutionEvent{}
}
