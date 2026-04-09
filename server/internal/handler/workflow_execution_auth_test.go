package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/workflowruntime"
)

type fakeWorkflowExecutionService struct {
	lastFilter workflowruntime.ExecutionListFilter
	lastUserID int64
	lastRole   string
}

func (service *fakeWorkflowExecutionService) Start(_ context.Context, _ workflowruntime.StartExecutionInput) (workflowruntime.WorkflowExecution, *model.APIError) {
	return workflowruntime.WorkflowExecution{}, nil
}

func (service *fakeWorkflowExecutionService) List(_ context.Context, filter workflowruntime.ExecutionListFilter, requesterID int64, role string) (workflowruntime.ExecutionListResult, *model.APIError) {
	service.lastFilter = filter
	service.lastUserID = requesterID
	service.lastRole = role
	return workflowruntime.ExecutionListResult{
		Items:    []workflowruntime.WorkflowExecutionSummary{},
		Page:     filter.Page,
		PageSize: filter.PageSize,
		Total:    0,
	}, nil
}

func (service *fakeWorkflowExecutionService) Get(_ context.Context, _ string, _ int64, _ string) (*workflowruntime.WorkflowExecution, *model.APIError) {
	return nil, nil
}

func (service *fakeWorkflowExecutionService) Subscribe(_ context.Context, _ string, _ int64, _ string) (*workflowruntime.WorkflowExecution, <-chan workflowruntime.WorkflowExecution, func(), *model.APIError) {
	ch := make(chan workflowruntime.WorkflowExecution)
	close(ch)
	return nil, ch, func() {}, nil
}

func (service *fakeWorkflowExecutionService) Resume(_ context.Context, _ string, _ string, _ map[string]any, _ int64, _ string) (workflowruntime.WorkflowExecution, *model.APIError) {
	return workflowruntime.WorkflowExecution{}, nil
}

func (service *fakeWorkflowExecutionService) Cancel(_ context.Context, _ string, _ int64, _ string) (workflowruntime.WorkflowExecution, *model.APIError) {
	return workflowruntime.WorkflowExecution{}, nil
}

func TestWorkflowTasksList_AllowsNormalUser(t *testing.T) {
	t.Parallel()

	app := fiber.New()
	executionService := &fakeWorkflowExecutionService{}
	handler := NewWorkflowExecutionHandler(executionService, nil, nil, nil, nil)

	authMiddleware := func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalAuthUserID, int64(2))
		c.Locals(middleware.LocalAuthRole, model.UserRoleNormal)
		return c.Next()
	}

	adminMiddleware := func(c *fiber.Ctx) error {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "仅管理员可访问")
	}

	protectedGroup := app.Group("/api", authMiddleware)
	handler.Register(protectedGroup, adminMiddleware)

	request := httptest.NewRequest(fiber.MethodGet, "/api/workflow/tasks?status=waiting_input&page=1&pageSize=6", nil)
	responseValue, err := app.Test(request)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer responseValue.Body.Close()

	if responseValue.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status 200, got %d", responseValue.StatusCode)
	}

	var payload model.APIResponse
	if err = json.NewDecoder(responseValue.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if payload.Code != response.CodeSuccess {
		t.Fatalf("expected success code, got %s", payload.Code)
	}
	if executionService.lastRole != model.UserRoleNormal {
		t.Fatalf("expected role %s, got %s", model.UserRoleNormal, executionService.lastRole)
	}
	if executionService.lastUserID != 2 {
		t.Fatalf("expected user id 2, got %d", executionService.lastUserID)
	}
	if executionService.lastFilter.Status != "waiting_input" {
		t.Fatalf("expected status filter waiting_input, got %s", executionService.lastFilter.Status)
	}
	if executionService.lastFilter.Page != 1 || executionService.lastFilter.PageSize != 6 {
		t.Fatalf("expected page=1/pageSize=6, got page=%d pageSize=%d", executionService.lastFilter.Page, executionService.lastFilter.PageSize)
	}
}
