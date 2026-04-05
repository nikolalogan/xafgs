package workflowruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"net/http"
	"net/url"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
)

type NodeExecutorContext struct {
	Node      WorkflowNode
	Variables map[string]any
	NodeInput map[string]any
}

type NodeExecutorResultType string

const (
	NodeExecutorResultSuccess      NodeExecutorResultType = "success"
	NodeExecutorResultWaitingInput NodeExecutorResultType = "waiting_input"
	NodeExecutorResultBranch       NodeExecutorResultType = "branch"
	NodeExecutorResultFailed       NodeExecutorResultType = "failed"
)

type NodeExecutorResult struct {
	Type       NodeExecutorResultType
	Output     map[string]any
	Writebacks []Writeback

	Schema     map[string]any
	HandleID   string
	BranchName string
	Error      string
}

type Writeback struct {
	TargetPath string
	Value      any
}

type NodeExecutor interface {
	Execute(ctx context.Context, input NodeExecutorContext) (NodeExecutorResult, error)
}

func CreateExecutorRegistry() map[string]NodeExecutor {
	return map[string]NodeExecutor{
		"start":        startNodeExecutor{},
		"input":        inputNodeExecutor{},
		"code":         codeNodeExecutor{},
		"end":          endNodeExecutor{},
		"llm":          passthroughExecutor{},
		"if-else":      ifElseNodeExecutor{},
		"iteration":    passthroughExecutor{},
		"http-request": httpNodeExecutor{},
		"api-request":  apiRequestExecutor{},
	}
}

type startNodeExecutor struct{}

func (startNodeExecutor) Execute(_ context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: cloneMap(input.Variables)}, nil
}

type passthroughExecutor struct{}

func (passthroughExecutor) Execute(_ context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	out := cloneMap(input.Variables)
	out["__nodeType"] = input.Node.Data.Type
	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: out}, nil
}

type inputNodeExecutor struct{}

func (inputNodeExecutor) Execute(_ context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	fields := ParseInputFields(input.Node.Data.Config)
	schema := BuildInputSchema(fields)
	if input.NodeInput == nil {
		return NodeExecutorResult{Type: NodeExecutorResultWaitingInput, Schema: schema}, nil
	}

	normalized, err := ValidateAndNormalizeDynamicInput(fields, input.NodeInput)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: err.Error()}, nil
	}

	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: normalized}, nil
}

type codeNodeExecutor struct{}

func (codeNodeExecutor) Execute(_ context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	raw, _ := input.Node.Data.Config["code"].(string)
	code := strings.TrimSpace(raw)
	if code == "" {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "代码节点 code 为空"}, nil
	}

	vm := goja.New()
	if err := vm.Set("input", input.Variables); err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "代码执行失败"}, nil
	}

	script := code + "\n; (typeof main === 'function') ? main(input) : ({})"
	value, err := vm.RunString(script)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: err.Error()}, nil
	}
	exported := value.Export()
	output := toObject(exported)
	writebacks := buildNodeWritebacks(input.Node.Data.Config["writebackMappings"], output)
	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: output, Writebacks: writebacks}, nil
}

type httpNodeExecutor struct{}

