package handler

import (
	"bufio"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
	"sxfgssever/server/internal/workflowruntime"
)

type requiredUserConfigField struct {
	key   string
	label string
}

var requiredUserConfigFields = []requiredUserConfigField{
	{key: "warningAccount", label: "预警通账号"},
	{key: "warningPassword", label: "预警通密码"},
	{key: "aiBaseUrl", label: "AI 服务商地址"},
	{key: "aiApiKey", label: "AI APIKey"},
}

var requiredAIUserConfigFields = []requiredUserConfigField{
	{key: "aiBaseUrl", label: "AI 服务商地址"},
	{key: "aiApiKey", label: "AI APIKey"},
}

type executionIDPathRequest struct {
	ID string `path:"id" validate:"required"`
}

type listWorkflowTaskRequest struct {
	Page       *int64 `query:"page" validate:"omitempty,min=1"`
	PageSize   *int64 `query:"pageSize" validate:"omitempty,min=1,max=200"`
	Status     string `query:"status"`
	WorkflowID *int64 `query:"workflowId" validate:"omitempty,min=1"`
	MenuKey    string `query:"menuKey"`
	Keyword    string `query:"keyword"`
}

type startWorkflowExecutionRequest struct {
	WorkflowID  int64          `json:"workflowId" validate:"required,min=1"`
	WorkflowDSL any            `json:"workflowDsl"`
	DSL         any            `json:"dsl"`
	Input       map[string]any `json:"input"`
}

type resumeWorkflowExecutionRequest struct {
	ID     string         `path:"id" validate:"required"`
	NodeID string         `json:"nodeId" validate:"required"`
	Input  map[string]any `json:"input"`
}

type WorkflowExecutionHandler struct {
	service           service.WorkflowExecutionService
	workflowService   service.WorkflowService
	rateLimiter       service.WorkflowExecutionRateLimiter
	userConfigService service.UserConfigService
	registry          *apimeta.Registry
}

func NewWorkflowExecutionHandler(
	service service.WorkflowExecutionService,
	workflowService service.WorkflowService,
	rateLimiter service.WorkflowExecutionRateLimiter,
	userConfigService service.UserConfigService,
	registry *apimeta.Registry,
) *WorkflowExecutionHandler {
	return &WorkflowExecutionHandler{
		service:           service,
		workflowService:   workflowService,
		rateLimiter:       rateLimiter,
		userConfigService: userConfigService,
		registry:          registry,
	}
}

func (handler *WorkflowExecutionHandler) Register(router fiber.Router, _ fiber.Handler) {
	group := router.Group("")
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[startWorkflowExecutionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/executions",
		Summary:            "创建并启动执行",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Start)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[listWorkflowTaskRequest]{
		Method:             fiber.MethodGet,
		Path:               "/workflow/tasks",
		Summary:            "查询任务历史",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.ExecutionListResult](),
	}, handler.ListTasks)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/workflow/executions/:id",
		Summary:            "获取执行详情",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Get)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/workflow/tasks/:id",
		Summary:            "获取任务详情",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Get)
	group.Get("/workflow/executions/:id/stream", handler.Stream)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[resumeWorkflowExecutionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/executions/:id/resume",
		Summary:            "提交节点输入并继续",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Resume)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[resumeWorkflowExecutionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/tasks/:id/resume",
		Summary:            "提交任务节点输入并继续",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Resume)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[executionIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/workflow/executions/:id",
		Summary:            "取消执行",
		Auth:               "login",
		SuccessDataExample: apimeta.ExampleFromType[workflowruntime.WorkflowExecution](),
	}, handler.Cancel)
}

