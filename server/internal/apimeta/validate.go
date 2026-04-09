package apimeta

import (
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

var errValidation = errors.New("validation error")

type validateRule struct {
	required bool
	omitEmpty bool
	min      *int64
	max      *int64
	enum     []string
	pattern  *regexp.Regexp
}

func parseValidateTag(raw string) (validateRule, error) {
	out := validateRule{}
	tag := strings.TrimSpace(raw)
	if tag == "" {
		return out, nil
	}
	parts := strings.Split(tag, ",")
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		if p == "required" {
			out.required = true
			continue
		}
		if p == "omitempty" {
			out.omitEmpty = true
			continue
		}
		if strings.HasPrefix(p, "min=") {
			value, err := strconv.ParseInt(strings.TrimPrefix(p, "min="), 10, 64)
			if err != nil {
				return validateRule{}, fmt.Errorf("%w: invalid min", errValidation)
			}
			out.min = &value
			continue
		}
		if strings.HasPrefix(p, "max=") {
			value, err := strconv.ParseInt(strings.TrimPrefix(p, "max="), 10, 64)
			if err != nil {
				return validateRule{}, fmt.Errorf("%w: invalid max", errValidation)
			}
			out.max = &value
			continue
		}
		if strings.HasPrefix(p, "oneof=") {
			rawValues := strings.TrimSpace(strings.TrimPrefix(p, "oneof="))
			if rawValues == "" {
				return validateRule{}, fmt.Errorf("%w: invalid oneof", errValidation)
			}
			out.enum = strings.Fields(rawValues)
			continue
		}
		if strings.HasPrefix(p, "pattern=") {
			patternText := strings.TrimSpace(strings.TrimPrefix(p, "pattern="))
			if patternText == "" {
				return validateRule{}, fmt.Errorf("%w: invalid pattern", errValidation)
			}
			compiled, err := regexp.Compile(patternText)
			if err != nil {
				return validateRule{}, fmt.Errorf("%w: invalid pattern", errValidation)
			}
			out.pattern = compiled
			continue
		}
	}
	return out, nil
}

func validateValue(fieldName string, value reflect.Value, rule validateRule) error {
	// Deref pointers for checks; "required" needs to detect nil
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			if rule.required {
				return fmt.Errorf("%w: %s 不能为空", errValidation, fieldName)
			}
			return nil
		}
		value = value.Elem()
	}

	if rule.required {
		switch value.Kind() {
		case reflect.String:
			if strings.TrimSpace(value.String()) == "" {
				return fmt.Errorf("%w: %s 不能为空", errValidation, fieldName)
			}
		case reflect.Slice, reflect.Array:
			if value.Len() == 0 {
				return fmt.Errorf("%w: %s 不能为空", errValidation, fieldName)
			}
		case reflect.Map:
			if value.Len() == 0 {
				return fmt.Errorf("%w: %s 不能为空", errValidation, fieldName)
			}
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			if value.Int() == 0 {
				return fmt.Errorf("%w: %s 不能为空", errValidation, fieldName)
			}
		case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
			if value.Uint() == 0 {
				return fmt.Errorf("%w: %s 不能为空", errValidation, fieldName)
			}
		}
	}

	if rule.omitEmpty && isEmptyValue(value) {
		return nil
	}

	if len(rule.enum) > 0 {
		text := ""
		if value.Kind() == reflect.String {
			text = value.String()
		} else {
			text = fmt.Sprint(value.Interface())
		}
		allowed := false
		for _, item := range rule.enum {
			if text == item {
				allowed = true
				break
			}
		}
		if !allowed {
			return fmt.Errorf("%w: %s 不在可选项中", errValidation, fieldName)
		}
	}

	if rule.pattern != nil && value.Kind() == reflect.String {
		if !rule.pattern.MatchString(value.String()) {
			return fmt.Errorf("%w: %s 格式不正确", errValidation, fieldName)
		}
	}

	if rule.min == nil && rule.max == nil {
		return nil
	}

	switch value.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v := value.Int()
		if rule.min != nil && v < *rule.min {
			return fmt.Errorf("%w: %s 不能小于 %d", errValidation, fieldName, *rule.min)
		}
		if rule.max != nil && v > *rule.max {
			return fmt.Errorf("%w: %s 不能大于 %d", errValidation, fieldName, *rule.max)
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		v := int64(value.Uint())
		if rule.min != nil && v < *rule.min {
			return fmt.Errorf("%w: %s 不能小于 %d", errValidation, fieldName, *rule.min)
		}
		if rule.max != nil && v > *rule.max {
			return fmt.Errorf("%w: %s 不能大于 %d", errValidation, fieldName, *rule.max)
		}
	case reflect.String:
		length := int64(len([]rune(value.String())))
		if rule.min != nil && length < *rule.min {
			return fmt.Errorf("%w: %s 长度不能小于 %d", errValidation, fieldName, *rule.min)
		}
		if rule.max != nil && length > *rule.max {
			return fmt.Errorf("%w: %s 长度不能大于 %d", errValidation, fieldName, *rule.max)
		}
	case reflect.Slice, reflect.Array, reflect.Map:
		length := int64(value.Len())
		if rule.min != nil && length < *rule.min {
			return fmt.Errorf("%w: %s 不能少于 %d 项", errValidation, fieldName, *rule.min)
		}
		if rule.max != nil && length > *rule.max {
			return fmt.Errorf("%w: %s 不能多于 %d 项", errValidation, fieldName, *rule.max)
		}
	}
	return nil
}

func isEmptyValue(value reflect.Value) bool {
	switch value.Kind() {
	case reflect.String:
		return strings.TrimSpace(value.String()) == ""
	case reflect.Bool:
		return value.Bool() == false
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return value.Int() == 0
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return value.Uint() == 0
	case reflect.Float32, reflect.Float64:
		return value.Float() == 0
	case reflect.Array, reflect.Slice, reflect.Map:
		return value.Len() == 0
	case reflect.Interface, reflect.Pointer:
		return value.IsNil()
	}
	return false
}