func (httpNodeExecutor) Execute(ctx context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	method := toString(input.Node.Data.Config["method"])
	if method == "" {
		method = http.MethodGet
	}
	timeoutSeconds, _ := toNumber(input.Node.Data.Config["timeout"])
	if timeoutSeconds <= 0 {
		timeoutSeconds = 30
	}

	urlTemplate := toString(input.Node.Data.Config["url"])
	finalURL, missing := renderTemplateWithMissing(urlTemplate, input.Variables)
	if len(missing) > 0 {
		// 增强诊断：workflow/global 被覆盖成非对象时，补充类型信息便于排查
		if slicesContains(missing, "workflow.http_prex") {
			workflowType := fmt.Sprintf("%T", input.Variables["workflow"])
			if _, ok := input.Variables["workflow"].(map[string]any); ok {
				workflowType = "map"
			}
			return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点参数未解析：" + strings.Join(missing, "，") + "（当前 workflow 类型=" + workflowType + "）"}, nil
		}
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点参数未解析：" + strings.Join(missing, "，")}, nil
	}
	if strings.TrimSpace(finalURL) == "" {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点 URL 为空"}, nil
	}

	u, err := url.Parse(finalURL)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点 URL 不合法"}, nil
	}

	query := u.Query()
	if rawList, ok := input.Node.Data.Config["query"].([]any); ok {
		missingKeys := map[string]bool{}
		for _, item := range rawList {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			key := strings.TrimSpace(toString(m["key"]))
			if key == "" {
				continue
			}
			val, missing := renderTemplateWithMissing(toString(m["value"]), input.Variables)
			for _, k := range missing {
				missingKeys[k] = true
			}
			query.Add(key, val)
		}
		if len(missingKeys) > 0 {
			list := make([]string, 0, len(missingKeys))
			for k := range missingKeys {
				list = append(list, k)
			}
			sort.Strings(list)
			return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点参数未解析：" + strings.Join(list, "，")}, nil
		}
	}
	u.RawQuery = query.Encode()

	headers := http.Header{}
	if rawList, ok := input.Node.Data.Config["headers"].([]any); ok {
		missingKeys := map[string]bool{}
		for _, item := range rawList {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			key := strings.TrimSpace(toString(m["key"]))
			if key == "" {
				continue
			}
			val, missing := renderTemplateWithMissing(toString(m["value"]), input.Variables)
			for _, k := range missing {
				missingKeys[k] = true
			}
			headers.Set(key, val)
		}
		if len(missingKeys) > 0 {
			list := make([]string, 0, len(missingKeys))
			for k := range missingKeys {
				list = append(list, k)
			}
			sort.Strings(list)
			return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点参数未解析：" + strings.Join(list, "，")}, nil
		}
	}

	authorization := toObject(input.Node.Data.Config["authorization"])
	authType := strings.TrimSpace(toString(authorization["type"]))
	authValueRaw := toString(authorization["apiKey"])
	authValueRendered, authMissing := renderTemplateWithMissing(authValueRaw, input.Variables)
	if len(authMissing) > 0 {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点参数未解析：" + strings.Join(authMissing, "，")}, nil
	}
	authValue := strings.TrimSpace(authValueRendered)
	authHeaderName := strings.TrimSpace(toString(authorization["header"]))
	if authHeaderName == "" {
		authHeaderName = "Authorization"
	}
	if authType != "" && authType != "none" && authValue == "" && strings.Contains(authValueRaw, "{{") {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点鉴权参数未解析"}, nil
	}
	if authType == "bearer" && authValue != "" {
		if !strings.HasPrefix(strings.ToLower(authValue), "bearer ") {
			authValue = "Bearer " + authValue
		}
		headers.Set(authHeaderName, authValue)
	}
	if authType == "api-key" && authValue != "" {
		headers.Set(authHeaderName, authValue)
	}

	bodyType := toString(input.Node.Data.Config["bodyType"])
	if bodyType == "" {
		bodyType = "none"
	}
	bodyTemplate := toString(input.Node.Data.Config["body"])
	var bodyReader io.Reader
	if bodyType != "none" && method != http.MethodGet && method != http.MethodHead {
		body, missing := renderTemplateWithMissing(bodyTemplate, input.Variables)
		if len(missing) > 0 {
			return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 节点参数未解析：" + strings.Join(missing, "，")}, nil
		}
		bodyReader = strings.NewReader(body)
		if bodyType == "json" && headers.Get("content-type") == "" {
			headers.Set("content-type", "application/json")
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, u.String(), bodyReader)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 请求失败"}, nil
	}
	req.Header = headers

	client := &http.Client{Timeout: time.Duration(timeoutSeconds*1000) * time.Millisecond}
	resp, err := client.Do(req)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: err.Error()}, nil
	}
	defer resp.Body.Close()

	rawText, err := io.ReadAll(resp.Body)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "HTTP 请求失败"}, nil
	}
	text := string(rawText)
	var parsed any = text
	if strings.TrimSpace(text) != "" {
		var v any
		if json.Unmarshal(rawText, &v) == nil {
			parsed = v
		}
	}

	output := map[string]any{
		"status": resp.StatusCode,
		"ok":     resp.StatusCode >= 200 && resp.StatusCode < 300,
		"body":   parsed,
		"raw":    text,
	}

	writebacks := buildHTTPWritebacks(input.Node.Data.Config["writebackMappings"], parsed, output)
	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: output, Writebacks: writebacks}, nil
}

