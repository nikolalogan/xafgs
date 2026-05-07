package workflowruntime

import "strings"

type writebackApplyOptions struct {
	ProtectReservedRoots bool
}

func applyWritebacks(variables map[string]any, writebacks []Writeback, options writebackApplyOptions) {
	if variables == nil || len(writebacks) == 0 {
		return
	}
	for _, mapping := range writebacks {
		targetPath := strings.TrimSpace(mapping.TargetPath)
		if targetPath == "" {
			continue
		}
		if options.ProtectReservedRoots && isReservedRootPath(targetPath) {
			continue
		}
		if strings.HasSuffix(targetPath, "[]") {
			if incoming, ok := mapping.Value.([]any); ok {
				appendPath := strings.TrimSuffix(strings.TrimSuffix(targetPath, "[]"), ".")
				existing, _ := getByPath(variables, appendPath)
				if typed, ok := existing.([]any); ok {
					combined := make([]any, 0, len(typed)+len(incoming))
					combined = append(combined, typed...)
					combined = append(combined, incoming...)
					setByPath(variables, appendPath, combined)
					continue
				}
				setByPath(variables, appendPath, incoming)
				continue
			}
		}
		setByPath(variables, targetPath, mapping.Value)
	}
}

func mapOutputByWritebacks(output map[string]any, writebacks []Writeback) map[string]any {
	mapped := cloneMap(defaultMap(output))
	applyWritebacks(mapped, writebacks, writebackApplyOptions{ProtectReservedRoots: true})
	return mapped
}

func isReservedRootPath(path string) bool {
	switch strings.TrimSpace(path) {
	case "workflow", "global", "user":
		return true
	default:
		return false
	}
}
