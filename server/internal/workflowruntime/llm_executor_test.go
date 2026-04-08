package workflowruntime

import (
	"context"
	"errors"
	"testing"

	"sxfgssever/server/internal/ai"
)

type fakeChatCompletionClient struct {
	response string
	err      error
	lastReq  ai.ChatCompletionRequest
}

func (client *fakeChatCompletionClient) CreateChatCompletion(_ context.Context, request ai.ChatCompletionRequest) (string, error) {
	client.lastReq = request
	if client.err != nil {
		return "", client.err
	}
	return client.response, nil
}

func TestLLMExecutor_StringOutputWithAlias(t *testing.T) {
	client := &fakeChatCompletionClient{response: "你好"}
	executor := llmNodeExecutor{aiClient: client}
	node := WorkflowNode{
		ID: "llm-1",
		Data: WorkflowNodeData{
			Type: "llm",
			Config: map[string]any{
				"model":       "gpt-4o-mini",
				"outputType":  "string",
				"outputVar":   "answer",
				"systemPrompt": "你是助手",
				"userPrompt":  "{{start.query}}",
				"temperature": 0.7,
				"maxTokens":   321,
			},
		},
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node: node,
		Variables: map[string]any{
			"user": map[string]any{
				"aiBaseUrl": "https://example.com",
				"aiApiKey":  "sk-test",
			},
			"start": map[string]any{
				"query": "你好",
			},
		},
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望成功，实际=%s，错误=%s", result.Type, result.Error)
	}
	if got := result.Output["answer"]; got != "你好" {
		t.Fatalf("answer 输出错误，期望=你好，实际=%v", got)
	}
	if got := result.Output["text"]; got != "你好" {
		t.Fatalf("text 别名输出错误，期望=你好，实际=%v", got)
	}
	if len(client.lastReq.Messages) != 2 {
		t.Fatalf("消息条数错误，期望=2，实际=%d", len(client.lastReq.Messages))
	}
	if client.lastReq.MaxTokens != 321 {
		t.Fatalf("maxTokens 错误，期望=321，实际=%d", client.lastReq.MaxTokens)
	}
}

func TestLLMExecutor_JSONOutputWritebacks(t *testing.T) {
	client := &fakeChatCompletionClient{response: "```json\n{\"decision\":{\"score\":88}}\n```"}
	executor := llmNodeExecutor{aiClient: client}
	node := WorkflowNode{
		ID: "llm-1",
		Data: WorkflowNodeData{
			Type: "llm",
			Config: map[string]any{
				"model":      "gpt-4o-mini",
				"outputType": "json",
				"outputVar":  "result",
				"userPrompt": "{\"decision\":{\"score\":88}}",
				"writebackMappings": []any{
					map[string]any{
						"expression": "decision.score",
						"targetPath": "workflow.score",
					},
				},
			},
		},
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{
			"user": map[string]any{
				"aiBaseUrl": "https://example.com",
				"aiApiKey":  "sk-test",
			},
		},
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultSuccess {
		t.Fatalf("期望成功，实际=%s，错误=%s", result.Type, result.Error)
	}
	output, ok := result.Output["result"].(map[string]any)
	if !ok {
		t.Fatalf("result 类型错误：%T", result.Output["result"])
	}
	decision, _ := output["decision"].(map[string]any)
	if got := decision["score"]; got != float64(88) {
		t.Fatalf("JSON 输出解析错误，期望=88，实际=%v", got)
	}
	if len(result.Writebacks) != 1 {
		t.Fatalf("writebacks 数量错误，期望=1，实际=%d", len(result.Writebacks))
	}
	if result.Writebacks[0].TargetPath != "workflow.score" {
		t.Fatalf("writeback targetPath 错误，实际=%s", result.Writebacks[0].TargetPath)
	}
	if result.Writebacks[0].Value != float64(88) {
		t.Fatalf("writeback value 错误，实际=%v", result.Writebacks[0].Value)
	}
}

func TestLLMExecutor_JSONOutputInvalid(t *testing.T) {
	client := &fakeChatCompletionClient{response: "not-json"}
	executor := llmNodeExecutor{aiClient: client}
	node := WorkflowNode{
		ID: "llm-1",
		Data: WorkflowNodeData{
			Type: "llm",
			Config: map[string]any{
				"outputType": "json",
				"outputVar":  "result",
				"userPrompt": "not-json",
			},
		},
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{
			"user": map[string]any{
				"aiBaseUrl": "https://example.com",
				"aiApiKey":  "sk-test",
			},
		},
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultFailed {
		t.Fatalf("期望失败，实际=%s", result.Type)
	}
	if result.Error == "" {
		t.Fatalf("期望返回明确错误信息")
	}
}

func TestLLMExecutor_MissingAIConfig(t *testing.T) {
	executor := llmNodeExecutor{aiClient: &fakeChatCompletionClient{response: "ok"}}
	node := WorkflowNode{
		ID: "llm-1",
		Data: WorkflowNodeData{
			Type: "llm",
			Config: map[string]any{
				"userPrompt": "hello",
			},
		},
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node:      node,
		Variables: map[string]any{},
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultFailed {
		t.Fatalf("期望失败，实际=%s", result.Type)
	}
	if result.Error != "缺少用户配置：AI 服务商地址、AI APIKey" {
		t.Fatalf("错误信息不符合预期，实际=%s", result.Error)
	}
}

func TestLLMExecutor_AICallFailed(t *testing.T) {
	executor := llmNodeExecutor{aiClient: &fakeChatCompletionClient{err: errors.New("network failed")}}
	node := WorkflowNode{
		ID: "llm-1",
		Data: WorkflowNodeData{
			Type: "llm",
			Config: map[string]any{
				"userPrompt": "hello",
			},
		},
	}

	result, err := executor.Execute(context.Background(), NodeExecutorContext{
		Node: node,
		Variables: map[string]any{
			"user": map[string]any{
				"aiBaseUrl": "https://example.com",
				"aiApiKey":  "sk-test",
			},
		},
	})
	if err != nil {
		t.Fatalf("执行器返回错误：%v", err)
	}
	if result.Type != NodeExecutorResultFailed {
		t.Fatalf("期望失败，实际=%s", result.Type)
	}
}