func slicesContains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

type apiRequestExecutor struct{}

func (apiRequestExecutor) Execute(ctx context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	cfg := input.Node.Data.Config
	route := toObject(cfg["route"])
	method := strings.ToUpper(strings.TrimSpace(toString(route["method"])))
	if method == "" {
		method = http.MethodGet
	}
	pathTemplate := strings.TrimSpace(toString(route["path"]))
	if pathTemplate == "" {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "API 请求节点 route.path 为空"}, nil
	}

	timeoutSeconds, _ := toNumber(cfg["timeout"])
	if timeoutSeconds <= 0 {
		timeoutSeconds = 30
	}

	expectedStatusCode := 200
	if raw, ok := cfg["successStatusCode"]; ok {
		if n, err := toNumber(raw); err == nil && n > 0 {
			expectedStatusCode = int(n)
		}
	}

	paramDefs, _ := cfg["params"].([]any)
	paramValues, _ := cfg["paramValues"].([]any)
	valueByKey := map[string]any{}
	for _, item := range paramValues {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		location := strings.TrimSpace(toString(m["in"]))
		name := strings.TrimSpace(toString(m["name"]))
		if location == "" || name == "" {
			continue
		}
		valueByKey[location+":"+name] = m["value"]
	}

	missing := []string{}
	for _, item := range paramDefs {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		location := strings.TrimSpace(toString(m["in"]))
		name := strings.TrimSpace(toString(m["name"]))
		validation, _ := m["validation"].(map[string]any)
		required, _ := validation["required"].(bool)
		if !required || location == "" || name == "" {
			continue
		}
		raw := valueByKey[location+":"+name]
		resolved := resolveValue(raw, input.Variables)
		if !hasValue(resolved) {
			missing = append(missing, location+"."+name)
		}
	}
	if len(missing) > 0 {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "必填参数未配置：" + strings.Join(missing, "，")}, nil
	}

	finalPath := pathTemplate
	query := url.Values{}
	bodyObj := map[string]any{}

	for key, raw := range valueByKey {
		parts := strings.SplitN(key, ":", 2)
		if len(parts) != 2 {
			continue
		}
		location := parts[0]
		name := parts[1]
		resolved := resolveValue(raw, input.Variables)
		if !hasValue(resolved) {
			continue
		}
		switch location {
		case "path":
			value := url.PathEscape(toString(resolved))
			finalPath = strings.ReplaceAll(finalPath, ":"+name, value)
		case "query":
			query.Set(name, toString(resolved))
		case "body":
			bodyObj[name] = resolved
		}
	}

	internalBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("INTERNAL_API_BASE_URL")), "/")
	if internalBaseURL == "" {
		internalBaseURL = "http://127.0.0.1:8080"
	}
	finalURL := internalBaseURL + finalPath
	if encoded := query.Encode(); encoded != "" {
		if strings.Contains(finalURL, "?") {
			finalURL += "&" + encoded
		} else {
			finalURL += "?" + encoded
		}
	}

	var bodyReader io.Reader
	if method != http.MethodGet && method != http.MethodHead && len(bodyObj) > 0 {
		rawBody, _ := json.Marshal(bodyObj)
		bodyReader = bytes.NewReader(rawBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, finalURL, bodyReader)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "API 请求构造失败"}, nil
	}
	req.Header.Set("accept", "application/json")
	if bodyReader != nil {
		req.Header.Set("content-type", "application/json")
	}
	if requestID := requestIDFromContext(ctx); requestID != "" {
		req.Header.Set("x-request-id", requestID)
	}
	if auth := strings.TrimSpace(authHeaderFromContext(ctx)); auth != "" {
		req.Header.Set("authorization", auth)
	}

	client := &http.Client{Timeout: time.Duration(timeoutSeconds*1000) * time.Millisecond}
	resp, err := client.Do(req)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: err.Error()}, nil
	}
	defer resp.Body.Close()

	rawBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: "API 请求读取响应失败"}, nil
	}

	rawText := string(rawBytes)
	var parsed any
	if strings.TrimSpace(rawText) != "" && json.Unmarshal(rawBytes, &parsed) != nil {
		parsed = rawText
	} else if strings.TrimSpace(rawText) == "" {
		parsed = map[string]any{}
	}

	parsedObj := toObject(parsed)
	statusCode := 0
	if v, ok := parsedObj["statusCode"]; ok {
		if n, err := toNumber(v); err == nil {
			statusCode = int(n)
		}
	}
	message := toString(parsedObj["message"])
	data := parsedObj["data"]

	ok := false
	if statusCode > 0 {
		ok = statusCode == expectedStatusCode
	} else {
		ok = resp.StatusCode == expectedStatusCode
	}
	if ok && !hasValue(data) {
		// 200 成功但响应不是常见 {data: ...} 包装时，返回完整响应，避免信息丢失。
		data = parsed
	}
	responsePayload := parsed
	if ok {
		switch typed := data.(type) {
		case map[string]any:
			if len(typed) > 0 {
				responsePayload = typed
			}
		case []any:
			if len(typed) > 0 {
				responsePayload = typed
			}
		default:
			if hasValue(typed) {
				responsePayload = typed
			}
		}
	}

	output := map[string]any{
		"httpStatus": resp.StatusCode,
		"statusCode": statusCode,
		"ok":         ok,
		"message":    message,
		"response":   responsePayload,
		"result":     responsePayload,
		"rawResponse": parsed,
		"data":       data,
		"url":        finalURL,
		"method":     method,
	}

	if !ok {
		errText := message
		if strings.TrimSpace(errText) == "" {
			errText = fmt.Sprintf("API 请求失败（statusCode=%d http=%d）", statusCode, resp.StatusCode)
		}
		return NodeExecutorResult{Type: NodeExecutorResultFailed, Error: errText, Output: output}, nil
	}

	writebacks := buildWritebacks(cfg["writebackMappings"], output)
	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: output, Writebacks: writebacks}, nil
}

