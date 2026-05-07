package workflowruntime

import (
	"context"
	"testing"
)

func TestValidateAndNormalizeDynamicInputWithVariables_ResolveTemplateDefault(t *testing.T) {
	fields := []DynamicField{
		{Name: "name", Type: "text", DefaultValue: "{{user.name}}"},
		{Name: "profile", Type: "text", DefaultValue: "{{global.profile}}"},
		{Name: "greet", Type: "text", DefaultValue: "你好 {{user.name}}"},
		{Name: "missing", Type: "text", DefaultValue: "{{missing.path}}"},
	}
	variables := map[string]any{
		"user": map[string]any{
			"name": "张三",
		},
		"global": map[string]any{
			"profile": map[string]any{
				"city": "上海",
			},
		},
	}

	normalized, err := ValidateAndNormalizeDynamicInputWithVariables(fields, map[string]any{}, variables)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if normalized["name"] != "张三" {
		t.Fatalf("name expected 张三, got %#v", normalized["name"])
	}
	profile, ok := normalized["profile"].(map[string]any)
	if !ok || profile["city"] != "上海" {
		t.Fatalf("profile expected object map[city:上海], got %#v", normalized["profile"])
	}
	if normalized["greet"] != "你好 张三" {
		t.Fatalf("greet expected 你好 张三, got %#v", normalized["greet"])
	}
	if normalized["missing"] != "" {
		t.Fatalf("missing expected empty string, got %#v", normalized["missing"])
	}
}

func TestInputNodeExecutor_WaitingSchemaResolveDefaultTemplate(t *testing.T) {
	executor := inputNodeExecutor{}
	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node: WorkflowNode{
			ID: "input-1",
			Data: WorkflowNodeData{
				Type: "input",
				Config: map[string]any{
					"fields": []any{
						map[string]any{
							"name":         "name",
							"type":         "text",
							"defaultValue": "{{user.name}}",
						},
						map[string]any{
							"name":         "profile",
							"type":         "text",
							"defaultValue": "{{global.profile}}",
						},
					},
				},
			},
		},
		Variables: map[string]any{
			"user": map[string]any{"name": "李四"},
			"global": map[string]any{
				"profile": map[string]any{"age": 18},
			},
		},
		NodeInput: nil,
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if result.Type != NodeExecutorResultWaitingInput {
		t.Fatalf("expected waiting_input, got %s", result.Type)
	}
	fields, ok := result.Schema["fields"].([]map[string]any)
	if !ok {
		// map[string]any decode path
		raw, ok2 := result.Schema["fields"].([]any)
		if !ok2 || len(raw) < 2 {
			t.Fatalf("schema fields invalid: %#v", result.Schema["fields"])
		}
		first, _ := raw[0].(map[string]any)
		second, _ := raw[1].(map[string]any)
		if first["defaultValue"] != "李四" {
			t.Fatalf("first default expected 李四, got %#v", first["defaultValue"])
		}
		secondObj, ok3 := second["defaultValue"].(map[string]any)
		if !ok3 || secondObj["age"] != 18 {
			t.Fatalf("second default expected object age=18, got %#v", second["defaultValue"])
		}
		return
	}
	if len(fields) < 2 {
		t.Fatalf("schema fields length invalid: %d", len(fields))
	}
	if fields[0]["defaultValue"] != "李四" {
		t.Fatalf("first default expected 李四, got %#v", fields[0]["defaultValue"])
	}
	secondObj, ok := fields[1]["defaultValue"].(map[string]any)
	if !ok || secondObj["age"] != 18 {
		t.Fatalf("second default expected object age=18, got %#v", fields[1]["defaultValue"])
	}
}
