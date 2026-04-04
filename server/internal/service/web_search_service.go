package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"net/http"
	"strings"
	"time"
)

const defaultTavilySearchURL = "https://api.tavily.com/search"

type WebSearchRequest struct {
	Service string
	BaseURL string
	APIKey  string
	Query   string
}

type WebSearchResult struct {
	Title   string
	URL     string
	Content string
	Score   float64
}

type WebSearchClient interface {
	Search(ctx context.Context, request WebSearchRequest) ([]WebSearchResult, error)
}

type tavilySearchClient struct {
	httpClient *http.Client
}

func NewTavilySearchClient(httpClient *http.Client) WebSearchClient {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &tavilySearchClient{httpClient: httpClient}
}

func (client *tavilySearchClient) Search(ctx context.Context, request WebSearchRequest) ([]WebSearchResult, error) {
	query := strings.TrimSpace(request.Query)
	if query == "" {
		return nil, fmt.Errorf("query 不能为空")
	}
	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" {
		return nil, fmt.Errorf("apiKey 不能为空")
	}

	endpoint := resolveTavilyEndpoint(request.BaseURL)

	payload := map[string]any{
		"query":        query,
		"search_depth": "advanced",
	}
	rawBody, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败")
	}

	callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return nil, fmt.Errorf("构造请求失败")
	}
	httpReq.Header.Set("content-type", "application/json")
	httpReq.Header.Set("authorization", "Bearer "+apiKey)

	resp, err := client.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = fmt.Sprintf("搜索服务返回错误（http=%d）", resp.StatusCode)
		}
		return nil, fmt.Errorf("%s", message)
	}

	var parsed struct {
		Results []struct {
			Title   string  `json:"title"`
			URL     string  `json:"url"`
			Content string  `json:"content"`
			Score   float64 `json:"score"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析搜索响应失败")
	}

	out := make([]WebSearchResult, 0, len(parsed.Results))
	for _, item := range parsed.Results {
		out = append(out, WebSearchResult{
			Title:   strings.TrimSpace(item.Title),
			URL:     strings.TrimSpace(item.URL),
			Content: strings.TrimSpace(item.Content),
			Score:   item.Score,
		})
	}
	return out, nil
}

func resolveTavilyEndpoint(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultTavilySearchURL
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return defaultTavilySearchURL
	}
	path := strings.TrimSpace(parsed.Path)
	path = strings.TrimRight(path, "/")
	switch path {
	case "", "/":
		parsed.Path = "/search"
	case "/search":
		parsed.Path = "/search"
	default:
		// 兼容用户误填 /v1 或任意非 /search 路径，统一落到 Tavily 搜索端点。
		parsed.Path = "/search"
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func formatWebSearchContext(results []WebSearchResult) string {
	if len(results) == 0 {
		return "未检索到可用结果。"
	}
	lines := make([]string, 0, len(results))
	maxCount := len(results)
	if maxCount > 5 {
		maxCount = 5
	}
	for index := 0; index < maxCount; index++ {
		item := results[index]
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "未命名结果"
		}
		url := strings.TrimSpace(item.URL)
		snippet := strings.TrimSpace(item.Content)
		if len(snippet) > 600 {
			snippet = snippet[:600]
		}
		lines = append(lines, fmt.Sprintf("%d. %s\nURL: %s\n摘要: %s", index+1, title, url, snippet))
	}
	return strings.Join(lines, "\n\n")
}
