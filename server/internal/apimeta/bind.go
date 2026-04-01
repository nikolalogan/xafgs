package apimeta

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func BindAndValidate(c *fiber.Ctx, request any) error {
	if request == nil {
		return nil
	}
	value := reflect.ValueOf(request)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return fmt.Errorf("%w: request must be a non-nil pointer", errValidation)
	}
	elem := value.Elem()
	if elem.Kind() != reflect.Struct {
		return fmt.Errorf("%w: request must point to a struct", errValidation)
	}

	hasBody := structHasBodyFields(elem.Type())
	if hasBody {
		if err := c.BodyParser(request); err != nil {
			return fmt.Errorf("%w: 请求体格式错误", errValidation)
		}
	}

	if err := bindPathAndQuery(c, elem); err != nil {
		return err
	}
	return validateStruct(elem)
}

func structHasBodyFields(t reflect.Type) bool {
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.Anonymous && field.Type.Kind() == reflect.Struct {
			if structHasBodyFields(field.Type) {
				return true
			}
			continue
		}
		if jsonTag := strings.TrimSpace(field.Tag.Get("json")); jsonTag != "" && jsonTag != "-" {
			return true
		}
	}
	return false
}

func bindPathAndQuery(c *fiber.Ctx, elem reflect.Value) error {
	t := elem.Type()
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		fieldValue := elem.Field(i)

		if field.Anonymous && field.Type.Kind() == reflect.Struct {
			if err := bindPathAndQuery(c, fieldValue); err != nil {
				return err
			}
			continue
		}

		pathName := strings.TrimSpace(field.Tag.Get("path"))
		queryName := strings.TrimSpace(field.Tag.Get("query"))

		if pathName == "" && queryName == "" {
			continue
		}

		raw := ""
		if pathName != "" {
			raw = strings.TrimSpace(c.Params(pathName))
		} else {
			raw = strings.TrimSpace(c.Query(queryName))
		}
		if raw == "" {
			continue
		}

		if err := setValueFromString(fieldValue, raw); err != nil {
			return fmt.Errorf("%w: %s 参数格式错误", errValidation, field.Name)
		}
	}
	return nil
}

func setValueFromString(fieldValue reflect.Value, raw string) error {
	if fieldValue.Kind() == reflect.Pointer {
		if fieldValue.IsNil() {
			fieldValue.Set(reflect.New(fieldValue.Type().Elem()))
		}
		return setValueFromString(fieldValue.Elem(), raw)
	}

	switch fieldValue.Kind() {
	case reflect.String:
		fieldValue.SetString(raw)
		return nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return err
		}
		fieldValue.SetInt(value)
		return nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return err
		}
		fieldValue.SetUint(value)
		return nil
	case reflect.Bool:
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return err
		}
		fieldValue.SetBool(value)
		return nil
	default:
		return fmt.Errorf("unsupported kind")
	}
}

func validateStruct(elem reflect.Value) error {
	t := elem.Type()
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		fieldValue := elem.Field(i)

		if field.Anonymous && field.Type.Kind() == reflect.Struct {
			if err := validateStruct(fieldValue); err != nil {
				return err
			}
			continue
		}

		validateTag := strings.TrimSpace(field.Tag.Get("validate"))
		if validateTag == "" {
			continue
		}
		rule, err := parseValidateTag(validateTag)
		if err != nil {
			return err
		}

		paramName := resolveFieldDocName(field)
		if paramName == "" {
			paramName = field.Name
		}
		if err := validateValue(paramName, fieldValue, rule); err != nil {
			return err
		}
	}
	return nil
}