type ifElseNodeExecutor struct{}

func (ifElseNodeExecutor) Execute(_ context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	rawConditions, _ := input.Node.Data.Config["conditions"].([]any)
	elseBranchName := strings.TrimSpace(toString(input.Node.Data.Config["elseBranchName"]))
	if elseBranchName == "" {
		elseBranchName = "else"
	}

	for index, item := range rawConditions {
		condition, ok := item.(map[string]any)
		if !ok {
			continue
		}
		left := resolveValue(condition["left"], input.Variables)
		operator := toString(condition["operator"])
		if operator == "" {
			operator = "eq"
		}
		right := resolveValue(condition["right"], input.Variables)
		if !compareCondition(left, operator, right) {
			continue
		}
		branchName := strings.TrimSpace(toString(condition["name"]))
		if branchName == "" {
			branchName = "分支" + strconv.Itoa(index+1)
		}
		handleID := buildIfElseBranchHandleID(index)
		return NodeExecutorResult{
			Type:       NodeExecutorResultBranch,
			HandleID:   handleID,
			BranchName: branchName,
			Output: map[string]any{
				"branch":       branchName,
				"branchHandle": handleID,
			},
		}, nil
	}

	return NodeExecutorResult{
		Type:       NodeExecutorResultBranch,
		HandleID:   ifElseFallbackHandle(),
		BranchName: elseBranchName,
		Output: map[string]any{
			"branch":       elseBranchName,
			"branchHandle": ifElseFallbackHandle(),
		},
	}, nil
}

type endNodeExecutor struct{}

func (endNodeExecutor) Execute(_ context.Context, input NodeExecutorContext) (NodeExecutorResult, error) {
	rawOutputs, _ := input.Node.Data.Config["outputs"].([]any)
	if len(rawOutputs) == 0 {
		return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: cloneMap(input.Variables)}, nil
	}

	resolved := map[string]any{}
	for _, item := range rawOutputs {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(toString(entry["name"]))
		if name == "" {
			continue
		}
		resolved[name] = resolveValue(entry["source"], input.Variables)
	}

	if len(resolved) == 0 {
		return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: cloneMap(input.Variables)}, nil
	}
	return NodeExecutorResult{Type: NodeExecutorResultSuccess, Output: resolved}, nil
}

var templateRegexp = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

