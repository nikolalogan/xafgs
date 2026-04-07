package workflowruntime

import (
	"context"
	"encoding/json"
	"testing"
)

func TestCodeExecutor_InputIsClonedForScript(t *testing.T) {
	executor := codeNodeExecutor{}
	node := WorkflowNode{
		ID: "node-code",
		Data: WorkflowNodeData{
			Type: "code",
			Config: map[string]any{
				"code": "function main(input) { return { result: input } }",
			},
		},
	}

	variables := map[string]any{
		"workflow": map[string]any{
			"token": "A",
		},
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: variables,
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望成功，实际=%s，错误=%s", result.Type, result.Error)
	}
	if _, marshalErr := json.Marshal(result.Output); marshalErr != nil {
		t.Fatalf("输出应可序列化，实际错误=%v", marshalErr)
	}

	resultObj, ok := result.Output["result"].(map[string]any)
	if !ok {
		t.Fatalf("result 字段类型错误：%T", result.Output["result"])
	}
	workflowObj, ok := resultObj["workflow"].(map[string]any)
	if !ok {
		t.Fatalf("result.workflow 类型错误：%T", resultObj["workflow"])
	}
	workflowObj["token"] = "B"

	originalWorkflow, _ := variables["workflow"].(map[string]any)
	if got := originalWorkflow["token"]; got != "A" {
		t.Fatalf("修改脚本入参副本不应影响原变量，实际 token=%v", got)
	}
}

func TestCodeExecutor_FailsWhenInputContainsCycle(t *testing.T) {
	executor := codeNodeExecutor{}
	node := WorkflowNode{
		ID: "node-code",
		Data: WorkflowNodeData{
			Type: "code",
			Config: map[string]any{
				"code": "function main(input) { return { result: input } }",
			},
		},
	}

	cycle := map[string]any{}
	cycle["self"] = cycle
	variables := map[string]any{
		"workflow": cycle,
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: variables,
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultFailed {
		t.Fatalf("期望失败，实际=%s", result.Type)
	}
	if result.Error == "" {
		t.Fatalf("失败时应返回明确错误信息")
	}
}

