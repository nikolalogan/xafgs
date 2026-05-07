package workflowruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPIRequestExecutor_UseConfigParamValuesWhenNodeInputEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"queryName": r.URL.Query().Get("name"),
			},
		})
	}))
	defer server.Close()
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	node := WorkflowNode{
		ID:       "api",
		Position: map[string]any{"x": 0, "y": 0},
		Data: WorkflowNodeData{
			Title: "api",
			Type:  "api-request",
			Config: map[string]any{
				"route": map[string]any{
					"method": "GET",
					"path":   "/test",
				},
				"params": []any{
					map[string]any{
						"in":   "query",
						"name": "name",
						"validation": map[string]any{
							"required": true,
						},
					},
				},
				"paramValues": []any{
					map[string]any{"in": "query", "name": "name", "value": "from-config"},
				},
			},
		},
	}

	result, err := (apiRequestExecutor{}).Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{},
		NodeInput: map[string]any{},
	})
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望 success，实际=%s error=%s", result.Type, result.Error)
	}
	got := toObject(result.Output["response"])["queryName"]
	if got != "from-config" {
		t.Fatalf("期望使用配置值 from-config，实际=%v", got)
	}
}

func TestAPIRequestExecutor_NodeInputOverridesConfigParamValues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"queryName": r.URL.Query().Get("name"),
			},
		})
	}))
	defer server.Close()
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	node := WorkflowNode{
		ID:       "api",
		Position: map[string]any{"x": 0, "y": 0},
		Data: WorkflowNodeData{
			Title: "api",
			Type:  "api-request",
			Config: map[string]any{
				"route": map[string]any{
					"method": "GET",
					"path":   "/test",
				},
				"params": []any{
					map[string]any{
						"in":   "query",
						"name": "name",
						"validation": map[string]any{
							"required": true,
						},
					},
				},
				"paramValues": []any{
					map[string]any{"in": "query", "name": "name", "value": "from-config"},
				},
			},
		},
	}

	result, err := (apiRequestExecutor{}).Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{},
		NodeInput: map[string]any{"query:name": "from-debug"},
	})
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望 success，实际=%s error=%s", result.Type, result.Error)
	}
	got := toObject(result.Output["response"])["queryName"]
	if got != "from-debug" {
		t.Fatalf("期望使用调试输入 from-debug，实际=%v", got)
	}
}

func TestAPIRequestExecutor_MissingRequiredStillFails(t *testing.T) {
	node := WorkflowNode{
		ID:       "api",
		Position: map[string]any{"x": 0, "y": 0},
		Data: WorkflowNodeData{
			Title: "api",
			Type:  "api-request",
			Config: map[string]any{
				"route": map[string]any{
					"method": "GET",
					"path":   "/test",
				},
				"params": []any{
					map[string]any{
						"in":   "query",
						"name": "name",
						"validation": map[string]any{
							"required": true,
						},
					},
				},
				"paramValues": []any{},
			},
		},
	}

	result, err := (apiRequestExecutor{}).Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{},
		NodeInput: map[string]any{},
	})
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if result.Type != NodeExecutorResultFailed {
		t.Fatalf("期望 failed，实际=%s", result.Type)
	}
	if result.Error != "必填参数未配置：query.name" {
		t.Fatalf("期望缺参报错文案不变，实际=%s", result.Error)
	}
}

func TestAPIRequestExecutor_StartVariableFallbackToTopLevel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"shortName": r.URL.Query().Get("shortName"),
			},
		})
	}))
	defer server.Close()
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	node := WorkflowNode{
		ID:       "api",
		Position: map[string]any{"x": 0, "y": 0},
		Data: WorkflowNodeData{
			Title: "api",
			Type:  "api-request",
			Config: map[string]any{
				"route": map[string]any{
					"method": "GET",
					"path":   "/test",
				},
				"params": []any{
					map[string]any{
						"in":   "query",
						"name": "shortName",
						"validation": map[string]any{
							"required": true,
						},
					},
				},
				"paramValues": []any{
					map[string]any{"in": "query", "name": "shortName", "value": "{{start.entpname}}"},
				},
			},
		},
	}

	result, err := (apiRequestExecutor{}).Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{"entpname": "南阳财和投资有限公司"},
		NodeInput: map[string]any{},
	})
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望 success，实际=%s error=%s", result.Type, result.Error)
	}
	got := toObject(result.Output["response"])["shortName"]
	if got != "南阳财和投资有限公司" {
		t.Fatalf("期望 start 回退命中顶层变量，实际=%v", got)
	}
}

func TestAPIRequestExecutor_StartVariablePreferRealStartPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"shortName": r.URL.Query().Get("shortName"),
			},
		})
	}))
	defer server.Close()
	t.Setenv("INTERNAL_API_BASE_URL", server.URL)

	node := WorkflowNode{
		ID:       "api",
		Position: map[string]any{"x": 0, "y": 0},
		Data: WorkflowNodeData{
			Title: "api",
			Type:  "api-request",
			Config: map[string]any{
				"route": map[string]any{
					"method": "GET",
					"path":   "/test",
				},
				"params": []any{
					map[string]any{
						"in":   "query",
						"name": "shortName",
						"validation": map[string]any{
							"required": true,
						},
					},
				},
				"paramValues": []any{
					map[string]any{"in": "query", "name": "shortName", "value": "{{start.entpname}}"},
				},
			},
		},
	}

	result, err := (apiRequestExecutor{}).Execute(context.Background(), NodeExecutorContext{
		Node: node,
		Variables: map[string]any{
			"entpname": "top-level",
			"start":    map[string]any{"entpname": "from-start"},
		},
		NodeInput: map[string]any{},
	})
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望 success，实际=%s error=%s", result.Type, result.Error)
	}
	got := toObject(result.Output["response"])["shortName"]
	if got != "from-start" {
		t.Fatalf("期望优先命中 start.entpname，实际=%v", got)
	}
}

func TestAPIRequestExecutor_StartVariableMissingStillFails(t *testing.T) {
	node := WorkflowNode{
		ID:       "api",
		Position: map[string]any{"x": 0, "y": 0},
		Data: WorkflowNodeData{
			Title: "api",
			Type:  "api-request",
			Config: map[string]any{
				"route": map[string]any{
					"method": "GET",
					"path":   "/test",
				},
				"params": []any{
					map[string]any{
						"in":   "query",
						"name": "shortName",
						"validation": map[string]any{
							"required": true,
						},
					},
				},
				"paramValues": []any{
					map[string]any{"in": "query", "name": "shortName", "value": "{{start.entpname}}"},
				},
			},
		},
	}

	result, err := (apiRequestExecutor{}).Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{},
		NodeInput: map[string]any{},
	})
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if result.Type != NodeExecutorResultFailed {
		t.Fatalf("期望 failed，实际=%s", result.Type)
	}
	if result.Error != "必填参数未配置：query.shortName" {
		t.Fatalf("期望缺参报错文案不变，实际=%s", result.Error)
	}
}