var variablePathAliasReplacer = strings.NewReplacer(
	"用户属性.", "user.",
	"流程参数.", "workflow.",
	"全局参数.", "global.",
)

func normalizeVariablePath(path string) string {
	value := strings.TrimSpace(path)
	if value == "" {
		return ""
	}
	return variablePathAliasReplacer.Replace(value)
}

func getByPathWithFallback(variables map[string]any, path string) (any, bool) {
	path = normalizeVariablePath(path)
	value, found := getByPath(variables, path)
	if found {
		return value, true
	}

	// 兼容：部分历史流程误用 workflow.xxx 引用全局参数 global.xxx
	if strings.HasPrefix(path, "workflow.") {
		suffix := strings.TrimPrefix(path, "workflow.")
		if v, ok := getByPath(variables, "global."+suffix); ok {
			return v, true
		}
		// 兼容：部分流程把“流程参数”当作开始输入（顶层变量），或写在 start 节点输出里
		if v, ok := getByPath(variables, suffix); ok {
			return v, true
		}
		if v, ok := getByPath(variables, "start."+suffix); ok {
			return v, true
		}
	}

	return nil, false
}

func renderTemplate(value string, variables map[string]any) string {
	return templateRegexp.ReplaceAllStringFunc(value, func(full string) string {
		m := templateRegexp.FindStringSubmatch(full)
		if len(m) != 2 {
			return ""
		}
		key := normalizeVariablePath(m[1])
		resolved, found := getByPathWithFallback(variables, key)
		if !found || resolved == nil {
			return ""
		}
		switch v := resolved.(type) {
		case map[string]any, []any:
			raw, _ := json.Marshal(v)
			return string(raw)
		default:
			return toString(resolved)
		}
	})
}

func renderTemplateWithMissing(value string, variables map[string]any) (string, []string) {
	keys := templateRegexp.FindAllStringSubmatch(value, -1)
	missing := map[string]bool{}
	for _, match := range keys {
		if len(match) != 2 {
			continue
		}
		key := normalizeVariablePath(match[1])
		if key == "" {
			continue
		}
		resolved, found := getByPathWithFallback(variables, key)
		if !found || !hasValue(resolved) {
			missing[key] = true
		}
	}
	out := make([]string, 0, len(missing))
	for key := range missing {
		out = append(out, key)
	}
	sort.Strings(out)
	return renderTemplate(value, variables), out
}

func buildNodeWritebacks(mappings any, source any) []Writeback {
	return buildWritebacks(mappings, toObject(source))
}

func buildHTTPWritebacks(mappings any, parsed any, output map[string]any) []Writeback {
	list, ok := mappings.([]any)
	if !ok {
		return nil
	}

	bodyObj := toObject(parsed)
	result := make([]Writeback, 0, len(list))
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		sourcePath := strings.TrimSpace(toString(m["sourcePath"]))
		targetPath := strings.TrimSpace(toString(m["targetPath"]))
		if sourcePath == "" || targetPath == "" {
			continue
		}

		var value any
		if sourcePath == "$" {
			value = parsed
		} else {
			// 兼容历史配置：
			// 1. 直接从响应 body 取值
			// 2. 若 body 为统一报文，允许省略最外层 data.
			// 3. 兜底支持显式从 output wrapper 取值
			value = readFromOutputByPath(bodyObj, sourcePath)
			if !hasValue(value) {
				value = readFromOutputByPath(bodyObj, "data."+sourcePath)
			}
			if !hasValue(value) {
				value = readFromOutputByPath(output, sourcePath)
			}
			if !hasValue(value) {
				value = readFromOutputByPath(output, "body."+sourcePath)
			}
		}

		result = append(result, Writeback{TargetPath: targetPath, Value: value})
	}
	return result
}

func buildWritebacks(mappings any, output map[string]any) []Writeback {
	list, ok := mappings.([]any)
	if !ok {
		return nil
	}
	result := make([]Writeback, 0, len(list))
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		sourcePath := strings.TrimSpace(toString(m["sourcePath"]))
		targetPath := strings.TrimSpace(toString(m["targetPath"]))
		if sourcePath == "" || targetPath == "" {
			continue
		}
		var value any
		if sourcePath == "$" {
			value = output
		} else {
			value = readFromOutputByPath(output, sourcePath)
		}
		result = append(result, Writeback{TargetPath: targetPath, Value: value})
	}
	return result
}

