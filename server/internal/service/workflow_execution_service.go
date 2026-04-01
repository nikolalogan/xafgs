package service

import (
	"context"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/workflowruntime"
)

type WorkflowExecutionService interface {
	Start(ctx context.Context, workflowDsl workflowruntime.WorkflowDSL, input map[string]any) (workflowruntime.WorkflowExecution, *model.APIError)
	Get(ctx context.Context, executionID string) (*workflowruntime.WorkflowExecution, *model.APIError)
	Resume(ctx context.Context, executionID string, nodeID string, input map[string]any) (workflowruntime.WorkflowExecution, *model.APIError)
	Cancel(ctx context.Context, executionID string) (workflowruntime.WorkflowExecution, *model.APIError)
}

type workflowExecutionService struct {
	runtime *workflowruntime.Runtime
}

func NewWorkflowExecutionService(runtime *workflowruntime.Runtime) WorkflowExecutionService {
	return &workflowExecutionService{runtime: runtime}
}

func (service *workflowExecutionService) Start(
	ctx context.Context,
	workflowDsl workflowruntime.WorkflowDSL,
	input map[string]any,
) (workflowruntime.WorkflowExecution, *model.APIError) {
	execution, err := service.runtime.Start(ctx, workflowruntime.StartExecutionInput{
		WorkflowDSL: workflowDsl,
		Input:       input,
	})
	if err != nil {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return execution, nil
}

func (service *workflowExecutionService) Get(
	ctx context.Context,
	executionID string,
) (*workflowruntime.WorkflowExecution, *model.APIError) {
	execution, err := service.runtime.Get(ctx, executionID)
	if err != nil {
		return nil, model.NewAPIError(500, response.CodeInternal, "查询执行失败")
	}
	if execution == nil {
		return nil, model.NewAPIError(404, response.CodeNotFound, "execution 不存在")
	}
	return execution, nil
}

func (service *workflowExecutionService) Resume(
	ctx context.Context,
	executionID string,
	nodeID string,
	input map[string]any,
) (workflowruntime.WorkflowExecution, *model.APIError) {
	execution, err := service.runtime.Resume(ctx, workflowruntime.ResumeExecutionInput{
		ExecutionID: executionID,
		NodeID:      nodeID,
		Input:       input,
	})
	if err != nil {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return execution, nil
}

func (service *workflowExecutionService) Cancel(
	ctx context.Context,
	executionID string,
) (workflowruntime.WorkflowExecution, *model.APIError) {
	execution, err := service.runtime.Cancel(ctx, executionID)
	if err != nil {
		return workflowruntime.WorkflowExecution{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return execution, nil
}