func (handler *WorkflowExecutionHandler) Start(c *fiber.Ctx, request *startWorkflowExecutionRequest) error {
	if request.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	input := request.Input
	if input == nil {
		input = map[string]any{}
	}

	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	workflow, apiError := handler.workflowService.GetByID(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	publishedDSL, apiError := handler.workflowService.GetPublishedDSLByID(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	dsl, err := workflowruntime.ParseWorkflowDSL(publishedDSL)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "当前工作流已发布 DSL 非法："+err.Error())
	}

	startNode, ok := findStartNode(dsl.Nodes)
	if ok {
		fields := workflowruntime.ParseStartFields(startNode.Data.Config)
		if len(fields) > 0 {
			normalized, validateErr := workflowruntime.ValidateAndNormalizeDynamicInput(fields, input)
			if validateErr != nil {
				return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, validateErr.Error())
			}
			input = normalized
		}
	}

	userConfig, apiError := handler.userConfigService.GetByUserID(c.UserContext(), userID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	if missing := detectMissingRequiredUserConfig(publishedDSL, dsl, userConfig); len(missing) > 0 {
		labels := make([]string, 0, len(missing))
		for _, item := range missing {
			labels = append(labels, item.label)
		}
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少用户配置："+strings.Join(labels, "、"))
	}
	authUser, _ := c.Locals(middleware.LocalAuthUser).(model.User)
	input["user"] = map[string]any{
		"username":        strings.TrimSpace(authUser.Username),
		"warningAccount":  userConfig.WarningAccount,
		"warningPassword": userConfig.WarningPassword,
		"aiBaseUrl":       userConfig.AIBaseURL,
		"aiApiKey":        userConfig.AIApiKey,
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	window := time.Duration(workflow.BreakerWindowMinutes) * time.Minute
	limiterKey := fmt.Sprintf("%d:%d", userID, request.WorkflowID)
	if !handler.rateLimiter.Allow(limiterKey, time.Now().UTC(), window, workflow.BreakerMaxRequests) {
		return response.Error(c, fiber.StatusTooManyRequests, response.CodeTooManyRequests, "请求过快，请稍后重试")
	}
	data, apiError := handler.service.Start(ctx, workflowruntime.StartExecutionInput{
		WorkflowID:    workflow.ID,
		WorkflowName:  workflow.Name,
		MenuKey:       workflow.MenuKey,
		StarterUserID: userID,
		WorkflowDSL:   dsl,
		Input:         input,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "创建并启动执行成功")
}

func (handler *WorkflowExecutionHandler) ListTasks(c *fiber.Ctx, request *listWorkflowTaskRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	page := int64(1)
	if request.Page != nil && *request.Page > 0 {
		page = *request.Page
	}
	pageSize := int64(20)
	if request.PageSize != nil && *request.PageSize > 0 {
		pageSize = *request.PageSize
	}

	filter := workflowruntime.ExecutionListFilter{
		Status:   strings.TrimSpace(request.Status),
		MenuKey:  strings.TrimSpace(request.MenuKey),
		Keyword:  strings.TrimSpace(request.Keyword),
		Page:     page,
		PageSize: pageSize,
	}
	if request.WorkflowID != nil && *request.WorkflowID > 0 {
		filter.WorkflowID = *request.WorkflowID
	}

	data, apiError := handler.service.List(c.UserContext(), filter, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "查询任务历史成功")
}

func findStartNode(nodes []workflowruntime.WorkflowNode) (workflowruntime.WorkflowNode, bool) {
	for _, node := range nodes {
		if node.Data.Type == "start" {
			return node, true
		}
	}
	return workflowruntime.WorkflowNode{}, false
}

func (handler *WorkflowExecutionHandler) Get(c *fiber.Ctx, request *executionIDPathRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Get(ctx, request.ID, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "获取执行详情成功")
}

func (handler *WorkflowExecutionHandler) Stream(c *fiber.Ctx) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	request := &executionIDPathRequest{ID: strings.TrimSpace(c.Params("id"))}
	if request.ID == "" {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "id 不能为空")
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	current, updates, unsubscribe, apiError := handler.service.Subscribe(ctx, request.ID, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	if unsubscribe == nil {
		unsubscribe = func() {}
	}

	c.Set(fiber.HeaderContentType, "text/event-stream")
	c.Set(fiber.HeaderCacheControl, "no-cache, no-transform")
	c.Set(fiber.HeaderConnection, "keep-alive")
	c.Set("X-Accel-Buffering", "no")
	c.Status(fiber.StatusOK)

	writeEvent := func(writer *bufio.Writer, event string, payload any) error {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err = writer.WriteString("event: " + event + "\n"); err != nil {
			return err
		}
		if _, err = writer.WriteString("data: " + string(raw) + "\n\n"); err != nil {
			return err
		}
		return writer.Flush()
	}

	c.Context().SetBodyStreamWriter(func(writer *bufio.Writer) {
		defer unsubscribe()

		if err := writeEvent(writer, "execution.snapshot", current); err != nil {
			return
		}
		if current != nil && current.Status != workflowruntime.ExecutionStatusRunning {
			_ = writeEvent(writer, "execution.closed", map[string]any{
				"executionId": current.ID,
				"status":      current.Status,
			})
			return
		}

		heartbeatTicker := time.NewTicker(12 * time.Second)
		defer heartbeatTicker.Stop()

		for {
			select {
			case execution, ok := <-updates:
				if !ok {
					_ = writeEvent(writer, "execution.closed", map[string]any{
						"executionId": request.ID,
						"status":      "disconnected",
					})
					return
				}
				if err := writeEvent(writer, "execution.snapshot", execution); err != nil {
					return
				}
				if execution.Status != workflowruntime.ExecutionStatusRunning {
					_ = writeEvent(writer, "execution.closed", map[string]any{
						"executionId": execution.ID,
						"status":      execution.Status,
					})
					return
				}
			case <-heartbeatTicker.C:
				if err := writeEvent(writer, "execution.keepalive", map[string]any{
					"executionId": request.ID,
					"at":          time.Now().UTC().Format(time.RFC3339),
				}); err != nil {
					return
				}
			}
		}
	})

	return nil
}

func (handler *WorkflowExecutionHandler) Resume(c *fiber.Ctx, request *resumeWorkflowExecutionRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	request.NodeID = strings.TrimSpace(request.NodeID)
	if request.Input == nil {
		request.Input = map[string]any{}
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Resume(ctx, request.ID, request.NodeID, request.Input, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "提交输入成功")
}

func (handler *WorkflowExecutionHandler) Cancel(c *fiber.Ctx, request *executionIDPathRequest) error {
	userID, role, ok := currentAuthIdentity(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	ctx := workflowruntime.WithRequestID(c.UserContext(), requestID(c))
	ctx = workflowruntime.WithAuthHeader(ctx, strings.TrimSpace(c.Get(fiber.HeaderAuthorization)))
	data, apiError := handler.service.Cancel(ctx, request.ID, userID, role)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "取消执行成功")
}

func currentAuthIdentity(c *fiber.Ctx) (int64, string, bool) {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return 0, "", false
	}
	role, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok {
		return 0, "", false
	}
	return userID, strings.TrimSpace(role), true
}

func requestID(c *fiber.Ctx) string {
	value := c.GetRespHeader(fiber.HeaderXRequestID)
	if value != "" {
		return value
	}
	local := c.Locals("requestid")
	if local == nil {
		return ""
	}
	requestID, ok := local.(string)
	if !ok {
		return ""
	}
	return requestID
}

func detectMissingRequiredUserConfig(rawDSL any, dsl workflowruntime.WorkflowDSL, config model.UserConfigDTO) []requiredUserConfigField {
	raw, err := json.Marshal(rawDSL)
	if err != nil {
		return nil
	}
	text := string(raw)
	if strings.TrimSpace(text) == "" {
		return nil
	}

	values := map[string]string{
		"warningAccount":  strings.TrimSpace(config.WarningAccount),
		"warningPassword": strings.TrimSpace(config.WarningPassword),
		"aiBaseUrl":       strings.TrimSpace(config.AIBaseURL),
		"aiApiKey":        strings.TrimSpace(config.AIApiKey),
	}

	missing := make([]requiredUserConfigField, 0)
	for _, field := range requiredUserConfigFields {
		placeholder := regexp.MustCompile(`\{\{\s*user\.` + regexp.QuoteMeta(field.key) + `\s*\}\}`)
		bare := regexp.MustCompile(`["']\s*user\.` + regexp.QuoteMeta(field.key) + `\s*["']`)
		if !placeholder.MatchString(text) && !bare.MatchString(text) {
			continue
		}
		if values[field.key] != "" {
			continue
		}
		missing = append(missing, field)
	}

	if hasNodeType(dsl.Nodes, "llm") {
		existing := map[string]bool{}
		for _, item := range missing {
			existing[item.key] = true
		}
		for _, field := range requiredAIUserConfigFields {
			if existing[field.key] {
				continue
			}
			if values[field.key] != "" {
				continue
			}
			missing = append(missing, field)
		}
	}
	return missing
}

func hasNodeType(nodes []workflowruntime.WorkflowNode, nodeType string) bool {
	target := strings.TrimSpace(nodeType)
	if target == "" {
		return false
	}
	for _, node := range nodes {
		if strings.TrimSpace(node.Data.Type) == target {
			return true
		}
	}
	return false
}