func resolveValue(raw any, variables map[string]any) any {
	str, ok := raw.(string)
	if !ok {
		return raw
	}

	trimmed := strings.TrimSpace(str)
	placeholder := regexp.MustCompile(`^\s*\{\{\s*([^}]+?)\s*\}\}\s*$`)
	if match := placeholder.FindStringSubmatch(trimmed); len(match) == 2 {
		value, found := getByPathWithFallback(variables, normalizeVariablePath(match[1]))
		if found {
			return value
		}
		return nil
	}

	if strings.Contains(trimmed, ".") {
		if value, found := getByPathWithFallback(variables, normalizeVariablePath(trimmed)); found {
			return value
		}
	}

	return parseScalar(trimmed)
}

func compareCondition(left any, operator string, right any) bool {
	switch operator {
	case "empty":
		return !hasValue(left)
	case "not_empty":
		return hasValue(left)
	case "contains":
		return strings.Contains(toString(left), toString(right))
	case "not_contains":
		return !strings.Contains(toString(left), toString(right))
	case "eq":
		return left == right
	case "neq":
		return left != right
	case "gt":
		return toFloat(left) > toFloat(right)
	case "lt":
		return toFloat(left) < toFloat(right)
	default:
		return false
	}
}

func hasValue(value any) bool {
	if value == nil {
		return false
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v) != ""
	case []any:
		return len(v) > 0
	default:
		return true
	}
}

func parseScalar(value string) any {
	if value == "" {
		return ""
	}
	if value == "true" {
		return true
	}
	if value == "false" {
		return false
	}
	if regexp.MustCompile(`^-?\d+(\.\d+)?$`).MatchString(value) {
		if strings.Contains(value, ".") {
			f, _ := strconv.ParseFloat(value, 64)
			return f
		}
		i, _ := strconv.ParseInt(value, 10, 64)
		return float64(i)
	}
	var parsed any
	if json.Unmarshal([]byte(value), &parsed) == nil {
		return parsed
	}
	return value
}

func readFromOutputByPath(output map[string]any, path string) any {
	normalized := normalizePath(path)
	if normalized == "" || normalized == "$" {
		return output
	}
	value, _ := getByPath(output, normalized)
	return value
}

