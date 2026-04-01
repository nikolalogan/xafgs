package handler

import (
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type workflowIDPathRequest struct {
	WorkflowID int64 `path:"workflowId" validate:"required,min=1"`
}

type createWorkflowRequest struct {
	WorkflowKey string          `json:"workflowKey" validate:"required"`
	Name        string          `json:"name" validate:"required"`
	Description string          `json:"description"`
	MenuKey     string          `json:"menuKey" validate:"required,oneof=reserve review postloan"`
	Status      string          `json:"status" validate:"required,oneof=active disabled"`
	DSL         json.RawMessage `json:"dsl" validate:"required"`
}

type updateWorkflowRequest struct {
	WorkflowID  int64           `path:"workflowId" validate:"required,min=1"`
	Name        string          `json:"name" validate:"required"`
	Description string          `json:"description"`
	MenuKey     string          `json:"menuKey" validate:"required,oneof=reserve review postloan"`
	Status      string          `json:"status" validate:"required,oneof=active disabled"`
	DSL         json.RawMessage `json:"dsl" validate:"required"`
}

type rollbackWorkflowRequest struct {
	WorkflowID int64 `path:"workflowId" validate:"required,min=1"`
	VersionNo  int   `json:"versionNo" validate:"required,min=1"`
}

type WorkflowHandler struct {
	workflowService service.WorkflowService
	registry        *apimeta.Registry
}

func NewWorkflowHandler(workflowService service.WorkflowService, registry *apimeta.Registry) *WorkflowHandler {
	return &WorkflowHandler{
		workflowService: workflowService,
		registry:        registry,
	}
}

func (handler *WorkflowHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:  fiber.MethodGet,
		Path:    "/workflows",
		Summary: "获取工作流列表",
		Auth:    "auth",
	}, handler.ListWorkflows)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowIDPathRequest]{
		Method:  fiber.MethodGet,
		Path:    "/workflows/:workflowId",
		Summary: "获取工作流详情",
		Auth:    "auth",
	}, handler.GetWorkflowByID)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowIDPathRequest]{
		Method:  fiber.MethodGet,
		Path:    "/workflows/:workflowId/versions",
		Summary: "获取工作流版本列表",
		Auth:    "auth",
	}, handler.ListWorkflowVersions)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createWorkflowRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflows",
		Summary: "创建工作流",
		Auth:    "auth",
	}, handler.CreateWorkflow)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateWorkflowRequest]{
		Method:  fiber.MethodPut,
		Path:    "/workflows/:workflowId",
		Summary: "更新工作流",
		Auth:    "auth",
	}, handler.UpdateWorkflow)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowIDPathRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflows/:workflowId/publish",
		Summary: "发布工作流",
		Auth:    "auth",
	}, handler.PublishWorkflow)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowIDPathRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflows/:workflowId/offline",
		Summary: "下线工作流",
		Auth:    "auth",
	}, handler.OfflineWorkflow)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[rollbackWorkflowRequest]{
		Method:  fiber.MethodPost,
		Path:    "/workflows/:workflowId/rollback",
		Summary: "回滚工作流",
		Auth:    "auth",
	}, handler.RollbackWorkflow)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowIDPathRequest]{
		Method:  fiber.MethodDelete,
		Path:    "/workflows/:workflowId",
		Summary: "删除工作流",
		Auth:    "auth",
	}, handler.DeleteWorkflow)
}

func (handler *WorkflowHandler) ListWorkflowVersions(c *fiber.Ctx, request *workflowIDPathRequest) error {
	versions, apiError := handler.workflowService.ListVersions(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, versions, "获取工作流版本成功")
}

func (handler *WorkflowHandler) GetWorkflowByID(c *fiber.Ctx, request *workflowIDPathRequest) error {
	workflow, apiError := handler.workflowService.GetByID(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "获取工作流成功")
}

func (handler *WorkflowHandler) ListWorkflows(c *fiber.Ctx, _ *struct{}) error {
	workflows, apiError := handler.workflowService.List(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflows, "获取工作流列表成功")
}

func (handler *WorkflowHandler) CreateWorkflow(c *fiber.Ctx, request *createWorkflowRequest) error {
	request.WorkflowKey = strings.TrimSpace(request.WorkflowKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.MenuKey = strings.TrimSpace(request.MenuKey)
	request.Status = strings.TrimSpace(request.Status)

	workflow, apiError := handler.workflowService.Create(c.UserContext(), model.CreateWorkflowRequest{
		WorkflowKey: request.WorkflowKey,
		Name:        request.Name,
		Description: request.Description,
		MenuKey:     request.MenuKey,
		Status:      request.Status,
		DSL:         request.DSL,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, workflow, "创建工作流成功")
}

func (handler *WorkflowHandler) UpdateWorkflow(c *fiber.Ctx, request *updateWorkflowRequest) error {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.MenuKey = strings.TrimSpace(request.MenuKey)
	request.Status = strings.TrimSpace(request.Status)

	workflow, apiError := handler.workflowService.Update(c.UserContext(), request.WorkflowID, model.UpdateWorkflowRequest{
		Name:        request.Name,
		Description: request.Description,
		MenuKey:     request.MenuKey,
		Status:      request.Status,
		DSL:         request.DSL,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "更新工作流成功")
}

func (handler *WorkflowHandler) DeleteWorkflow(c *fiber.Ctx, request *workflowIDPathRequest) error {
	apiError := handler.workflowService.Delete(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除工作流成功")
}

func (handler *WorkflowHandler) PublishWorkflow(c *fiber.Ctx, request *workflowIDPathRequest) error {
	workflow, apiError := handler.workflowService.Publish(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "发布工作流成功")
}

func (handler *WorkflowHandler) OfflineWorkflow(c *fiber.Ctx, request *workflowIDPathRequest) error {
	workflow, apiError := handler.workflowService.Offline(c.UserContext(), request.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "下线工作流成功")
}

func (handler *WorkflowHandler) RollbackWorkflow(c *fiber.Ctx, request *rollbackWorkflowRequest) error {
	workflow, apiError := handler.workflowService.Rollback(c.UserContext(), request.WorkflowID, model.RollbackWorkflowRequest{
		VersionNo: request.VersionNo,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "回滚工作流成功")
}
