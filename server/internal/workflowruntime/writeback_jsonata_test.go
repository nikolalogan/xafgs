package workflowruntime

import "testing"

func TestBuildWritebacks_JSONataExpressionValueMode(t *testing.T) {
	output := map[string]any{
		"data": map[string]any{
			"id":   "A-1",
			"name": "企业A",
		},
	}
	mappings := []any{
		map[string]any{
			"expression": "data.id",
			"targetPath": "workflow.entpId",
		},
	}
	writebacks := buildWritebacks(mappings, output)
	if len(writebacks) != 1 {
		t.Fatalf("期望写回 1 条，实际=%d", len(writebacks))
	}
	if writebacks[0].TargetPath != "workflow.entpId" {
		t.Fatalf("targetPath 不符合预期：%q", writebacks[0].TargetPath)
	}
	if got, ok := writebacks[0].Value.(string); !ok || got != "A-1" {
		t.Fatalf("写回值不符合预期：%T %v", writebacks[0].Value, writebacks[0].Value)
	}
}

func TestBuildWritebacks_JSONataExpressionWritebacksMode(t *testing.T) {
	output := map[string]any{
		"data": map[string]any{
			"id": "A-2",
		},
	}
	mappings := []any{
		map[string]any{
			"mode":       "writebacks",
			"expression": "{\"workflow.entpId\": data.id, \"workflow.source\": \"jsonata\"}",
		},
	}
	writebacks := buildWritebacks(mappings, output)
	if len(writebacks) != 2 {
		t.Fatalf("期望写回 2 条，实际=%d", len(writebacks))
	}
	got := map[string]any{}
	for _, item := range writebacks {
		got[item.TargetPath] = item.Value
	}
	if got["workflow.entpId"] != "A-2" {
		t.Fatalf("workflow.entpId 不符合预期：%v", got["workflow.entpId"])
	}
	if got["workflow.source"] != "jsonata" {
		t.Fatalf("workflow.source 不符合预期：%v", got["workflow.source"])
	}
}
