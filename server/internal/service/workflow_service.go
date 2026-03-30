package service

import (
	"context"
	"encoding/json"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type WorkflowService interface {
	GetByID(ctx context.Context, workflowID int64) (model.WorkflowDetailDTO, *model.APIError)
	List(ctx context.Context) ([]model.WorkflowDTO, *model.APIError)
	ListVersions(ctx context.Context, workflowID int64) ([]model.WorkflowVersionDTO, *model.APIError)
	Create(ctx context.Context, request model.CreateWorkflowRequest) (model.WorkflowDTO, *model.APIError)
	Update(ctx context.Context, workflowID int64, request model.UpdateWorkflowRequest) (model.WorkflowDTO, *model.APIError)
	Publish(ctx context.Context, workflowID int64) (model.WorkflowDTO, *model.APIError)
	Offline(ctx context.Context, workflowID int64) (model.WorkflowDTO, *model.APIError)
	Rollback(ctx context.Context, workflowID int64, request model.RollbackWorkflowRequest) (model.WorkflowDTO, *model.APIError)
	Delete(ctx context.Context, workflowID int64) *model.APIError
}

type workflowService struct {
	workflowRepository repository.WorkflowRepository
}

func NewWorkflowService(workflowRepository repository.WorkflowRepository) WorkflowService {
	return &workflowService{
		workflowRepository: workflowRepository,
	}
}

func (service *workflowService) GetByID(_ context.Context, workflowID int64) (model.WorkflowDetailDTO, *model.APIError) {
	workflow, ok := service.workflowRepository.FindByID(workflowID)
	if !ok {
		return model.WorkflowDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "工作流不存在")
	}
	return workflow.ToDetailDTO(), nil
}

func (service *workflowService) List(_ context.Context) ([]model.WorkflowDTO, *model.APIError) {
	return service.workflowRepository.FindAll(), nil
}

func (service *workflowService) ListVersions(_ context.Context, workflowID int64) ([]model.WorkflowVersionDTO, *model.APIError) {
	versions, ok := service.workflowRepository.FindVersions(workflowID)
	if !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "工作流不存在")
	}
	return versions, nil
}

func (service *workflowService) Create(
	_ context.Context,
	request model.CreateWorkflowRequest,
) (model.WorkflowDTO, *model.APIError) {
	request.WorkflowKey = strings.TrimSpace(request.WorkflowKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)

	if request.WorkflowKey == "" || request.Name == "" {
		return model.WorkflowDTO{}, model.NewAPIError(400, response.CodeBadRequest, "workflowKey、name 不能为空")
	}
	if request.Status == "" {
		request.Status = model.WorkflowStatusActive
	}
	if !model.IsValidWorkflowStatus(request.Status) {
		return model.WorkflowDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	if _, exists := service.workflowRepository.FindByWorkflowKey(request.WorkflowKey); exists {
		return model.WorkflowDTO{}, model.NewAPIError(400, response.CodeBadRequest, "workflowKey 已存在")
	}
	dsl, apiError := ensureWorkflowDSL(request.DSL)
	if apiError != nil {
		return model.WorkflowDTO{}, apiError
	}

	workflow := model.Workflow{
		WorkflowKey:               request.WorkflowKey,
		Name:                      request.Name,
		Description:               request.Description,
		Status:                    request.Status,
		CurrentDraftVersionNo:     1,
		CurrentPublishedVersionNo: 0,
		DSL:                       dsl,
	}
	return service.workflowRepository.Create(workflow), nil
}

func (service *workflowService) Update(
	_ context.Context,
	workflowID int64,
	request model.UpdateWorkflowRequest,
) (model.WorkflowDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)

	if request.Name == "" {
		return model.WorkflowDTO{}, model.NewAPIError(400, response.CodeBadRequest, "name 不能为空")
	}
	if request.Status == "" {
		request.Status = model.WorkflowStatusActive
	}
	if !model.IsValidWorkflowStatus(request.Status) {
		return model.WorkflowDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}

	var dsl json.RawMessage
	if len(request.DSL) > 0 {
		normalizedDSL, apiError := ensureWorkflowDSL(request.DSL)
		if apiError != nil {
			return model.WorkflowDTO{}, apiError
		}
		dsl = normalizedDSL
	}

	updatedWorkflow, ok := service.workflowRepository.Update(workflowID, model.Workflow{
		Name:        request.Name,
		Description: request.Description,
		Status:      request.Status,
		DSL:         dsl,
	})
	if !ok {
		return model.WorkflowDTO{}, model.NewAPIError(404, response.CodeNotFound, "工作流不存在")
	}
	return updatedWorkflow, nil
}

func (service *workflowService) Delete(_ context.Context, workflowID int64) *model.APIError {
	if !service.workflowRepository.Delete(workflowID) {
		return model.NewAPIError(404, response.CodeNotFound, "工作流不存在")
	}
	return nil
}

func (service *workflowService) Publish(_ context.Context, workflowID int64) (model.WorkflowDTO, *model.APIError) {
	workflow, ok := service.workflowRepository.Publish(workflowID)
	if !ok {
		return model.WorkflowDTO{}, model.NewAPIError(404, response.CodeNotFound, "工作流不存在")
	}
	return workflow, nil
}

func (service *workflowService) Offline(_ context.Context, workflowID int64) (model.WorkflowDTO, *model.APIError) {
	workflow, ok := service.workflowRepository.Offline(workflowID)
	if !ok {
		return model.WorkflowDTO{}, model.NewAPIError(404, response.CodeNotFound, "工作流不存在")
	}
	return workflow, nil
}

func (service *workflowService) Rollback(
	_ context.Context,
	workflowID int64,
	request model.RollbackWorkflowRequest,
) (model.WorkflowDTO, *model.APIError) {
	if request.VersionNo <= 0 {
		return model.WorkflowDTO{}, model.NewAPIError(400, response.CodeBadRequest, "versionNo 必须为正整数")
	}
	workflow, ok := service.workflowRepository.Rollback(workflowID, request.VersionNo)
	if !ok {
		return model.WorkflowDTO{}, model.NewAPIError(404, response.CodeNotFound, "工作流或版本不存在")
	}
	return workflow, nil
}

func ensureWorkflowDSL(raw json.RawMessage) (json.RawMessage, *model.APIError) {
	if len(raw) == 0 {
		return json.RawMessage(`{"nodes":[{"id":"start","type":"custom","position":{"x":80,"y":200},"data":{"title":"开始","type":"start","config":{"variables":[]}}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`), nil
	}

	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "dsl 不是合法 JSON")
	}
	nodes, ok := root["nodes"].([]any)
	if !ok || len(nodes) == 0 {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "dsl.nodes 不能为空")
	}
	normalized, err := json.Marshal(root)
	if err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "dsl 序列化失败")
	}
	return normalized, nil
}
