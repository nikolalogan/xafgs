package repository

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type WorkflowRepository interface {
	FindByID(workflowID int64) (model.Workflow, bool)
	FindByWorkflowKey(workflowKey string) (model.Workflow, bool)
	FindAll() []model.WorkflowDTO
	FindVersions(workflowID int64) ([]model.WorkflowVersionDTO, bool)
	Create(workflow model.Workflow) model.WorkflowDTO
	Update(workflowID int64, update model.Workflow) (model.WorkflowDTO, bool)
	Publish(workflowID int64) (model.WorkflowDTO, bool)
	Offline(workflowID int64) (model.WorkflowDTO, bool)
	Rollback(workflowID int64, versionNo int) (model.WorkflowDTO, bool)
	Delete(workflowID int64) bool
}

type workflowRepository struct {
	workflows      map[int64]model.Workflow
	versions       map[int64]map[int]workflowVersionSnapshot
	nextWorkflowID int64
}

type workflowVersionSnapshot struct {
	DSL       json.RawMessage
	CreatedAt time.Time
}

func NewWorkflowRepository() WorkflowRepository {
	now := time.Now().UTC()
	defaultDSL := json.RawMessage(`{"nodes":[{"id":"start","type":"custom","position":{"x":80,"y":200},"data":{"title":"开始","type":"start","config":{"variables":[]}}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`)
	return &workflowRepository{
		workflows: map[int64]model.Workflow{
			1: {
				BaseEntity: model.BaseEntity{
					ID:        1,
					CreatedAt: now,
					UpdatedAt: now,
				},
				WorkflowKey:               "demo_workflow",
				Name:                      "示例工作流",
				Description:               "默认初始化工作流",
				MenuKey:                   model.WorkflowMenuKeyReserve,
				Status:                    model.WorkflowStatusActive,
				CurrentDraftVersionNo:     1,
				CurrentPublishedVersionNo: 0,
				BreakerWindowMinutes:      model.DefaultWorkflowBreakerWindowMinutes,
				BreakerMaxRequests:        model.DefaultWorkflowBreakerMaxRequests,
				DSL:                       defaultDSL,
			},
		},
		versions: map[int64]map[int]workflowVersionSnapshot{
			1: {
				1: {
					DSL:       defaultDSL,
					CreatedAt: now,
				},
			},
		},
		nextWorkflowID: 2,
	}
}

func (repository *workflowRepository) FindByID(workflowID int64) (model.Workflow, bool) {
	workflow, ok := repository.workflows[workflowID]
	return workflow, ok
}

func (repository *workflowRepository) FindByWorkflowKey(workflowKey string) (model.Workflow, bool) {
	trimmedWorkflowKey := strings.TrimSpace(workflowKey)
	for _, workflow := range repository.workflows {
		if workflow.WorkflowKey == trimmedWorkflowKey {
			return workflow, true
		}
	}
	return model.Workflow{}, false
}

func (repository *workflowRepository) FindAll() []model.WorkflowDTO {
	ids := make([]int64, 0, len(repository.workflows))
	for workflowID := range repository.workflows {
		ids = append(ids, workflowID)
	}
	sort.Slice(ids, func(i, j int) bool {
		return ids[i] < ids[j]
	})

	workflows := make([]model.WorkflowDTO, 0, len(ids))
	for _, workflowID := range ids {
		workflows = append(workflows, repository.workflows[workflowID].ToDTO())
	}
	return workflows
}

func (repository *workflowRepository) FindVersions(workflowID int64) ([]model.WorkflowVersionDTO, bool) {
	workflow, ok := repository.workflows[workflowID]
	if !ok {
		return nil, false
	}
	versionMap, ok := repository.versions[workflowID]
	if !ok {
		return []model.WorkflowVersionDTO{}, true
	}

	versionNos := make([]int, 0, len(versionMap))
	for versionNo := range versionMap {
		versionNos = append(versionNos, versionNo)
	}
	sort.Ints(versionNos)

	versions := make([]model.WorkflowVersionDTO, 0, len(versionNos))
	for _, versionNo := range versionNos {
		snapshot := versionMap[versionNo]
		versions = append(versions, model.WorkflowVersionDTO{
			VersionNo:   versionNo,
			CreatedAt:   snapshot.CreatedAt,
			IsDraft:     versionNo == workflow.CurrentDraftVersionNo,
			IsPublished: versionNo == workflow.CurrentPublishedVersionNo,
		})
	}
	return versions, true
}

