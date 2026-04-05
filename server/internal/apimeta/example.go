package apimeta

import (
	"reflect"
	"strings"
)

func ExampleFromType[T any]() any {
	var zero T
	return buildExample(reflect.TypeOf(zero), map[reflect.Type]bool{})
}

func buildExample(t reflect.Type, visiting map[reflect.Type]bool) any {
	if t == nil {
		return map[string]any{}
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == nil {
		return map[string]any{}
	}

	if visiting[t] {
		return map[string]any{}
	}
	visiting[t] = true
	defer delete(visiting, t)

	switch t.Kind() {
	case reflect.Struct:
		return buildStructExample(t, visiting)
	case reflect.Slice, reflect.Array:
		return []any{buildExample(t.Elem(), visiting)}
	case reflect.Map:
		return map[string]any{}
	case reflect.Interface:
		return map[string]any{}
	case reflect.Bool:
		return false
	case reflect.String:
		return ""
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return 0
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return 0
	case reflect.Float32, reflect.Float64:
		return 0
	default:
		return nil
	}
}

func buildStructExample(t reflect.Type, visiting map[reflect.Type]bool) map[string]any {
	out := map[string]any{}
	fieldCount := t.NumField()
	for i := 0; i < fieldCount; i++ {
		field := t.Field(i)
		if field.PkgPath != "" {
			continue
		}

		jsonTag := field.Tag.Get("json")
		name := strings.TrimSpace(strings.Split(jsonTag, ",")[0])
		if name == "-" {
			continue
		}

		if name == "" && field.Anonymous {
			embedded := buildExample(field.Type, visiting)
			if embeddedObj, ok := embedded.(map[string]any); ok {
				for key, value := range embeddedObj {
					out[key] = value
				}
			}
			continue
		}

		if name == "" {
			name = field.Name
		}
		out[name] = buildExample(field.Type, visiting)
	}
	return out
}
