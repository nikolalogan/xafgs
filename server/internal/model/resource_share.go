package model

import "time"

const (
	ResourceTypeReportTemplate = "report_template"
	ResourcePermissionEdit     = "edit"
)

type ResourceShare struct {
	BaseEntity
	ResourceType string `json:"resourceType"`
	ResourceID   int64  `json:"resourceId"`
	TargetUserID int64  `json:"targetUserId"`
	Permission   string `json:"permission"`
}

type ResourceShareDTO struct {
	ID           int64     `json:"id"`
	ResourceType string    `json:"resourceType"`
	ResourceID   int64     `json:"resourceId"`
	TargetUserID int64     `json:"targetUserId"`
	Permission   string    `json:"permission"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ReportTemplateSharedUserDTO struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

func (entity ResourceShare) ToDTO() ResourceShareDTO {
	return ResourceShareDTO{
		ID:           entity.ID,
		ResourceType: entity.ResourceType,
		ResourceID:   entity.ResourceID,
		TargetUserID: entity.TargetUserID,
		Permission:   entity.Permission,
		CreatedAt:    entity.CreatedAt,
		UpdatedAt:    entity.UpdatedAt,
	}
}
