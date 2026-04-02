package service

import (
	"fmt"
	"strings"
)

func toTrimmedString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
}

func enrichTemplateContext(root map[string]any) {
	if root == nil {
		return
	}
	enrichAreaEconomyPivot(root)
}

func enrichAreaEconomyPivot(root map[string]any) {
	setPivot := func(target map[string]any, pivot map[string]any) {
		if target == nil || pivot == nil {
			return
		}
		if _, exists := target["areaEconomyPivot"]; !exists {
			target["areaEconomyPivot"] = pivot
		}
	}

	attachPivot := func(target map[string]any) {
		if target == nil {
			return
		}
		area, ok := target["areaEconomy"].([]any)
		if !ok || len(area) == 0 {
			return
		}
		pivot := buildAreaEconomyPivot(area)
		if pivot == nil {
			return
		}
		setPivot(target, pivot)
		// 兜底：同时挂到根上，方便模板直接访问
		setPivot(root, pivot)
	}

	// 1) context 直接是 result
	attachPivot(root)

	// 2) result
	if value, ok := root["result"].(map[string]any); ok {
		attachPivot(value)
	}

	// 3) report.result
	if report, ok := root["report"].(map[string]any); ok {
		if value, ok := report["result"].(map[string]any); ok {
			attachPivot(value)
		}
	}

	// 4) output.result
	if output, ok := root["output"].(map[string]any); ok {
		if value, ok := output["result"].(map[string]any); ok {
			attachPivot(value)
		}
	}
}

func buildAreaEconomyPivot(areaEconomy []any) map[string]any {
	type subject struct {
		name  string
		unit  string
		label string
		key   string
	}

	years := make([]string, 0, len(areaEconomy))
	yearSeen := map[string]bool{}
	yearMaps := make([]map[string]string, 0, len(areaEconomy))

	subjects := make([]subject, 0, 32)
	subjectSeen := map[string]bool{}

	for _, rawYear := range areaEconomy {
		yearObj, ok := rawYear.(map[string]any)
		if !ok {
			continue
		}
		endDate := toTrimmedString(yearObj["endDate"])
		if endDate == "" {
			continue
		}
		if yearSeen[endDate] {
			continue
		}
		yearSeen[endDate] = true
		years = append(years, endDate)

		indicators, _ := yearObj["indicatorList"].([]any)
		valueMap := map[string]string{}
		for _, rawIndic := range indicators {
			indicObj, ok := rawIndic.(map[string]any)
			if !ok {
				continue
			}
			name := toTrimmedString(indicObj["indicName"])
			if name == "" {
				continue
			}
			unit := toTrimmedString(indicObj["displayCUnit"])
			key := name + "||" + unit

			if !subjectSeen[key] {
				subjectSeen[key] = true
				label := name
				if unit != "" {
					label = name + "（" + unit + "）"
				}
				subjects = append(subjects, subject{
					name:  name,
					unit:  unit,
					label: label,
					key:   key,
				})
			}

			// 同一年度可能存在重复科目：优先保留第一个非空值
			nextValue := toTrimmedString(indicObj["mValue"])
			if existing, exists := valueMap[key]; exists {
				if existing != "" {
					continue
				}
			}
			valueMap[key] = nextValue
		}
		yearMaps = append(yearMaps, valueMap)
	}

	if len(years) == 0 || len(subjects) == 0 {
		return nil
	}

	rows := make([]any, 0, len(subjects))
	for _, sub := range subjects {
		values := make([]any, 0, len(years))
		for yearIndex := range years {
			value := strings.TrimSpace(yearMaps[yearIndex][sub.key])
			if value == "" {
				value = "-"
			}
			values = append(values, value)
		}
		rows = append(rows, map[string]any{
			"name":   sub.name,
			"unit":   sub.unit,
			"label":  sub.label,
			"key":    sub.key,
			"values": values,
		})
	}

	return map[string]any{
		"years": years,
		"rows":  rows,
	}
}
