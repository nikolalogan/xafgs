package workflowruntime

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type DynamicField struct {
	Name         string
	Label        string
	Type         string
	Required     bool
	Options      []DynamicOption
	DefaultValue any
}

type DynamicOption struct {
	Label string
	Value string
}

func ParseStartFields(config map[string]any) []DynamicField {
	if config == nil {
		return nil
	}
	raw, ok := config["variables"].([]any)
	if !ok {
		return nil
	}
	return parseDynamicFields(raw)
}

func ParseInputFields(config map[string]any) []DynamicField {
	if config == nil {
		return nil
	}
	raw, ok := config["fields"].([]any)
	if !ok {
		return nil
	}
	return parseDynamicFields(raw)
}

func BuildInputSchema(fields []DynamicField) map[string]any {
	schemaFields := make([]map[string]any, 0, len(fields))
	for _, field := range fields {
		defaultValue := field.DefaultValue
		if defaultValue == nil && normalizeFieldType(field.Type) == "checkbox" {
			defaultValue = false
		}
		if defaultValue == nil {
			defaultValue = ""
		}
		options := make([]map[string]any, 0, len(field.Options))
		for _, opt := range field.Options {
			options = append(options, map[string]any{
				"label": opt.Label,
				"value": opt.Value,
			})
		}
		schemaFields = append(schemaFields, map[string]any{
			"name":         field.Name,
			"label":        field.Label,
			"type":         normalizeFieldType(field.Type),
			"required":     field.Required,
			"options":      options,
			"defaultValue": defaultValue,
		})
	}
	return map[string]any{"fields": schemaFields}
}

func ValidateAndNormalizeDynamicInput(fields []DynamicField, input map[string]any) (map[string]any, error) {
	normalized := map[string]any{}
	for _, field := range fields {
		if strings.TrimSpace(field.Name) == "" {
			label := strings.TrimSpace(field.Label)
			if label == "" {
				label = "(未命名字段)"
			}
			return nil, errors.New("输入字段缺少 name：" + label)
		}

		var candidate any
		if input != nil {
			if raw, ok := input[field.Name]; ok {
				candidate = raw
			} else {
				candidate = field.DefaultValue
			}
		} else {
			candidate = field.DefaultValue
		}

		if field.Required && !hasFieldValue(field, candidate) {
			return nil, fmt.Errorf("输入字段 %s 为必填", field.Name)
		}

		if !hasFieldValue(field, candidate) {
			normalized[field.Name] = candidate
			continue
		}

		fieldType := normalizeFieldType(field.Type)
		if fieldType == "number" {
			parsed, err := parseNumber(candidate)
			if err != nil {
				return nil, fmt.Errorf("输入字段 %s 需要 number", field.Name)
			}
			normalized[field.Name] = parsed
			continue
		}

		if fieldType == "checkbox" {
			parsed, err := parseBool(candidate)
			if err != nil {
				return nil, fmt.Errorf("输入字段 %s 需要 boolean", field.Name)
			}
			normalized[field.Name] = parsed
			continue
		}

		if fieldType == "select" && len(field.Options) > 0 {
			valueStr := toString(candidate)
			valid := false
			for _, option := range field.Options {
				if option.Value == valueStr {
					valid = true
					break
				}
			}
			if !valid {
				return nil, fmt.Errorf("输入字段 %s 不在可选项中", field.Name)
			}
		}

		normalized[field.Name] = candidate
	}

	return normalized, nil
}

func parseDynamicFields(raw []any) []DynamicField {
	fields := make([]DynamicField, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(toString(entry["name"]))
		if name == "" {
			continue
		}
		label := strings.TrimSpace(toString(entry["label"]))
		fieldType := normalizeFieldType(toString(entry["type"]))
		required, _ := entry["required"].(bool)
		defaultValue := entry["defaultValue"]

		options := []DynamicOption{}
		if rawOptions, ok := entry["options"].([]any); ok {
			for _, opt := range rawOptions {
				options = append(options, normalizeOption(opt))
			}
		}
		options = filterNonEmptyOptions(options)

		fields = append(fields, DynamicField{
			Name:         name,
			Label:        label,
			Type:         fieldType,
			Required:     required,
			Options:      options,
			DefaultValue: defaultValue,
		})
	}
	return fields
}

func normalizeOption(option any) DynamicOption {
	if option == nil {
		return DynamicOption{}
	}
	if value, ok := option.(string); ok {
		value = strings.TrimSpace(value)
		return DynamicOption{Label: value, Value: value}
	}
	if m, ok := option.(map[string]any); ok {
		rawValue, _ := m["value"]
		value := strings.TrimSpace(toString(rawValue))
		rawLabel, _ := m["label"]
		label := strings.TrimSpace(toString(rawLabel))
		if label == "" {
			label = value
		}
		return DynamicOption{Label: label, Value: value}
	}
	value := strings.TrimSpace(toString(option))
	return DynamicOption{Label: value, Value: value}
}

func filterNonEmptyOptions(input []DynamicOption) []DynamicOption {
	out := make([]DynamicOption, 0, len(input))
	for _, item := range input {
		item.Label = strings.TrimSpace(item.Label)
		item.Value = strings.TrimSpace(item.Value)
		if item.Value == "" {
			continue
		}
		if item.Label == "" {
			item.Label = item.Value
		}
		out = append(out, item)
	}
	return out
}

func normalizeFieldType(raw string) string {
	switch strings.TrimSpace(raw) {
	case "paragraph":
		return "paragraph"
	case "number":
		return "number"
	case "select":
		return "select"
	case "checkbox":
		return "checkbox"
	default:
		return "text"
	}
}

func hasFieldValue(field DynamicField, value any) bool {
	if value == nil {
		return false
	}

	if normalizeFieldType(field.Type) == "checkbox" {
		// checkbox 的“未填写”只认 nil/undefined；false 也是合法输入
		return true
	}

	if s, ok := value.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	return true
}

func parseNumber(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case int32:
		return float64(v), nil
	case uint:
		return float64(v), nil
	case uint64:
		return float64(v), nil
	case uint32:
		return float64(v), nil
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, errors.New("empty")
		}
		return strconv.ParseFloat(trimmed, 64)
	default:
		return 0, errors.New("not number")
	}
}

func parseBool(value any) (bool, error) {
	switch v := value.(type) {
	case bool:
		return v, nil
	case string:
		s := strings.TrimSpace(strings.ToLower(v))
		if s == "true" || s == "1" || s == "yes" || s == "y" {
			return true, nil
		}
		if s == "false" || s == "0" || s == "no" || s == "n" || s == "" {
			return false, nil
		}
		return false, errors.New("invalid bool")
	case float64:
		return v != 0, nil
	case float32:
		return v != 0, nil
	case int:
		return v != 0, nil
	case int64:
		return v != 0, nil
	case int32:
		return v != 0, nil
	case uint:
		return v != 0, nil
	case uint64:
		return v != 0, nil
	case uint32:
		return v != 0, nil
	default:
		return false, errors.New("invalid bool")
	}
}