func (repository *workflowRepository) Create(workflow model.Workflow) model.WorkflowDTO {
	now := time.Now().UTC()
	workflow.ID = repository.nextWorkflowID
	workflow.CreatedAt = now
	workflow.UpdatedAt = now
	if workflow.BreakerWindowMinutes <= 0 {
		workflow.BreakerWindowMinutes = model.DefaultWorkflowBreakerWindowMinutes
	}
	if workflow.BreakerMaxRequests <= 0 {
		workflow.BreakerMaxRequests = model.DefaultWorkflowBreakerMaxRequests
	}
	repository.workflows[workflow.ID] = workflow
	repository.versions[workflow.ID] = map[int]workflowVersionSnapshot{
		workflow.CurrentDraftVersionNo: {
			DSL:       workflow.DSL,
			CreatedAt: now,
		},
	}
	repository.nextWorkflowID++
	return workflow.ToDTO()
}

func (repository *workflowRepository) Update(workflowID int64, update model.Workflow) (model.WorkflowDTO, bool) {
	existingWorkflow, ok := repository.workflows[workflowID]
	if !ok {
		return model.WorkflowDTO{}, false
	}

	existingWorkflow.Name = update.Name
	existingWorkflow.Description = update.Description
	existingWorkflow.MenuKey = update.MenuKey
	existingWorkflow.Status = update.Status
	existingWorkflow.BreakerWindowMinutes = update.BreakerWindowMinutes
	existingWorkflow.BreakerMaxRequests = update.BreakerMaxRequests
	if len(update.DSL) > 0 {
		now := time.Now().UTC()
		existingWorkflow.DSL = update.DSL
		existingWorkflow.CurrentDraftVersionNo++
		if _, ok := repository.versions[workflowID]; !ok {
			repository.versions[workflowID] = make(map[int]workflowVersionSnapshot)
		}
		repository.versions[workflowID][existingWorkflow.CurrentDraftVersionNo] = workflowVersionSnapshot{
			DSL:       update.DSL,
			CreatedAt: now,
		}
	}
	existingWorkflow.UpdatedAt = time.Now().UTC()
	repository.workflows[workflowID] = existingWorkflow
	return existingWorkflow.ToDTO(), true
}

func (repository *workflowRepository) Publish(workflowID int64) (model.WorkflowDTO, bool) {
	existingWorkflow, ok := repository.workflows[workflowID]
	if !ok {
		return model.WorkflowDTO{}, false
	}
	existingWorkflow.CurrentPublishedVersionNo = existingWorkflow.CurrentDraftVersionNo
	existingWorkflow.UpdatedAt = time.Now().UTC()
	repository.workflows[workflowID] = existingWorkflow
	return existingWorkflow.ToDTO(), true
}

func (repository *workflowRepository) Offline(workflowID int64) (model.WorkflowDTO, bool) {
	existingWorkflow, ok := repository.workflows[workflowID]
	if !ok {
		return model.WorkflowDTO{}, false
	}
	existingWorkflow.CurrentPublishedVersionNo = 0
	existingWorkflow.UpdatedAt = time.Now().UTC()
	repository.workflows[workflowID] = existingWorkflow
	return existingWorkflow.ToDTO(), true
}

func (repository *workflowRepository) Rollback(workflowID int64, versionNo int) (model.WorkflowDTO, bool) {
	existingWorkflow, ok := repository.workflows[workflowID]
	if !ok {
		return model.WorkflowDTO{}, false
	}

	versionMap, ok := repository.versions[workflowID]
	if !ok {
		return model.WorkflowDTO{}, false
	}

	snapshot, ok := versionMap[versionNo]
	if !ok {
		return model.WorkflowDTO{}, false
	}

	existingWorkflow.DSL = snapshot.DSL
	existingWorkflow.CurrentDraftVersionNo = versionNo
	existingWorkflow.CurrentPublishedVersionNo = versionNo
	existingWorkflow.UpdatedAt = time.Now().UTC()
	repository.workflows[workflowID] = existingWorkflow
	return existingWorkflow.ToDTO(), true
}

func (repository *workflowRepository) Delete(workflowID int64) bool {
	if _, ok := repository.workflows[workflowID]; !ok {
		return false
	}
	delete(repository.workflows, workflowID)
	delete(repository.versions, workflowID)
	return true
}
