package workflowruntime

import (
	"encoding/json"
	"errors"
)

type WorkflowDSL struct {
	Nodes              []WorkflowNode            `json:"nodes"`
	Edges              []WorkflowEdge            `json:"edges"`
	GlobalVariables    []WorkflowGlobalVariable  `json:"globalVariables,omitempty"`
	WorkflowParameters []WorkflowParameter       `json:"workflowParameters,omitempty"`
	Viewport           map[string]any            `json:"viewport,omitempty"`
}

type WorkflowGlobalVariable struct {
	Name         string `json:"name"`
	ValueType    string `json:"valueType"`
	DefaultValue string `json:"defaultValue,omitempty"`
	JSON         string `json:"json,omitempty"`
	JSONSchema   string `json:"jsonSchema,omitempty"` // 兼容旧字段
	Description  string `json:"description,omitempty"`
}

type WorkflowParameter struct {
	Name         string `json:"name"`
	Label        string `json:"label,omitempty"`
	ValueType    string `json:"valueType"`
	Required     bool   `json:"required,omitempty"`
	DefaultValue string `json:"defaultValue,omitempty"`
	JSON         string `json:"json,omitempty"`
	JSONSchema   string `json:"jsonSchema,omitempty"` // 兼容旧字段
	Description  string `json:"description,omitempty"`
}

type WorkflowNode struct {
	ID       string           `json:"id"`
	Position map[string]any   `json:"position"`
	Data     WorkflowNodeData `json:"data"`
}

type WorkflowNodeData struct {
	Title  string         `json:"title"`
	Type   string         `json:"type"`
	Config map[string]any `json:"config,omitempty"`
}

type WorkflowEdge struct {
	ID           string `json:"id"`
	Source       string `json:"source"`
	Target       string `json:"target"`
	SourceHandle string `json:"sourceHandle,omitempty"`
}

func ParseWorkflowDSL(input any) (WorkflowDSL, error) {
	var raw any
	switch value := input.(type) {
	case string:
		if err := json.Unmarshal([]byte(value), &raw); err != nil {
			return WorkflowDSL{}, errors.New("DSL 不是合法 JSON")
		}
	case []byte:
		if err := json.Unmarshal(value, &raw); err != nil {
			return WorkflowDSL{}, errors.New("DSL 不是合法 JSON")
		}
	case json.RawMessage:
		if err := json.Unmarshal(value, &raw); err != nil {
			return WorkflowDSL{}, errors.New("DSL 不是合法 JSON")
		}
	default:
		raw = input
	}

	root, ok := raw.(map[string]any)
	if !ok {
		return WorkflowDSL{}, errors.New("DSL 根节点必须为对象")
	}

	nodesRaw, ok := root["nodes"].([]any)
	if !ok || len(nodesRaw) == 0 {
		return WorkflowDSL{}, errors.New("DSL 中 nodes 不能为空")
	}

	nodes := make([]WorkflowNode, 0, len(nodesRaw))
	for _, item := range nodesRaw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := m["id"].(string)
		data, _ := m["data"].(map[string]any)
		position, _ := m["position"].(map[string]any)
		if id == "" || data == nil || position == nil {
			continue
		}
		title, _ := data["title"].(string)
		typ, _ := data["type"].(string)
		if typ == "" {
			continue
		}
		config, _ := data["config"].(map[string]any)
		nodes = append(nodes, WorkflowNode{
			ID:       id,
			Position: position,
			Data: WorkflowNodeData{
				Title:  title,
				Type:   typ,
				Config: config,
			},
		})
	}
	if len(nodes) == 0 {
		return WorkflowDSL{}, errors.New("DSL 中 nodes 不能为空")
	}

	edgesRaw, _ := root["edges"].([]any)
	edges := make([]WorkflowEdge, 0, len(edgesRaw))
	for _, item := range edgesRaw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := m["id"].(string)
		source, _ := m["source"].(string)
		target, _ := m["target"].(string)
		if id == "" || source == "" || target == "" {
			continue
		}
		sourceHandle, _ := m["sourceHandle"].(string)
		edges = append(edges, WorkflowEdge{
			ID:           id,
			Source:       source,
			Target:       target,
			SourceHandle: sourceHandle,
		})
	}

	viewport, _ := root["viewport"].(map[string]any)
	if viewport == nil {
		viewport = map[string]any{"x": 0, "y": 0, "zoom": 1}
	}

	globalVariables := make([]WorkflowGlobalVariable, 0)
	if rawList, ok := root["globalVariables"].([]any); ok {
		for _, item := range rawList {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			name := toString(m["name"])
			if name == "" {
				continue
			}
			globalVariables = append(globalVariables, WorkflowGlobalVariable{
				Name:         name,
				ValueType:    toString(m["valueType"]),
				DefaultValue: toString(m["defaultValue"]),
				JSON:         toString(m["json"]),
				JSONSchema:   toString(m["jsonSchema"]),
				Description:  toString(m["description"]),
			})
		}
	}

	workflowParameters := make([]WorkflowParameter, 0)
	if rawList, ok := root["workflowParameters"].([]any); ok {
		for _, item := range rawList {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			name := toString(m["name"])
			if name == "" {
				continue
			}
			required, _ := m["required"].(bool)
			workflowParameters = append(workflowParameters, WorkflowParameter{
				Name:         name,
				Label:        toString(m["label"]),
				ValueType:    toString(m["valueType"]),
				Required:     required,
				DefaultValue: toString(m["defaultValue"]),
				JSON:         toString(m["json"]),
				JSONSchema:   toString(m["jsonSchema"]),
				Description:  toString(m["description"]),
			})
		}
	}

	return WorkflowDSL{
		Nodes:              nodes,
		Edges:              edges,
		GlobalVariables:    globalVariables,
		WorkflowParameters: workflowParameters,
		Viewport:           viewport,
	}, nil
}
