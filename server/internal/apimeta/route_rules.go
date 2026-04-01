package apimeta

import (
	"regexp"
	"strings"
)

var pathParamRegex = regexp.MustCompile(`:([A-Za-z0-9_]+)`)

func ExtractPathParams(path string) []string {
	matches := pathParamRegex.FindAllStringSubmatch(path, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]string, 0, len(matches))
	seen := make(map[string]bool, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		name := strings.TrimSpace(match[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func DefaultPathParamValidation(name string) (APIField, bool) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return APIField{}, false
	}
	min := int64(1)
	switch trimmed {
	case "id", "userId", "workflowId", "templateId", "executionId", "versionNo":
		return APIField{
			Name: trimmed,
			In:   ParamLocationPath,
			Type: "int",
			Validation: FieldValidation{
				Required: true,
				Min:      &min,
			},
		}, true
	default:
		return APIField{
			Name: trimmed,
			In:   ParamLocationPath,
			Type: "string",
			Validation: FieldValidation{
				Required: true,
			},
		}, true
	}
}

