package service

import (
	"context"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/workflowruntime"
)

type WorkflowDebugService interface {
	Create(ctx context.Context, input workflowruntime.StartDebugSessionInput) (workflowruntime.WorkflowDebugSession, *model.APIError)
	Get(ctx context.Context, sessionID string, requesterID int64, role string) (*workflowruntime.WorkflowDebugSession, *model.APIError)
	Continue(ctx context.Context, input workflowruntime.ContinueDebugSessionInput, requesterID int64, role string) (workflowruntime.WorkflowDebugSession, *model.APIError)
	RerunTarget(ctx context.Context, input workflowruntime.RerunDebugTargetInput, requesterID int64, role string) (workflowruntime.WorkflowDebugSession, *model.APIError)
}

type workflowDebugService struct {
	runtime *workflowruntime.Runtime
	store   workflowruntime.DebugSessionStorePort
}

func NewWorkflowDebugService(runtime *workflowruntime.Runtime, store workflowruntime.DebugSessionStorePort) WorkflowDebugService {
	return &workflowDebugService{runtime: runtime, store: store}
}

func (service *workflowDebugService) Create(ctx context.Context, input workflowruntime.StartDebugSessionInput) (workflowruntime.WorkflowDebugSession, *model.APIError) {
	session, err := service.runtime.StartDebugSession(ctx, service.store, input)
	if err != nil {
		return workflowruntime.WorkflowDebugSession{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return session, nil
}

func (service *workflowDebugService) Get(ctx context.Context, sessionID string, requesterID int64, role string) (*workflowruntime.WorkflowDebugSession, *model.APIError) {
	session, err := service.store.Get(sessionID)
	if err != nil {
		return nil, model.NewAPIError(500, response.CodeInternal, "查询 debug session 失败")
	}
	if session == nil {
		return nil, model.NewAPIError(404, response.CodeNotFound, "debug session 不存在")
	}
	if !canAccessDebugSession(session, requesterID, role) {
		return nil, model.NewAPIError(403, response.CodeForbidden, "无权限访问该调试会话")
	}
	return session, nil
}

func (service *workflowDebugService) Continue(ctx context.Context, input workflowruntime.ContinueDebugSessionInput, requesterID int64, role string) (workflowruntime.WorkflowDebugSession, *model.APIError) {
	if _, apiError := service.Get(ctx, input.SessionID, requesterID, role); apiError != nil {
		return workflowruntime.WorkflowDebugSession{}, apiError
	}
	session, err := service.runtime.ContinueDebugSession(ctx, service.store, input)
	if err != nil {
		return workflowruntime.WorkflowDebugSession{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return session, nil
}

func (service *workflowDebugService) RerunTarget(ctx context.Context, input workflowruntime.RerunDebugTargetInput, requesterID int64, role string) (workflowruntime.WorkflowDebugSession, *model.APIError) {
	if _, apiError := service.Get(ctx, input.SessionID, requesterID, role); apiError != nil {
		return workflowruntime.WorkflowDebugSession{}, apiError
	}
	session, err := service.runtime.RerunDebugTarget(ctx, service.store, input)
	if err != nil {
		return workflowruntime.WorkflowDebugSession{}, model.NewAPIError(400, response.CodeBadRequest, err.Error())
	}
	return session, nil
}

func canAccessDebugSession(session *workflowruntime.WorkflowDebugSession, requesterID int64, role string) bool {
	if session == nil {
		return false
	}
	if isAdminRole(role) {
		return true
	}
	return requesterID > 0 && session.CreatorUserID == requesterID
}