func getByPath(source map[string]any, path string) (any, bool) {
	keys := splitPath(path)
	if len(keys) == 0 {
		return nil, false
	}
	var current any = source
	for _, key := range keys {
		switch typed := current.(type) {
		case map[string]any:
			next, exists := typed[key]
			if !exists {
				return nil, false
			}
			current = next
		case []any:
			index, err := strconv.Atoi(key)
			if err != nil {
				return nil, false
			}
			if index < 0 || index >= len(typed) {
				return nil, false
			}
			current = typed[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func setByPath(target map[string]any, rawPath string, value any) {
	keys := splitPath(normalizeWritebackTargetPath(rawPath, value))
	if len(keys) == 0 {
		return
	}

	isIndex := func(key string) (int, bool) {
		if key == "" {
			return 0, false
		}
		for i := 0; i < len(key); i++ {
			if key[i] < '0' || key[i] > '9' {
				return 0, false
			}
		}
		n, err := strconv.Atoi(key)
		if err != nil || n < 0 {
			return 0, false
		}
		return n, true
	}

	ensureSliceLen := func(list []any, index int) []any {
		if index < 0 {
			return list
		}
		if len(list) > index {
			return list
		}
		next := make([]any, index+1)
		copy(next, list)
		return next
	}

	var setAny func(current any, path []string, value any) any
	setAny = func(current any, path []string, value any) any {
		if len(path) == 0 {
			return current
		}
		if len(path) == 1 {
			switch typed := current.(type) {
			case map[string]any:
				typed[path[0]] = value
				return typed
			case []any:
				index, ok := isIndex(path[0])
				if !ok {
					return typed
				}
				next := ensureSliceLen(typed, index)
				next[index] = value
				return next
			default:
				// 无父容器可写回时直接返回原值
				return current
			}
		}

		key := path[0]
		nextKey := path[1]
		_, nextIsIndex := isIndex(nextKey)

		switch typed := current.(type) {
		case map[string]any:
			child := typed[key]
			if child == nil {
				if nextIsIndex {
					child = []any{}
				} else {
					child = map[string]any{}
				}
			} else {
				if nextIsIndex {
					if _, ok := child.([]any); !ok {
						child = []any{}
					}
				} else {
					if _, ok := child.(map[string]any); !ok {
						child = map[string]any{}
					}
				}
			}
			typed[key] = setAny(child, path[1:], value)
			return typed

		case []any:
			index, ok := isIndex(key)
			if !ok {
				return typed
			}
			next := ensureSliceLen(typed, index)
			child := next[index]
			if child == nil {
				if nextIsIndex {
					child = []any{}
				} else {
					child = map[string]any{}
				}
			} else {
				if nextIsIndex {
					if _, ok := child.([]any); !ok {
						child = []any{}
					}
				} else {
					if _, ok := child.(map[string]any); !ok {
						child = map[string]any{}
					}
				}
			}
			next[index] = setAny(child, path[1:], value)
			return next
		default:
			// 类型不匹配：按下一段推断容器类型
			if nextIsIndex {
				return setAny([]any{}, path, value)
			}
			return setAny(map[string]any{}, path, value)
		}
	}

	// 在 target 中设置一个临时标记，用于检测 setAny 是否返回了新对象
	const markerKey = "__setByPath_marker__"
	target[markerKey] = true

	updated := setAny(target, keys, value)

	// 检查 updated 中是否有标记，以判断是否是同一个对象
	if m, ok := updated.(map[string]any); ok {
		if _, isSameObject := m[markerKey]; isSameObject {
			// 是同一个对象，删除标记即可，修改已经就地完成
			delete(target, markerKey)
		} else {
			// 是新对象，需要替换 target 的内容
			for k := range target {
				delete(target, k)
			}
			for k, v := range m {
				target[k] = v
			}
		}
	} else {
		// updated 不是 map，删除标记（虽然不太可能发生）
		delete(target, markerKey)
	}
}

func normalizeWritebackTargetPath(rawPath string, value any) string {
	path := strings.TrimSpace(rawPath)
	if path == "" {
		return ""
	}
	if _, ok := value.([]any); !ok {
		return path
	}

	keys := splitPath(path)
	if len(keys) < 2 {
		return path
	}

	end := len(keys)
	for end > 0 {
		if _, err := strconv.Atoi(keys[end-1]); err != nil {
			break
		}
		end--
	}
	if end == len(keys) || end == 0 {
		return path
	}
	return strings.Join(keys[:end], ".")
}

func splitPath(path string) []string {
	normalized := normalizePath(path)
	parts := strings.Split(normalized, ".")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func normalizePath(path string) string {
	value := strings.TrimSpace(path)
	value = strings.TrimPrefix(value, "$.")
	value = strings.TrimPrefix(value, "$")
	// 语义：以 [] 结尾表示“整个数组”，不要强制取第 1 个元素
	if strings.HasSuffix(value, "[]") {
		value = strings.TrimSuffix(value, "[]")
	}
	value = regexp.MustCompile(`\[(\d+)\]`).ReplaceAllString(value, `.$1`)
	value = strings.ReplaceAll(value, "[]", ".0")
	return value
}

func toObject(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if m, ok := value.(map[string]any); ok {
		return m
	}
	if m, ok := value.(map[string]interface{}); ok {
		out := map[string]any{}
		for k, v := range m {
			out[k] = v
		}
		return out
	}
	return map[string]any{}
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(source))
	for k, v := range source {
		out[k] = v
	}
	return out
}

func toString(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return fmt.Sprint(value)
	}
}

func toNumber(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case json.Number:
		return v.Float64()
	case string:
		if strings.TrimSpace(v) == "" {
			return 0, errors.New("empty")
		}
		return strconv.ParseFloat(strings.TrimSpace(v), 64)
	default:
		return 0, errors.New("not number")
	}
}

func toFloat(value any) float64 {
	n, err := toNumber(value)
	if err != nil {
		return 0
	}
	return n
}

func buildIfElseBranchHandleID(index int) string {
	return "if-branch-" + strconv.Itoa(index)
}

func ifElseFallbackHandle() string {
	return "if-else"
}
