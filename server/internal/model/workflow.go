package model

import (
	"encoding/json"
	"time"
)

const (
	WorkflowStatusActive   = "active"
	WorkflowStatusDisabled = "disabled"
)

const (
	WorkflowMenuKeyReserve  = "reserve"
	WorkflowMenuKeyReview   = "review"
	WorkflowMenuKeyPostLoan = "postloan"
)

func IsValidWorkflowStatus(status string) bool {
	return status == WorkflowStatusActive || status == WorkflowStatusDisabled
}

func IsValidWorkflowMenuKey(menuKey string) bool {
	return menuKey == "" || menuKey == WorkflowMenuKeyReserve || menuKey == WorkflowMenuKeyReview || menuKey == WorkflowMenuKeyPostLoan
}

type Workflow struct {
	BaseEntity
	WorkflowKey              string          `json:"workflowKey"`
	Name                     string          `json:"name"`
	Description              string          `json:"description"`
	MenuKey                  string          `json:"menuKey"`
	Status                   string          `json:"status"`
	CurrentDraftVersionNo    int             `json:"currentDraftVersionNo"`
	CurrentPublishedVersionNo int            `json:"currentPublishedVersionNo"`
	DSL                      json.RawMessage `json:"dsl,omitempty"`
}

type WorkflowDTO struct {
	ID                       int64     `json:"id"`
	WorkflowKey              string    `json:"workflowKey"`
	Name                     string    `json:"name"`
	Description              string    `json:"description"`
	MenuKey                  string    `json:"menuKey"`
	Status                   string    `json:"status"`
	CurrentDraftVersionNo    int       `json:"currentDraftVersionNo"`
	CurrentPublishedVersionNo int      `json:"currentPublishedVersionNo"`
	CreatedAt                time.Time `json:"createdAt"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type WorkflowDetailDTO struct {
	WorkflowDTO
	DSL json.RawMessage `json:"dsl"`
}

type WorkflowVersionDTO struct {
	VersionNo   int       `json:"versionNo"`
	CreatedAt   time.Time `json:"createdAt"`
	IsDraft     bool      `json:"isDraft"`
	IsPublished bool      `json:"isPublished"`
}

func (workflow Workflow) ToDTO() WorkflowDTO {
	return WorkflowDTO{
		ID:                        workflow.ID,
		WorkflowKey:               workflow.WorkflowKey,
		Name:                      workflow.Name,
		Description:               workflow.Description,
		MenuKey:                   workflow.MenuKey,
		Status:                    workflow.Status,
		CurrentDraftVersionNo:     workflow.CurrentDraftVersionNo,
		CurrentPublishedVersionNo: workflow.CurrentPublishedVersionNo,
		CreatedAt:                 workflow.CreatedAt,
		UpdatedAt:                 workflow.UpdatedAt,
	}
}

func (workflow Workflow) ToDetailDTO() WorkflowDetailDTO {
	return WorkflowDetailDTO{
		WorkflowDTO: workflow.ToDTO(),
		DSL:         workflow.DSL,
	}
}
