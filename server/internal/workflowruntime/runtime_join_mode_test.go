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

func TestRuntime_Resume_ReenqueuePendingNodesUnlockedByHistory(t *testing.T) {
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
				ID:       "history-ready",
				Position: map[string]any{"x": 120, "y": 0},
				Data: WorkflowNodeData{
					Title: "history-ready",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { ok: true } }",
						"outputs": []any{"ok"},
					},
				},
			},
			{
				ID:       "history-downstream",
				Position: map[string]any{"x": 240, "y": 0},
				Data: WorkflowNodeData{
					Title: "history-downstream",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { ready: true } }",
						"outputs": []any{"ready"},
					},
				},
			},
			{
				ID:       "input",
				Position: map[string]any{"x": 120, "y": 120},
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
				ID:       "after-input",
				Position: map[string]any{"x": 240, "y": 120},
				Data: WorkflowNodeData{
					Title: "after-input",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { resumed: true } }",
						"outputs": []any{"resumed"},
					},
				},
			},
			{
				ID:       "join",
				Position: map[string]any{"x": 360, "y": 60},
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
			{ID: "end", Position: map[string]any{"x": 480, "y": 60}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-history-ready", Source: "start", Target: "history-ready"},
			{ID: "e-start-input", Source: "start", Target: "input"},
			{ID: "e-history-ready-history-downstream", Source: "history-ready", Target: "history-downstream"},
			{ID: "e-input-after-input", Source: "input", Target: "after-input"},
			{ID: "e-history-downstream-join", Source: "history-downstream", Target: "join"},
			{ID: "e-after-input-join", Source: "after-input", Target: "join"},
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
	if waitingExecution.NodeStates["history-ready"].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望 history-ready 在暂停前已执行成功，实际=%s", waitingExecution.NodeStates["history-ready"].Status)
	}
	if waitingExecution.NodeStates["history-downstream"].Status != NodeRunStatusPending {
		t.Fatalf("期望 history-downstream 在暂停前仍为 pending，实际=%s", waitingExecution.NodeStates["history-downstream"].Status)
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

	if resumedExecution.NodeStates["history-downstream"].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望 history-downstream 在 resume 后执行成功，实际=%s", resumedExecution.NodeStates["history-downstream"].Status)
	}
	if resumedExecution.NodeStates["join"].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望 join 在 resume 后执行成功，实际=%s", resumedExecution.NodeStates["join"].Status)
	}
	if resumedExecution.NodeStates["end"].Status != NodeRunStatusSucceeded {
		t.Fatalf("期望 end 在 resume 后执行成功，实际=%s", resumedExecution.NodeStates["end"].Status)
	}
}

