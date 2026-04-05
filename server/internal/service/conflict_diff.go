package service

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"

	"sxfgssever/server/internal/model"
)

func buildDifferences(existing any, incoming any) []model.ConflictDifference {
	existingValue := normalizeJSONValue(existing)
	incomingValue := normalizeJSONValue(incoming)
	differences := make([]model.ConflictDifference, 0)
	diffValue("", existingValue, incomingValue, &differences)
	return differences
}

func normalizeJSONValue(value any) any {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func diffValue(path string, existing any, incoming any, out *[]model.ConflictDifference) {
	switch existingTyped := existing.(type) {
	case map[string]any:
		incomingTyped, ok := incoming.(map[string]any)
		if !ok {
			appendDiff(path, existing, incoming, "type_mismatch", out)
			return
		}
		keys := make([]string, 0, len(existingTyped)+len(incomingTyped))
		seen := map[string]bool{}
		for key := range existingTyped {
			keys = append(keys, key)
			seen[key] = true
		}
		for key := range incomingTyped {
			if !seen[key] {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			nextPath := key
			if path != "" {
				nextPath = fmt.Sprintf("%s.%s", path, key)
			}
			existingValue, existingOK := existingTyped[key]
			incomingValue, incomingOK := incomingTyped[key]
			if !existingOK {
				appendDiff(nextPath, nil, incomingValue, "missing_in_existing", out)
				continue
			}
			if !incomingOK {
				appendDiff(nextPath, existingValue, nil, "missing_in_incoming", out)
				continue
			}
			diffValue(nextPath, existingValue, incomingValue, out)
		}
	case []any:
		incomingTyped, ok := incoming.([]any)
		if !ok {
			appendDiff(path, existing, incoming, "type_mismatch", out)
			return
		}
		if len(existingTyped) != len(incomingTyped) {
			appendDiff(path, len(existingTyped), len(incomingTyped), "length_mismatch", out)
		}
		maxLen := len(existingTyped)
		if len(incomingTyped) > maxLen {
			maxLen = len(incomingTyped)
		}
		for i := 0; i < maxLen; i++ {
			nextPath := fmt.Sprintf("%s[%d]", path, i)
			if path == "" {
				nextPath = fmt.Sprintf("[%d]", i)
			}
			if i >= len(existingTyped) {
				appendDiff(nextPath, nil, incomingTyped[i], "missing_in_existing", out)
				continue
			}
			if i >= len(incomingTyped) {
				appendDiff(nextPath, existingTyped[i], nil, "missing_in_incoming", out)
				continue
			}
			diffValue(nextPath, existingTyped[i], incomingTyped[i], out)
		}
	default:
		if !reflect.DeepEqual(existing, incoming) {
			appendDiff(path, existing, incoming, "value_mismatch", out)
		}
	}
}

func appendDiff(path string, existing any, incoming any, reason string, out *[]model.ConflictDifference) {
	fieldPath := path
	if fieldPath == "" {
		fieldPath = "$"
	}
	*out = append(*out, model.ConflictDifference{
		FieldPath:     fieldPath,
		ExistingValue: existing,
		IncomingValue: incoming,
		Reason:        reason,
	})
}
