package service

import (
	"context"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/workflowruntime"
)

type WorkflowExecutionService interface {
	Start(ctx context.Context, input workflowruntime.StartExecutionInput) (workflowruntime.WorkflowExecution, *model.APIError)
	List(ctx context.Context, filter workflowruntime.ExecutionListFilter, requesterID int64, role string) (workflowruntime.ExecutionListResult, *model.APIError)
	Get(ctx context.Context, executionID string, requesterID int64, role string) (*workflowruntime.WorkflowExecution, *model.APIError)
	Subscribe(ctx context.Context, executionID string, requesterID int64, role string) (*workflowruntime.WorkflowExecution, <-chan workflowruntime.WorkflowExecution, func(), *model.APIError)
	Resume(ctx context.Context, executionID string, nodeID string, input map[string]any, requesterID int64, role string) (workflowruntime.WorkflowExecution, *model.APIError)
	Cancel(ctx context.Context, executionID string, requesterID int64, role string) (workflowruntime.WorkflowExecution, *model.APIError)
}

type workflowExecutionService struct {
	runtime *workflowruntime.Runtime
}

func NewWorkflowExecutionService(runtime *workflowruntime.Runtime) WorkflowExecutionService {
	return &workflowExecutionService{runtime: runtime}
}

func (service *workflowExecutionService) Start(ctx context.Context, input workflowruntime.StartExecutionInput) (workflowruntime.WorkflowExecution, *model.APIError) {
	execution, err := service.runtime.StartAsync(ctx, input)
	if err != nil {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return execution, nil
}

func (service *workflowExecutionService) List(
	ctx context.Context,
	filter workflowruntime.ExecutionListFilter,
	requesterID int64,
	role string,
) (workflowruntime.ExecutionListResult, *model.APIError) {
	if !isAdminRole(role) {
		filter.StarterUserID = requesterID
	}
	items, err := service.runtime.List(ctx, filter)
	if err != nil {
		return workflowruntime.ExecutionListResult{}, model.NewAPIError(500, response.CodeInternal, "查询执行列表失败")
	}
	return items, nil
}

func (service *workflowExecutionService) Get(
	ctx context.Context,
	executionID string,
	requesterID int64,
	role string,
) (*workflowruntime.WorkflowExecution, *model.APIError) {
	execution, err := service.runtime.Get(ctx, executionID)
	if err != nil {
		return nil, model.NewAPIError(500, response.CodeInternal, "查询执行失败")
	}
	if execution == nil {
		return nil, model.NewAPIError(404, response.CodeNotFound, "execution 不存在")
	}
	if !canAccessExecution(execution, requesterID, role) {
		return nil, model.NewAPIError(403, response.CodeForbidden, "无权限访问该执行")
	}
	return execution, nil
}

func (service *workflowExecutionService) Subscribe(
	ctx context.Context,
	executionID string,
	requesterID int64,
	role string,
) (*workflowruntime.WorkflowExecution, <-chan workflowruntime.WorkflowExecution, func(), *model.APIError) {
	execution, apiError := service.Get(ctx, executionID, requesterID, role)
	if apiError != nil {
		return nil, nil, nil, apiError
	}
	channel, unsubscribe := service.runtime.SubscribeExecution(executionID)
	return execution, channel, unsubscribe, nil
}

func (service *workflowExecutionService) Resume(
	ctx context.Context,
	executionID string,
	nodeID string,
	input map[string]any,
	requesterID int64,
	role string,
) (workflowruntime.WorkflowExecution, *model.APIError) {
	currentExecution, apiError := service.Get(ctx, executionID, requesterID, role)
	if apiError != nil {
		return workflowruntime.WorkflowExecution{}, apiError
	}
	if currentExecution.Status != workflowruntime.ExecutionStatusWaitingInput {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, "仅 waiting_input 状态允许继续提交")
	}

	updatedExecution, err := service.runtime.ResumeAsync(ctx, workflowruntime.ResumeExecutionInput{
		ExecutionID: executionID,
		NodeID:      nodeID,
		Input:       input,
	})
	if err != nil {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return updatedExecution, nil
}

func (service *workflowExecutionService) Cancel(
	ctx context.Context,
	executionID string,
	requesterID int64,
	role string,
) (workflowruntime.WorkflowExecution, *model.APIError) {
	_, apiError := service.Get(ctx, executionID, requesterID, role)
	if apiError != nil {
		return workflowruntime.WorkflowExecution{}, apiError
	}
	execution, err := service.runtime.Cancel(ctx, executionID)
	if err != nil {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return execution, nil
}

func isAdminRole(role string) bool {
	return role == model.UserRoleAdmin
}

func canAccessExecution(execution *workflowruntime.WorkflowExecution, requesterID int64, role string) bool {
	if execution == nil {
		return false
	}
	if isAdminRole(role) {
		return true
	}
	return requesterID > 0 && execution.StarterUserID == requesterID
}
