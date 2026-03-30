package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type workflowPathParams struct {
	WorkflowID int64 `params:"workflowId"`
}

type WorkflowHandler struct {
	workflowService service.WorkflowService
}

func NewWorkflowHandler(workflowService service.WorkflowService) *WorkflowHandler {
	return &WorkflowHandler{
		workflowService: workflowService,
	}
}

func (handler *WorkflowHandler) Register(router fiber.Router) {
	workflowGroup := router.Group("/workflows")
	workflowGroup.Get("", handler.ListWorkflows)
	workflowGroup.Get("/:workflowId", handler.GetWorkflowByID)
	workflowGroup.Get("/:workflowId/versions", handler.ListWorkflowVersions)
	workflowGroup.Post("", handler.CreateWorkflow)
	workflowGroup.Put("/:workflowId", handler.UpdateWorkflow)
	workflowGroup.Post("/:workflowId/publish", handler.PublishWorkflow)
	workflowGroup.Post("/:workflowId/offline", handler.OfflineWorkflow)
	workflowGroup.Post("/:workflowId/rollback", handler.RollbackWorkflow)
	workflowGroup.Delete("/:workflowId", handler.DeleteWorkflow)
}

func (handler *WorkflowHandler) ListWorkflowVersions(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	versions, apiError := handler.workflowService.ListVersions(c.UserContext(), pathParams.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, versions, "获取工作流版本成功")
}

func (handler *WorkflowHandler) GetWorkflowByID(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	workflow, apiError := handler.workflowService.GetByID(c.UserContext(), pathParams.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "获取工作流成功")
}

func (handler *WorkflowHandler) ListWorkflows(c *fiber.Ctx) error {
	workflows, apiError := handler.workflowService.List(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflows, "获取工作流列表成功")
}

func (handler *WorkflowHandler) CreateWorkflow(c *fiber.Ctx) error {
	var request model.CreateWorkflowRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.WorkflowKey = strings.TrimSpace(request.WorkflowKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)

	workflow, apiError := handler.workflowService.Create(c.UserContext(), request)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, workflow, "创建工作流成功")
}

func (handler *WorkflowHandler) UpdateWorkflow(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	var request model.UpdateWorkflowRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)

	workflow, apiError := handler.workflowService.Update(c.UserContext(), pathParams.WorkflowID, request)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "更新工作流成功")
}

func (handler *WorkflowHandler) DeleteWorkflow(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	apiError := handler.workflowService.Delete(c.UserContext(), pathParams.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除工作流成功")
}

func (handler *WorkflowHandler) PublishWorkflow(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	workflow, apiError := handler.workflowService.Publish(c.UserContext(), pathParams.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "发布工作流成功")
}

func (handler *WorkflowHandler) OfflineWorkflow(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	workflow, apiError := handler.workflowService.Offline(c.UserContext(), pathParams.WorkflowID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "下线工作流成功")
}

func (handler *WorkflowHandler) RollbackWorkflow(c *fiber.Ctx) error {
	var pathParams workflowPathParams
	if err := c.ParamsParser(&pathParams); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "路径参数解析失败")
	}
	if pathParams.WorkflowID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "workflowId 必须为正整数")
	}

	var request model.RollbackWorkflowRequest
	if err := c.BodyParser(&request); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}

	workflow, apiError := handler.workflowService.Rollback(c.UserContext(), pathParams.WorkflowID, request)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, workflow, "回滚工作流成功")
}
