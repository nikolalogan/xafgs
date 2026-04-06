package workflowruntime

import "testing"

func TestBuildWritebacks_ArrayItemMapping_AggregatesByIndex(t *testing.T) {
	output := map[string]any{
		"data": map[string]any{
			"baseInfo": map[string]any{
				"blueHeadLabels": []any{
					map[string]any{
						"labelName": "标签A",
						"bgColor":   "#1890ff",
					},
					map[string]any{
						"labelName": "标签B",
					},
				},
			},
		},
	}

	mappings := []any{
		map[string]any{
			"sourcePath": "data.baseInfo.blueHeadLabels[].labelName",
			"targetPath": "entp.tags[].title",
		},
		map[string]any{
			"sourcePath": "data.baseInfo.blueHeadLabels[].bgColor",
			"targetPath": "entp.tags[].color",
		},
	}

	writebacks := buildWritebacks(mappings, output)
	if len(writebacks) != 1 {
		t.Fatalf("期望仅生成 1 条数组写回，实际=%d", len(writebacks))
	}
	if writebacks[0].TargetPath != "entp.tags[]" {
		t.Fatalf("数组写回应写入 entp.tags[]，实际=%q", writebacks[0].TargetPath)
	}

	items, ok := writebacks[0].Value.([]any)
	if !ok {
		t.Fatalf("数组写回值类型错误：%T", writebacks[0].Value)
	}
	if len(items) != 2 {
		t.Fatalf("期望生成 2 个对象，实际=%d", len(items))
	}

	first, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("第 1 项类型错误：%T", items[0])
	}
	if first["title"] != "标签A" || first["color"] != "#1890ff" {
		t.Fatalf("第 1 项内容不符合预期：%v", first)
	}

	second, ok := items[1].(map[string]any)
	if !ok {
		t.Fatalf("第 2 项类型错误：%T", items[1])
	}
	if second["title"] != "标签B" {
		t.Fatalf("第 2 项 title 不符合预期：%v", second["title"])
	}
	if second["color"] != "" {
		t.Fatalf("第 2 项缺失字段应写空字符串，实际=%v", second["color"])
	}
}
