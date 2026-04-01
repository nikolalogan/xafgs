package apimeta

import (
	"reflect"
	"strings"
)

func BuildParamsFromRequest(request any) []APIField {
	if request == nil {
		return nil
	}
	value := reflect.ValueOf(request)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return nil
	}
	elem := value.Elem()
	if elem.Kind() != reflect.Struct {
		return nil
	}
	return buildParamsFromType(elem.Type())
}

func buildParamsFromType(t reflect.Type) []APIField {
	out := make([]APIField, 0)
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.Anonymous && field.Type.Kind() == reflect.Struct {
			out = append(out, buildParamsFromType(field.Type)...)
			continue
		}

		fieldName, location, ok := resolveLocationAndName(field)
		if !ok {
			continue
		}

		validation := FieldValidation{}
		if validateTag := strings.TrimSpace(field.Tag.Get("validate")); validateTag != "" {
			if rule, err := parseValidateTag(validateTag); err == nil {
				validation.Required = rule.required
				validation.Enum = rule.enum
				validation.Min = rule.min
				validation.Max = rule.max
				if rule.pattern != nil {
					validation.Pattern = rule.pattern.String()
				}
			}
		}

		out = append(out, APIField{
			Name:       fieldName,
			In:         location,
			Type:       goTypeName(field.Type),
			Validation: validation,
		})
	}
	return out
}

func resolveLocationAndName(field reflect.StructField) (string, ParamLocation, bool) {
	if name := strings.TrimSpace(field.Tag.Get("path")); name != "" {
		return name, ParamLocationPath, true
	}
	if name := strings.TrimSpace(field.Tag.Get("query")); name != "" {
		return name, ParamLocationQuery, true
	}
	if jsonTag := strings.TrimSpace(field.Tag.Get("json")); jsonTag != "" && jsonTag != "-" {
		name := strings.Split(jsonTag, ",")[0]
		name = strings.TrimSpace(name)
		if name == "" {
			name = field.Name
		}
		return name, ParamLocationBody, true
	}
	return "", "", false
}

func resolveFieldDocName(field reflect.StructField) string {
	if name := strings.TrimSpace(field.Tag.Get("path")); name != "" {
		return name
	}
	if name := strings.TrimSpace(field.Tag.Get("query")); name != "" {
		return name
	}
	if jsonTag := strings.TrimSpace(field.Tag.Get("json")); jsonTag != "" && jsonTag != "-" {
		name := strings.Split(jsonTag, ",")[0]
		name = strings.TrimSpace(name)
		if name == "" {
			return field.Name
		}
		return name
	}
	return ""
}

func goTypeName(t reflect.Type) string {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.String:
		return "string"
	case reflect.Bool:
		return "bool"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return "int"
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "uint"
	case reflect.Map:
		return "map"
	case reflect.Slice, reflect.Array:
		return "array"
	case reflect.Struct:
		return "object"
	default:
		return t.Kind().String()
	}
}

