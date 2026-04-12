package workflowruntime

import (
	"context"
	"testing"
)

const iterationSumCode = "function main(input) {\n" +
	"  return { nextTotal: Number({{iter.state.total}} || 0) + Number({{iter.item}} || 0) };\n" +
	"}"

const iterationSumWithFailureCode = "function main(input) {\n" +
	"  if (Number({{iter.item}}) === 2) {\n" +
	"    throw new Error('item 2 failed');\n" +
	"  }\n" +
	"  return { nextTotal: Number({{iter.state.total}} || 0) + Number({{iter.item}} || 0) };\n" +
	"}"

func TestRuntime_IterationEndOutputs_AggregatesByName(t *testing.T) {
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
						"iteratorSource": "{{workflow.items}}",
						"outputVar":      "results",
						"itemVar":        "item",
						"indexVar":       "index",
						"isParallel":     false,
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
									"id":       "code-1",
									"position": map[string]any{"x": 120, "y": 0},
									"data": map[string]any{
										"title": "code-1",
										"type":  "code",
										"config": map[string]any{
											"language": "javascript",
											"code":     "function main(){ return { result: String({{iter.item.code}}), level: String({{iter.item.level}}) }; }",
											"outputs":  []any{"result", "level"},
										},
									},
								},
								map[string]any{
									"id":       "iter-end",
									"position": map[string]any{"x": 240, "y": 0},
									"data": map[string]any{
										"title": "iter-end",
										"type":  "end",
										"config": map[string]any{
											"outputs": []any{
												map[string]any{"name": "codes", "source": "{{code-1.result}}"},
												map[string]any{"name": "levels", "source": "{{code-1.level}}"},
											},
										},
									},
								},
							},
							"edges": []any{
								map[string]any{"id": "e1", "source": "iter-start", "target": "code-1"},
								map[string]any{"id": "e2", "source": "code-1", "target": "iter-end"},
							},
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
				"items": []any{
					map[string]any{"code": "410000", "level": "L1"},
					map[string]any{"code": "411300", "level": "L2"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	iterOutput, ok := execution.Variables["iter"].(map[string]any)
	if !ok {
		t.Fatalf("迭代节点输出类型错误：%T", execution.Variables["iter"])
	}
	resultObj, ok := iterOutput["results"].(map[string]any)
	if !ok {
		t.Fatalf("迭代结果对象类型错误：%T", iterOutput["results"])
	}
	codes, ok := resultObj["codes"].([]any)
	if !ok || len(codes) != 2 || toString(codes[0]) != "410000" || toString(codes[1]) != "411300" {
		t.Fatalf("期望聚合 codes 正确，实际=%v", resultObj["codes"])
	}
	levels, ok := resultObj["levels"].([]any)
	if !ok || len(levels) != 2 || toString(levels[0]) != "L1" || toString(levels[1]) != "L2" {
		t.Fatalf("期望聚合 levels 正确，实际=%v", resultObj["levels"])
	}
}

func TestRuntime_IterationEndOutputs_SupportsLegacyNestedReference(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "node-116",
				Position: map[string]any{"x": 120, "y": 0},
				Data: WorkflowNodeData{
					Title: "iter",
					Type:  "iteration",
					Config: map[string]any{
						"iteratorSource": "{{workflow.items}}",
						"outputVar":      "results",
						"itemVar":        "item",
						"indexVar":       "index",
						"isParallel":     false,
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
									"id":       "sub-node-1",
									"position": map[string]any{"x": 120, "y": 0},
									"data": map[string]any{
										"title": "sub-node-1",
										"type":  "code",
										"config": map[string]any{
											"language": "javascript",
											"code":     "function main(){ return { text: String({{node-116.item}}) }; }",
											"outputs":  []any{"text"},
										},
									},
								},
								map[string]any{
									"id":       "iter-end",
									"position": map[string]any{"x": 240, "y": 0},
									"data": map[string]any{
										"title": "iter-end",
										"type":  "end",
										"config": map[string]any{
											"outputs": []any{
												map[string]any{"name": "result", "source": "{{iter-node::node-116::sub-node-1.text}}"},
											},
										},
									},
								},
							},
							"edges": []any{
								map[string]any{"id": "e1", "source": "iter-start", "target": "sub-node-1"},
								map[string]any{"id": "e2", "source": "sub-node-1", "target": "iter-end"},
							},
						},
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-iter", Source: "start", Target: "node-116"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input: map[string]any{
			"workflow": map[string]any{
				"items": []any{"a", "b"},
			},
		},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	iterOutput := execution.Variables["node-116"].(map[string]any)["results"].(map[string]any)
	result := iterOutput["result"].([]any)
	if len(result) != 2 || toString(result[0]) != "a" || toString(result[1]) != "b" {
		t.Fatalf("期望兼容旧嵌套引用，实际=%v", result)
	}
}

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

	trace, ok := execution.IterationTraces["iter"]
	if !ok {
		t.Fatalf("期望存在迭代执行详情")
	}
	if trace.ItemVar != "item" || trace.IndexVar != "index" {
		t.Fatalf("期望迭代变量信息被保留，实际 itemVar=%s indexVar=%s", trace.ItemVar, trace.IndexVar)
	}
	if len(trace.Items) != 3 {
		t.Fatalf("期望记录 3 个迭代项，实际=%d", len(trace.Items))
	}
	for index, item := range trace.Items {
		if item.Index != index {
			t.Fatalf("期望第 %d 项索引正确，实际=%d", index, item.Index)
		}
		if item.Status != NodeRunStatusSucceeded {
			t.Fatalf("期望第 %d 项执行成功，实际=%s", index, item.Status)
		}
		if len(item.ChildNodes) != 2 {
			t.Fatalf("期望第 %d 项有 2 个子节点详情，实际=%d", index, len(item.ChildNodes))
		}
		if item.ChildNodes[1].NodeID != "sum" {
			t.Fatalf("期望记录 sum 节点，实际=%s", item.ChildNodes[1].NodeID)
		}
		if item.ChildNodes[1].Status != NodeRunStatusSucceeded {
			t.Fatalf("期望 sum 节点成功，实际=%s", item.ChildNodes[1].Status)
		}
		if item.ChildNodes[1].Output == nil {
			t.Fatalf("期望 sum 节点输出被记录")
		}
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

func TestRuntime_IterationTrace_ContinueOnError(t *testing.T) {
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
						"errorHandleMode": "continue-on-error",
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
											"code":     iterationSumWithFailureCode,
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

	trace, ok := execution.IterationTraces["iter"]
	if !ok {
		t.Fatalf("期望存在迭代执行详情")
	}
	if len(trace.Items) != 3 {
		t.Fatalf("期望记录 3 个迭代项，实际=%d", len(trace.Items))
	}
	if trace.Items[0].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望第 1 项成功，实际=%s", trace.Items[0].Status)
	}
	if trace.Items[1].Status != NodeRunStatusFailed {
		t.Fatalf("期望第 2 项失败，实际=%s", trace.Items[1].Status)
	}
	if trace.Items[1].Error == "" {
		t.Fatalf("期望第 2 项保留错误信息")
	}
	if len(trace.Items[1].ChildNodes) != 2 {
		t.Fatalf("期望失败项仍记录完整子节点详情，实际=%d", len(trace.Items[1].ChildNodes))
	}
	if trace.Items[1].ChildNodes[1].Status != NodeRunStatusFailed {
		t.Fatalf("期望失败子节点状态正确，实际=%s", trace.Items[1].ChildNodes[1].Status)
	}
	if trace.Items[2].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望第 3 项继续成功，实际=%s", trace.Items[2].Status)
	}

	iterOutput, ok := execution.Variables["iter"].(map[string]any)
	if !ok {
		t.Fatalf("迭代节点输出类型错误：%T", execution.Variables["iter"])
	}
	resultObj, ok := iterOutput["resultObj"].(map[string]any)
	if !ok {
		t.Fatalf("迭代结果对象类型错误：%T", iterOutput["resultObj"])
	}
	if got := toFloat(resultObj["total"]); got != 4 {
		t.Fatalf("期望跳过失败项后 total=4，实际=%v", resultObj["total"])
	}
}
