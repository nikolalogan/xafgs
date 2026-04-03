package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatCompletionRequest struct {
	BaseURL      string
	APIKey       string
	Model        string
	Messages     []ChatMessage
	Temperature  float64
	Timeout      time.Duration
	UserAgent    string
	RequestID    string
}

type ChatCompletionClient interface {
	CreateChatCompletion(ctx context.Context, request ChatCompletionRequest) (string, error)
}

type openAICompatClient struct {
	httpClient *http.Client
}

func NewOpenAICompatClient(httpClient *http.Client) ChatCompletionClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &openAICompatClient{httpClient: httpClient}
}

func (client *openAICompatClient) CreateChatCompletion(ctx context.Context, request ChatCompletionRequest) (string, error) {
	baseURL := normalizeBaseURL(request.BaseURL)
	if baseURL == "" {
		return "", fmt.Errorf("aiBaseUrl 为空")
	}
	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" {
		return "", fmt.Errorf("aiApiKey 为空")
	}
	model := strings.TrimSpace(request.Model)
	if model == "" {
		return "", fmt.Errorf("model 为空")
	}

	timeout := request.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	payload := map[string]any{
		"model":       model,
		"messages":    request.Messages,
		"temperature": request.Temperature,
		"stream":      false,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("请求序列化失败")
	}

	endpoint := resolveChatCompletionsEndpoint(baseURL)
	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("构造请求失败")
	}

	httpReq.Header.Set("content-type", "application/json")
	httpReq.Header.Set("accept", "application/json")
	httpReq.Header.Set("authorization", "Bearer "+apiKey)
	if ua := strings.TrimSpace(request.UserAgent); ua != "" {
		httpReq.Header.Set("user-agent", ua)
	}
	if rid := strings.TrimSpace(request.RequestID); rid != "" {
		httpReq.Header.Set("x-request-id", rid)
	}

	resp, err := client.httpClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			message := strings.TrimSpace(string(body))
			if message == "" {
				message = fmt.Sprintf("AI 服务返回错误（http=%d）", resp.StatusCode)
			}
			return "", fmt.Errorf("%s", message)
		}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("AI 响应解析失败")
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("AI 响应为空")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("AI 未返回内容")
	}
	return content, nil
}

func normalizeBaseURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	return strings.TrimRight(value, "/")
}

func resolveChatCompletionsEndpoint(baseURL string) string {
	normalized := normalizeBaseURL(baseURL)
	if strings.HasSuffix(normalized, "/v1") {
		return normalized + "/chat/completions"
	}
	return normalized + "/v1/chat/completions"
}
