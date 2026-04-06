package workflowruntime

import "testing"

func TestBuildHTTPWritebacks_DataPrefixAliasResolvesFromBody(t *testing.T) {
	parsed := map[string]any{
		"result": map[string]any{
			"cached_file": ".auth/huiyan_jsessionid_062212.json",
			"jsessionid":  "30D208B4F685C52D933CE217766719A8",
		},
	}
	output := map[string]any{
		"body":   parsed,
		"ok":     true,
		"raw":    "{\"result\":{\"jsessionid\":\"30D208B4F685C52D933CE217766719A8\",\"cached_file\":\".auth/huiyan_jsessionid_062212.json\"}}",
		"status": 200,
	}
	mappings := []any{
		map[string]any{
			"sourcePath": "data.result.jsessionid",
			"targetPath": "workflow.token",
		},
	}

	writebacks := buildHTTPWritebacks(mappings, parsed, output)
	if len(writebacks) != 1 {
		t.Fatalf("期望写回 1 条，实际=%d", len(writebacks))
	}
	if writebacks[0].TargetPath != "workflow.token" {
		t.Fatalf("目标路径不符合预期：%q", writebacks[0].TargetPath)
	}
	if got, ok := writebacks[0].Value.(string); !ok || got != "30D208B4F685C52D933CE217766719A8" {
		t.Fatalf("写回值不符合预期：%T %v", writebacks[0].Value, writebacks[0].Value)
	}
}

func TestBuildHTTPWritebacks_MissingSourcePathShouldNotOverwriteExistingValue(t *testing.T) {
	parsed := map[string]any{
		"result": map[string]any{
			"jsessionid": "30D208B4F685C52D933CE217766719A8",
		},
	}
	output := map[string]any{
		"body":   parsed,
		"ok":     true,
		"status": 200,
	}
	mappings := []any{
		map[string]any{
			"sourcePath": "data.result.token_not_exists",
			"targetPath": "workflow.token",
		},
	}
	variables := map[string]any{
		"workflow": map[string]any{
			"token": "kept-token",
		},
	}

	writebacks := buildHTTPWritebacks(mappings, parsed, output)
	if len(writebacks) != 0 {
		t.Fatalf("未命中 sourcePath 时不应生成写回，实际=%d", len(writebacks))
	}

	for _, item := range writebacks {
		setByPath(variables, item.TargetPath, item.Value)
	}
	value, _ := getByPath(variables, "workflow.token")
	if value != "kept-token" {
		t.Fatalf("未命中写回不应覆盖原值，实际=%v", value)
	}
}
