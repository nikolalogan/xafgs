package model

import "time"

const (
	EnterpriseProjectStatusDraft      = "draft"
	EnterpriseProjectStatusProcessing = "processing"
	EnterpriseProjectStatusCompleted  = "completed"
	EnterpriseProjectStatusFailed     = "failed"
)

const (
	ReportParseJobStatusPending   = "pending"
	ReportParseJobStatusRunning   = "running"
	ReportParseJobStatusSucceeded = "succeeded"
	ReportParseJobStatusFailed    = "failed"
	ReportParseJobStatusCancelled = "cancelled"
)

type EnterpriseProject struct {
	BaseEntity
	EnterpriseID int64  `json:"enterpriseId"`
	TemplateID   int64  `json:"templateId"`
	ReportCaseID int64  `json:"reportCaseId"`
	Name         string `json:"name"`
	Status       string `json:"status"`
}

type EnterpriseProjectDTO struct {
	ID           int64     `json:"id"`
	EnterpriseID int64     `json:"enterpriseId"`
	TemplateID   int64     `json:"templateId"`
	ReportCaseID int64     `json:"reportCaseId"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ReportParseJob struct {
	ID             int64      `json:"id"`
	ProjectID      int64      `json:"projectId"`
	CaseID         int64      `json:"caseId"`
	CaseFileID     int64      `json:"caseFileId"`
	FileID         int64      `json:"fileId"`
	VersionNo      int        `json:"versionNo"`
	ManualCategory string     `json:"manualCategory"`
	FileTypeGroup  string     `json:"fileTypeGroup"`
	Status         string     `json:"status"`
	RetryCount     int        `json:"retryCount"`
	ErrorMessage   string     `json:"errorMessage"`
	StartedAt      *time.Time `json:"startedAt,omitempty"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type ReportParseJobProgressDTO struct {
	JobID          int64      `json:"jobId"`
	CaseFileID     int64      `json:"caseFileId"`
	FileID         int64      `json:"fileId"`
	VersionNo      int        `json:"versionNo"`
	FileName       string     `json:"fileName"`
	ManualCategory string     `json:"manualCategory"`
	FileTypeGroup  string     `json:"fileTypeGroup"`
	ParseStatus    string     `json:"parseStatus"`
	VectorStatus   string     `json:"vectorStatus"`
	CurrentStage   string     `json:"currentStage"`
	ErrorMessage   string     `json:"errorMessage"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	StartedAt      *time.Time `json:"startedAt,omitempty"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
}

type EnterpriseProjectProgressDTO struct {
	ProjectID int64                       `json:"projectId"`
	Items     []ReportParseJobProgressDTO `json:"items"`
}

type EnterpriseProjectDetailDTO struct {
	Project                 EnterpriseProjectDTO                 `json:"project"`
	Enterprise              EnterpriseDTO                        `json:"enterprise"`
	Template                ReportTemplateDTO                    `json:"template"`
	Categories              []map[string]any                     `json:"categories"`
	UploadedFilesByCategory []EnterpriseProjectUploadedFileGroup `json:"uploadedFilesByCategory"`
}

type CreateEnterpriseProjectRequest struct {
	TemplateID int64  `json:"templateId"`
	Name       string `json:"name"`
}

type UploadEnterpriseProjectFileResultDTO struct {
	ProjectID int64               `json:"projectId"`
	Items     []ReportCaseFileDTO `json:"items"`
}

type EnterpriseProjectFileTerminateResultDTO struct {
	ProjectID    int64  `json:"projectId"`
	CaseFileID   int64  `json:"caseFileId"`
	ParseStatus  string `json:"parseStatus"`
	VectorStatus string `json:"vectorStatus"`
	Message      string `json:"message"`
}

type EnterpriseProjectFileRemoveResultDTO struct {
	ProjectID  int64  `json:"projectId"`
	CaseFileID int64  `json:"caseFileId"`
	Message    string `json:"message"`
}

type EnterpriseProjectFileManualAdjustResultDTO struct {
	ProjectID        int64     `json:"projectId"`
	CaseFileID       int64     `json:"caseFileId"`
	FinalSubCategory string    `json:"finalSubCategory"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type EnterpriseProjectFileBlockSectionDTO struct {
	SectionID string  `json:"sectionId"`
	Title     string  `json:"title"`
	Level     int     `json:"level"`
	Order     int     `json:"order"`
	BlockIDs  []int64 `json:"blockIds"`
}

type EnterpriseProjectFileBlockItemDTO struct {
	BlockID      int64     `json:"blockId"`
	SectionID    string    `json:"sectionId"`
	SliceType    string    `json:"sliceType"`
	SourceType   string    `json:"sourceType"`
	Title        string    `json:"title"`
	PageStart    int       `json:"pageStart"`
	PageEnd      int       `json:"pageEnd"`
	InitialHTML  string    `json:"initialHtml"`
	CurrentHTML  string    `json:"currentHtml"`
	LastSavedAt  time.Time `json:"lastSavedAt"`
}

type EnterpriseProjectFileBlocksDTO struct {
	ProjectID  int64                                 `json:"projectId"`
	CaseFileID int64                                 `json:"caseFileId"`
	Sections   []EnterpriseProjectFileBlockSectionDTO `json:"sections"`
	Blocks     []EnterpriseProjectFileBlockItemDTO    `json:"blocks"`
}

type EnterpriseProjectFileBlockUpdateResultDTO struct {
	ProjectID   int64     `json:"projectId"`
	CaseFileID  int64     `json:"caseFileId"`
	BlockID     int64     `json:"blockId"`
	CurrentHTML string    `json:"currentHtml"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type EnterpriseProjectVectorConfirmItemDTO struct {
	CaseFileID     int64  `json:"caseFileId"`
	FileID         int64  `json:"fileId"`
	VersionNo      int    `json:"versionNo"`
	ManualCategory string `json:"manualCategory"`
	ParseStatus    string `json:"parseStatus"`
	VectorStatus   string `json:"vectorStatus"`
	Action         string `json:"action"`
	Reason         string `json:"reason"`
}

type EnterpriseProjectVectorConfirmResultDTO struct {
	ProjectID int64                                   `json:"projectId"`
	Total     int                                     `json:"total"`
	Enqueued  int                                     `json:"enqueued"`
	Skipped   int                                     `json:"skipped"`
	Failed    int                                     `json:"failed"`
	Items     []EnterpriseProjectVectorConfirmItemDTO `json:"items"`
}

type EnterpriseProjectUploadedFileItem struct {
	CaseFileID      int64     `json:"caseFileId"`
	FileID          int64     `json:"fileId"`
	VersionNo       int       `json:"versionNo"`
	FileName        string    `json:"fileName"`
	ManualCategory  string    `json:"manualCategory"`
	ParseStatus     string    `json:"parseStatus"`
	VectorStatus    string    `json:"vectorStatus"`
	CurrentStage    string    `json:"currentStage"`
	LastError       string    `json:"lastError"`
	LastUpdatedTime time.Time `json:"lastUpdatedTime"`
}

type EnterpriseProjectUploadedFileGroup struct {
	Category string                              `json:"category"`
	Items    []EnterpriseProjectUploadedFileItem `json:"items"`
}

func (entity EnterpriseProject) ToDTO() EnterpriseProjectDTO {
	return EnterpriseProjectDTO{
		ID:           entity.ID,
		EnterpriseID: entity.EnterpriseID,
		TemplateID:   entity.TemplateID,
		ReportCaseID: entity.ReportCaseID,
		Name:         entity.Name,
		Status:       entity.Status,
		CreatedAt:    entity.CreatedAt,
		UpdatedAt:    entity.UpdatedAt,
	}
}
