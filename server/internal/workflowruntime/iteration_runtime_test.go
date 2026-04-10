package workflowruntime

import (
	"context"
	"testing"
)

const iterationSumCode = "function main(input) {\n" +
	"  return { nextTotal: Number({{iter.state.total}} || 0) + Number({{iter.item}} || 0) };\n" +
	"}"

func TestRuntime_IterationState_OutputObject(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "iter",
				Position: map[string]any{"x": 120, "y": 0},
				Data: WorkflowNodeData{
					Title: "iter",
					Type:  "iteration",
					Config: map[string]any{
						"iteratorSource":  "{{workflow.items}}",
						"outputVar":       "resultObj",
						"itemVar":         "item",
						"indexVar":        "index",
						"isParallel":      false,
						"parallelNums":    10,
						"errorHandleMode": "terminated",
						"flattenOutput":   true,
						"children": map[string]any{
							"nodes": []any{
								map[string]any{
									"id":       "iter-start",
									"position": map[string]any{"x": 0, "y": 0},
									"data": map[string]any{
										"title":  "iter-start",
										"type":   "start",
										"config": map[string]any{},
									},
								},
								map[string]any{
									"id":       "sum",
									"position": map[string]any{"x": 120, "y": 0},
									"data": map[string]any{
										"title": "sum",
										"type":  "code",
										"config": map[string]any{
											"language": "javascript",
											"code":     iterationSumCode,
											"outputs":  []any{"nextTotal"},
											"writebackMappings": []any{
												map[string]any{
													"mode":       "value",
													"expression": "nextTotal",
													"targetPath": "iter.state.total",
												},
											},
										},
									},
								},
							},
							"edges": []any{
								map[string]any{"id": "e1", "source": "iter-start", "target": "sum"},
							},
						},
					},
				},
			},
			{ID: "end", Position: map[string]any{"x": 240, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-iter", Source: "start", Target: "iter"},
			{ID: "e-iter-end", Source: "iter", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input: map[string]any{
			"workflow": map[string]any{
				"items": []any{1, 2, 3},
			},
		},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if execution.Status != ExecutionStatusCompleted {
		t.Fatalf("期望执行完成，实际=%s", execution.Status)
	}

	iterOutput, ok := execution.Variables["iter"].(map[string]any)
	if !ok {
		t.Fatalf("迭代节点输出类型错误：%T", execution.Variables["iter"])
	}
	resultObj, ok := iterOutput["resultObj"].(map[string]any)
	if !ok {
		t.Fatalf("迭代结果对象类型错误：%T", iterOutput["resultObj"])
	}
	if got := toFloat(resultObj["total"]); got != 6 {
		t.Fatalf("期望累加 total=6，实际=%v", resultObj["total"])
	}
}

func TestRuntime_IterationState_RejectsParallel(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "iter",
				Position: map[string]any{"x": 120, "y": 0},
				Data: WorkflowNodeData{
					Title: "iter",
					Type:  "iteration",
					Config: map[string]any{
						"iteratorSource":  "{{workflow.items}}",
						"outputVar":       "resultObj",
						"itemVar":         "item",
						"indexVar":        "index",
						"isParallel":      true,
						"parallelNums":    2,
						"errorHandleMode": "terminated",
						"flattenOutput":   true,
						"children": map[string]any{
							"nodes": []any{
								map[string]any{
									"id":       "iter-start",
									"position": map[string]any{"x": 0, "y": 0},
									"data": map[string]any{
										"title":  "iter-start",
										"type":   "start",
										"config": map[string]any{},
									},
								},
							},
							"edges": []any{},
						},
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-iter", Source: "start", Target: "iter"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input: map[string]any{
			"workflow": map[string]any{
				"items": []any{1, 2},
			},
		},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if execution.Status != ExecutionStatusFailed {
		t.Fatalf("期望执行失败，实际=%s", execution.Status)
	}
	if execution.Error == "" {
		t.Fatalf("期望返回并行模式错误")
	}
}
