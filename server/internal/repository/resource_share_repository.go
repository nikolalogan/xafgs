package repository

import (
	"sort"
	"time"

	"sxfgssever/server/internal/model"
)

type ResourceShareRepository interface {
	FindByResource(resourceType string, resourceID int64) []model.ResourceShare
	FindByUser(resourceType string, userID int64) []model.ResourceShare
	HasResourceAccess(resourceType string, resourceID int64, userID int64) bool
	ReplaceResourceShares(resourceType string, resourceID int64, userIDs []int64, operatorID int64) []model.ResourceShare
}

type resourceShareRepository struct {
	items  map[int64]model.ResourceShare
	nextID int64
}

func NewResourceShareRepository() ResourceShareRepository {
	return &resourceShareRepository{
		items:  map[int64]model.ResourceShare{},
		nextID: 1,
	}
}

func (repository *resourceShareRepository) FindByResource(resourceType string, resourceID int64) []model.ResourceShare {
	out := make([]model.ResourceShare, 0)
	for _, item := range repository.items {
		if item.ResourceType == resourceType && item.ResourceID == resourceID {
			out = append(out, item)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TargetUserID < out[j].TargetUserID })
	return out
}

func (repository *resourceShareRepository) FindByUser(resourceType string, userID int64) []model.ResourceShare {
	out := make([]model.ResourceShare, 0)
	for _, item := range repository.items {
		if item.ResourceType == resourceType && item.TargetUserID == userID {
			out = append(out, item)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ResourceID < out[j].ResourceID })
	return out
}

func (repository *resourceShareRepository) HasResourceAccess(resourceType string, resourceID int64, userID int64) bool {
	for _, item := range repository.items {
		if item.ResourceType == resourceType && item.ResourceID == resourceID && item.TargetUserID == userID {
			return true
		}
	}
	return false
}

func (repository *resourceShareRepository) ReplaceResourceShares(resourceType string, resourceID int64, userIDs []int64, operatorID int64) []model.ResourceShare {
	for id, item := range repository.items {
		if item.ResourceType == resourceType && item.ResourceID == resourceID {
			delete(repository.items, id)
		}
	}
	now := time.Now().UTC()
	out := make([]model.ResourceShare, 0, len(userIDs))
	unique := map[int64]struct{}{}
	for _, userID := range userIDs {
		if userID <= 0 {
			continue
		}
		if _, exists := unique[userID]; exists {
			continue
		}
		unique[userID] = struct{}{}
		entity := model.ResourceShare{
			BaseEntity: model.BaseEntity{
				ID:        repository.nextID,
				CreatedAt: now,
				UpdatedAt: now,
				CreatedBy: operatorID,
				UpdatedBy: operatorID,
			},
			ResourceType: resourceType,
			ResourceID:   resourceID,
			TargetUserID: userID,
			Permission:   model.ResourcePermissionEdit,
		}
		repository.nextID++
		repository.items[entity.ID] = entity
		out = append(out, entity)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TargetUserID < out[j].TargetUserID })
	return out
}
