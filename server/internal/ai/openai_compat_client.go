package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ChatMessageImageURL struct {
	URL string `json:"url"`
}

type ChatMessageContentPart struct {
	Type     string               `json:"type"`
	Text     string               `json:"text,omitempty"`
	ImageURL *ChatMessageImageURL `json:"image_url,omitempty"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type ChatTool struct {
	Type string `json:"type"`
}

type ChatCompletionRequest struct {
	BaseURL     string
	APIKey      string
	Model       string
	Messages    []ChatMessage
	Tools       []ChatTool
	Temperature float64
	MaxTokens   int
	Timeout     time.Duration
	UserAgent   string
	RequestID   string
}

type ChatCompletionClient interface {
	CreateChatCompletion(ctx context.Context, request ChatCompletionRequest) (string, error)
}

type EmbeddingRequest struct {
	BaseURL   string
	APIKey    string
	Model     string
	Input     []string
	Timeout   time.Duration
	UserAgent string
	RequestID string
}

type EmbeddingClient interface {
	CreateEmbeddings(ctx context.Context, request EmbeddingRequest) ([][]float64, error)
}

type openAICompatClient struct {
	httpClient *http.Client
}

var ErrTimeout = errors.New("ai request timeout")

func NewOpenAICompatClient(httpClient *http.Client) ChatCompletionClient {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &openAICompatClient{httpClient: httpClient}
}

func NewOpenAICompatEmbeddingClient(httpClient *http.Client) EmbeddingClient {
	if httpClient == nil {
		httpClient = &http.Client{}
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
	callCtx := ctx
	cancel := func() {}
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	if timeout > 0 {
		callCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	payload := map[string]any{
		"model":       model,
		"messages":    request.Messages,
		"temperature": request.Temperature,
		"stream":      false,
	}
	if request.MaxTokens > 0 {
		payload["max_tokens"] = request.MaxTokens
	}
	if len(request.Tools) > 0 {
		payload["tools"] = request.Tools
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
		if isTimeoutErr(err) {
			return "", fmt.Errorf("%w: %v", ErrTimeout, err)
		}
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
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("AI 响应解析失败")
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("AI 响应为空")
	}
	content := strings.TrimSpace(extractAssistantContent(parsed.Choices[0].Message.Content))
	if content == "" {
		return "", fmt.Errorf("AI 未返回内容")
	}
	return content, nil
}

func (client *openAICompatClient) CreateEmbeddings(ctx context.Context, request EmbeddingRequest) ([][]float64, error) {
	baseURL := normalizeBaseURL(request.BaseURL)
	if baseURL == "" {
		return nil, fmt.Errorf("aiBaseUrl 为空")
	}
	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" {
		return nil, fmt.Errorf("aiApiKey 为空")
	}
	model := strings.TrimSpace(request.Model)
	if model == "" {
		return nil, fmt.Errorf("model 为空")
	}
	if len(request.Input) == 0 {
		return nil, fmt.Errorf("input 为空")
	}

	timeout := request.Timeout
	callCtx := ctx
	cancel := func() {}
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	if timeout > 0 {
		callCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	payload := map[string]any{
		"model": model,
		"input": request.Input,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("请求序列化失败")
	}

	endpoint := resolveEmbeddingsEndpoint(baseURL)
	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("构造请求失败")
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
		if isTimeoutErr(err) {
			return nil, fmt.Errorf("%w: %v", ErrTimeout, err)
		}
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = fmt.Sprintf("AI 服务返回错误（http=%d）", resp.StatusCode)
		}
		return nil, fmt.Errorf("%s", message)
	}

	var parsed struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("AI 响应解析失败")
	}
	if len(parsed.Data) == 0 {
		return nil, fmt.Errorf("AI 未返回 embedding")
	}

	out := make([][]float64, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		if len(item.Embedding) == 0 {
			return nil, fmt.Errorf("AI 返回空 embedding")
		}
		out = append(out, item.Embedding)
	}
	return out, nil
}

func IsTimeoutError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrTimeout) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	return isTimeoutErr(err)
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return isTimeoutErr(urlErr.Err)
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "deadline exceeded") ||
		strings.Contains(message, "timeout") ||
		strings.Contains(message, "client.timeout exceeded")
}

func extractAssistantContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var parts []ChatMessageContentPart
	if err := json.Unmarshal(raw, &parts); err != nil {
		return ""
	}
	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part.Type) == "text" && strings.TrimSpace(part.Text) != "" {
			lines = append(lines, part.Text)
		}
	}
	return strings.Join(lines, "\n")
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

func resolveEmbeddingsEndpoint(baseURL string) string {
	normalized := normalizeBaseURL(baseURL)
	if strings.HasSuffix(normalized, "/v1") {
		return normalized + "/embeddings"
	}
	return normalized + "/v1/embeddings"
}