func TestRuntime_FreshStart_DoesNotReenqueuePendingNodes(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "prepare",
				Position: map[string]any{"x": 100, "y": 0},
				Data: WorkflowNodeData{
					Title: "prepare",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { code: 'ok' } }",
						"outputs": []any{"code"},
					},
				},
			},
			{
				ID:       "need-upstream",
				Position: map[string]any{"x": 220, "y": 0},
				Data: WorkflowNodeData{
					Title: "need-upstream",
					Type:  "api-request",
					Config: map[string]any{
						"route": map[string]any{
							"method": "GET",
							"path":   "/demo",
						},
						"params": []any{
							map[string]any{
								"name": "code",
								"in":   "query",
								"type": "string",
								"validation": map[string]any{
									"required": true,
								},
							},
						},
						"paramValues": []any{
							map[string]any{
								"name":  "code",
								"in":    "query",
								"value": "{{prepare.code}}",
							},
						},
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-prepare", Source: "start", Target: "prepare"},
			{ID: "e-prepare-need-upstream", Source: "prepare", Target: "need-upstream"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	prepareStarted := findEventIndex(t, execution.Events, "node.started", "prepare")
	needUpstreamStarted := findEventIndex(t, execution.Events, "node.started", "need-upstream")
	if needUpstreamStarted <= prepareStarted {
		t.Fatalf("期望 fresh start 按依赖顺序执行：prepareStarted=%d needUpstreamStarted=%d", prepareStarted, needUpstreamStarted)
	}
}

func TestRuntime_Resume_DoesNotEnqueueSingleIncomingNodeWithoutHistoryArrival(t *testing.T) {
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
				ID:       "done-before-pause",
				Position: map[string]any{"x": 120, "y": 0},
				Data: WorkflowNodeData{
					Title: "done-before-pause",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { ok: true } }",
						"outputs": []any{"ok"},
					},
				},
			},
			{
				ID:       "single-downstream",
				Position: map[string]any{"x": 240, "y": 0},
				Data: WorkflowNodeData{
					Title: "single-downstream",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { value: true } }",
						"outputs": []any{"value"},
					},
				},
			},
			{
				ID:       "input",
				Position: map[string]any{"x": 120, "y": 120},
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
				ID:       "resume-downstream",
				Position: map[string]any{"x": 240, "y": 120},
				Data: WorkflowNodeData{
					Title: "resume-downstream",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { return { value: true } }",
						"outputs": []any{"value"},
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-done-before-pause", Source: "start", Target: "done-before-pause"},
			{ID: "e-start-input", Source: "start", Target: "input"},
			{ID: "e-input-resume-downstream", Source: "input", Target: "resume-downstream"},
			{ID: "e-resume-downstream-single-downstream", Source: "resume-downstream", Target: "single-downstream"},
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

	resumeDownstreamStarted := findEventIndex(t, resumedExecution.Events, "node.started", "resume-downstream")
	singleDownstreamStarted := findEventIndex(t, resumedExecution.Events, "node.started", "single-downstream")
	if singleDownstreamStarted <= resumeDownstreamStarted {
		t.Fatalf("期望单入边节点仅在其真实上游到达后执行：resumeDownstreamStarted=%d singleDownstreamStarted=%d", resumeDownstreamStarted, singleDownstreamStarted)
	}
}

func TestRuntime_NodeFinishedEvent_AfterSuccess(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{ID: "end", Position: map[string]any{"x": 100, "y": 0}, Data: WorkflowNodeData{Title: "end", Type: "end", Config: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-end", Source: "start", Target: "end"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	endSucceeded := findEventIndex(t, execution.Events, "node.succeeded", "end")
	endFinished := findEventIndex(t, execution.Events, "node.finished", "end")
	if endFinished <= endSucceeded {
		t.Fatalf("期望 node.finished 紧跟成功事件之后：endSucceeded=%d endFinished=%d", endSucceeded, endFinished)
	}
	event := findEvent(t, execution.Events, "node.finished", "end")
	status, _ := event.Payload["status"].(string)
	if status != string(NodeRunStatusSucceeded) {
		t.Fatalf("期望 finished.status=%q，实际=%q", NodeRunStatusSucceeded, status)
	}
	if _, ok := event.Payload["endedAt"].(string); !ok {
		t.Fatalf("期望 finished.endedAt 为字符串")
	}
}

func TestRuntime_NodeFinishedEvent_AfterWaitingInput(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "input",
				Position: map[string]any{"x": 100, "y": 0},
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
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-input", Source: "start", Target: "input"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if execution.Status != ExecutionStatusWaitingInput {
		t.Fatalf("期望 execution waiting_input，实际=%s", execution.Status)
	}

	waitingEvent := findEventIndex(t, execution.Events, "node.waiting_input", "input")
	finishedEvent := findEventIndex(t, execution.Events, "node.finished", "input")
	if finishedEvent <= waitingEvent {
		t.Fatalf("期望 waiting_input 后立即追加 node.finished：waiting=%d finished=%d", waitingEvent, finishedEvent)
	}
	event := findEvent(t, execution.Events, "node.finished", "input")
	status, _ := event.Payload["status"].(string)
	if status != string(NodeRunStatusWaitingInput) {
		t.Fatalf("期望 finished.status=%q，实际=%q", NodeRunStatusWaitingInput, status)
	}
}

func TestRuntime_NodeFinishedEvent_AfterFailure(t *testing.T) {
	store := NewInMemoryExecutionStore()
	runtime := NewRuntime(store)

	dsl := WorkflowDSL{
		Nodes: []WorkflowNode{
			{ID: "start", Position: map[string]any{"x": 0, "y": 0}, Data: WorkflowNodeData{Title: "start", Type: "start", Config: map[string]any{}}},
			{
				ID:       "broken",
				Position: map[string]any{"x": 100, "y": 0},
				Data: WorkflowNodeData{
					Title: "broken",
					Type:  "code",
					Config: map[string]any{
						"code":    "function main(input) { throw new Error('boom') }",
						"outputs": []any{},
					},
				},
			},
		},
		Edges: []WorkflowEdge{
			{ID: "e-start-broken", Source: "start", Target: "broken"},
		},
	}

	execution, err := runtime.Start(context.Background(), StartExecutionInput{
		WorkflowDSL: dsl,
		Input:       map[string]any{},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if execution.Status != ExecutionStatusFailed {
		t.Fatalf("期望 execution failed，实际=%s", execution.Status)
	}

	failedEvent := findEventIndex(t, execution.Events, "node.failed", "broken")
	finishedEvent := findEventIndex(t, execution.Events, "node.finished", "broken")
	if finishedEvent <= failedEvent {
		t.Fatalf("期望 node.failed 后立即追加 node.finished：failed=%d finished=%d", failedEvent, finishedEvent)
	}
	event := findEvent(t, execution.Events, "node.finished", "broken")
	status, _ := event.Payload["status"].(string)
	if status != string(NodeRunStatusFailed) {
		t.Fatalf("期望 finished.status=%q，实际=%q", NodeRunStatusFailed, status)
	}
	if _, ok := event.Payload["error"].(string); !ok {
		t.Fatalf("期望 failed 场景下 finished.error 存在")
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

func findEvent(t *testing.T, events []ExecutionEvent, typ string, nodeID string) ExecutionEvent {
	t.Helper()
	for _, event := range events {
		if event.Type != typ {
			continue
		}
		if event.Payload == nil {
			continue
		}
		id, _ := event.Payload["nodeId"].(string)
		if id == nodeID {
			return event
		}
	}
	t.Fatalf("未找到事件 typ=%q nodeId=%q", typ, nodeID)
	return ExecutionEvent{}
}
