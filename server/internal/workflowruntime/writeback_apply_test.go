package workflowruntime

import "testing"

func TestApplyWritebacks_IgnoreEmptyTargetPath(t *testing.T) {
	variables := map[string]any{
		"workflow": map[string]any{"name": "kept"},
	}
	applyWritebacks(variables, []Writeback{
		{TargetPath: "  ", Value: "x"},
	}, writebackApplyOptions{ProtectReservedRoots: true})

	workflow, _ := variables["workflow"].(map[string]any)
	if workflow["name"] != "kept" {
		t.Fatalf("空目标路径应忽略，实际=%v", workflow["name"])
	}
}

func TestApplyWritebacks_ProtectReservedRoot(t *testing.T) {
	variables := map[string]any{
		"workflow": map[string]any{"name": "kept"},
	}
	applyWritebacks(variables, []Writeback{
		{TargetPath: "workflow", Value: "bad"},
		{TargetPath: "workflow.name", Value: "updated"},
	}, writebackApplyOptions{ProtectReservedRoots: true})

	if _, ok := variables["workflow"].(map[string]any); !ok {
		t.Fatalf("保留根不应被覆盖为非对象：%T", variables["workflow"])
	}
	workflow, _ := variables["workflow"].(map[string]any)
	if workflow["name"] != "updated" {
		t.Fatalf("workflow.xxx 应允许写入，实际=%v", workflow["name"])
	}
}

func TestApplyWritebacks_ArrayAppendAndOverride(t *testing.T) {
	variables := map[string]any{
		"workflow": map[string]any{
			"trace": []any{"a"},
			"tags":  "legacy",
		},
	}
	applyWritebacks(variables, []Writeback{
		{TargetPath: "workflow.trace[]", Value: []any{"b", "c"}},
		{TargetPath: "workflow.tags[]", Value: []any{"x"}},
	}, writebackApplyOptions{ProtectReservedRoots: true})

	trace, _ := getByPath(variables, "workflow.trace")
	traceList, _ := trace.([]any)
	if len(traceList) != 3 || traceList[0] != "a" || traceList[1] != "b" || traceList[2] != "c" {
		t.Fatalf("数组追加不符合预期：%v", trace)
	}

	tags, _ := getByPath(variables, "workflow.tags")
	tagsList, _ := tags.([]any)
	if len(tagsList) != 1 || tagsList[0] != "x" {
		t.Fatalf("非数组旧值应被新数组覆盖：%v", tags)
	}
}

func TestMapOutputByWritebacks_UseSameRule(t *testing.T) {
	output := map[string]any{"raw": "ok"}
	mapped := mapOutputByWritebacks(output, []Writeback{
		{TargetPath: "workflow.score", Value: float64(88)},
		{TargetPath: "workflow.tags[]", Value: []any{"A"}},
	})

	if mapped["raw"] != "ok" {
		t.Fatalf("应保留原始输出：%v", mapped["raw"])
	}
	score, _ := getByPath(mapped, "workflow.score")
	if score != float64(88) {
		t.Fatalf("映射输出 score 不符合预期：%v", score)
	}
	tags, _ := getByPath(mapped, "workflow.tags")
	tagList, _ := tags.([]any)
	if len(tagList) != 1 || tagList[0] != "A" {
		t.Fatalf("映射输出 tags 不符合预期：%v", tags)
	}
}
