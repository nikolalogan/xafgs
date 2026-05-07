package workflowruntime

import (
	"context"
	"testing"
)

type staticWritebackExecutor struct {
	output     map[string]any
	writebacks []Writeback
}

func (executor staticWritebackExecutor) Execute(_ context.Context, _ NodeExecutorContext) (NodeExecutorResult, error) {
	return NodeExecutorResult{
		Type:       NodeExecutorResultSuccess,
		Output:     cloneMap(executor.output),
		Writebacks: append([]Writeback{}, executor.writebacks...),
	}, nil
}

func TestRuntimeAndDebug_NodeOutputUseWritebackMappedResult(t *testing.T) {
	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{ID: "llm", Position: map[string]any{"x": 100, "y": 0}, Data: WorkflowNodeData{Title: "llm", Type: "llm", Config: map[string]any{}}},
			{ID: "http", Position: map[string]any{"x": 200, "y": 0}, Data: WorkflowNodeData{Title: "http", Type: "http-request", Config: map[string]any{}}},
			{ID: "api", Position: map[string]any{"x": 300, "y": 0}, Data: WorkflowNodeData{Title: "api", Type: "api-request", Config: map[string]any{}}},
			{ID: "code", Position: map[string]any{"x": 400, "y": 0}, Data: WorkflowNodeData{Title: "code", Type: "code", Config: map[string]any{}}},
			{ID: "end", Position: map[string]any{"x": 500, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e1", Source: "start", Target: "llm"},
			{ID: "e2", Source: "llm", Target: "http"},
			{ID: "e3", Source: "http", Target: "api"},
			{ID: "e4", Source: "api", Target: "code"},
			{ID: "e5", Source: "code", Target: "end"},
		},
	}

	runtime := NewRuntime(NewInMemoryExecutionStore())
	runtime.executors["llm"] = staticWritebackExecutor{
		output:     map[string]any{"text": "l"},
		writebacks: []Writeback{{TargetPath: "workflow.llmValue", Value: "L"}},
	}
	runtime.executors["http-request"] = staticWritebackExecutor{
		output:     map[string]any{"ok": true},
		writebacks: []Writeback{{TargetPath: "workflow.httpValue", Value: "H"}},
	}
	runtime.executors["api-request"] = staticWritebackExecutor{
		output:     map[string]any{"code": 200},
		writebacks: []Writeback{{TargetPath: "workflow.apiValue", Value: "A"}},
	}
	runtime.executors["code"] = staticWritebackExecutor{
		output:     map[string]any{"raw": "C"},
		writebacks: []Writeback{{TargetPath: "workflow.codeValue", Value: "C"}},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowID:  1,
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("runtime 执行失败：%v", err)
	}

	assertNodeHasWorkflowValue := func(nodeID string, key string, expected any) {
		nodeOut, _ := execution.Variables[nodeID].(map[string]any)
		got, _ := getByPath(nodeOut, "workflow."+key)
		if got != expected {
			t.Fatalf("%s 节点映射输出不符合预期，%s=%v", nodeID, key, got)
		}
	}
	assertNodeHasWorkflowValue("llm", "llmValue", "L")
	assertNodeHasWorkflowValue("http", "httpValue", "H")
	assertNodeHasWorkflowValue("api", "apiValue", "A")
	assertNodeHasWorkflowValue("code", "codeValue", "C")

	debugStore := NewInMemoryDebugSessionStore()
	session, err := runtime.StartDebugSession(context.Background(), debugStore, StartDebugSessionInput{
		WorkflowID:    1,
		WorkflowDSL:   dsl,
		Input:         map[string]any{},
		CreatorUserID: 1,
		TargetNodeID:  "code",
	})
	if err != nil {
		t.Fatalf("debug 执行失败：%v", err)
	}
	got, _ := getByPath(session.LastTargetOutput, "workflow.codeValue")
	if got != "C" {
		t.Fatalf("debug 目标输出应复用映射结果，实际=%v", got)
	}
}
