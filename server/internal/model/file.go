package model

import (
	"encoding/json"
	"time"
)

const (
	FileStatusActive  = "active"
	FileStatusDeleted = "deleted"
)

const (
	FileVersionStatusUploading = "uploading"
	FileVersionStatusUploaded  = "uploaded"
	FileVersionStatusFailed    = "failed"
)

const (
	OCRTaskStatusPending   = "pending"
	OCRTaskStatusRunning   = "running"
	OCRTaskStatusSucceeded = "succeeded"
	OCRTaskStatusFailed    = "failed"
	OCRTaskStatusCancelled = "cancelled"
)

const (
	UploadSessionStatusSelected  = "selected"
	UploadSessionStatusUploading = "uploading"
	UploadSessionStatusUploaded  = "uploaded"
	UploadSessionStatusCancelled = "cancelled"
	UploadSessionStatusExpired   = "expired"
)

const (
	FileParseJobStatusPending   = "pending"
	FileParseJobStatusRunning   = "running"
	FileParseJobStatusSucceeded = "succeeded"
	FileParseJobStatusFailed    = "failed"
	FileParseJobStatusCancelled = "cancelled"
)

func IsValidUploadSessionStatus(status string) bool {
	switch status {
	case UploadSessionStatusSelected,
		UploadSessionStatusUploading,
		UploadSessionStatusUploaded,
		UploadSessionStatusCancelled,
		UploadSessionStatusExpired:
		return true
	default:
		return false
	}
}

type File struct {
	BaseEntity
	BizKey          string `json:"bizKey"`
	LatestVersionNo int    `json:"latestVersionNo"`
	Status          string `json:"status"`
}

type FileVersion struct {
	ID         int64     `json:"id"`
	FileID     int64     `json:"fileId"`
	VersionNo  int       `json:"versionNo"`
	StorageKey string    `json:"storageKey"`
	OriginName string    `json:"originName"`
	MimeType   string    `json:"mimeType"`
	SizeBytes  int64     `json:"sizeBytes"`
	Checksum   string    `json:"checksum"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type UploadSession struct {
	ID              string    `json:"id"`
	FileID          int64     `json:"fileId"`
	TargetVersionNo int       `json:"targetVersionNo"`
	Status          string    `json:"status"`
	ExpiresAt       time.Time `json:"expiresAt"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	CreatedBy       int64     `json:"createdBy"`
	UpdatedBy       int64     `json:"updatedBy"`
}

type FileVersionDTO struct {
	ID         int64     `json:"id"`
	FileID     int64     `json:"fileId"`
	VersionNo  int       `json:"versionNo"`
	OriginName string    `json:"originName"`
	MimeType   string    `json:"mimeType"`
	SizeBytes  int64     `json:"sizeBytes"`
	Checksum   string    `json:"checksum"`
	StorageKey string    `json:"storageKey"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type FileDTO struct {
	ID              int64           `json:"id"`
	BizKey          string          `json:"bizKey"`
	LatestVersionNo int             `json:"latestVersionNo"`
	Status          string          `json:"status"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	LatestVersion   *FileVersionDTO `json:"latestVersion,omitempty"`
}

type UploadSessionDTO struct {
	ID              string    `json:"id"`
	FileID          int64     `json:"fileId"`
	TargetVersionNo int       `json:"targetVersionNo"`
	Status          string    `json:"status"`
	ExpiresAt       time.Time `json:"expiresAt"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type FileUploadResultDTO struct {
	FileID    int64          `json:"fileId"`
	VersionNo int            `json:"versionNo"`
	SessionID string         `json:"sessionId,omitempty"`
	File      FileDTO        `json:"file"`
	Version   FileVersionDTO `json:"version"`
}

type FileParseResultDTO struct {
	Version       FileVersionDTO              `json:"version"`
	Profile       json.RawMessage             `json:"profile"`
	OCRPending    bool                        `json:"ocrPending"`
	OCRTaskID     int64                       `json:"ocrTaskId"`
	OCRTaskStatus string                      `json:"ocrTaskStatus"`
	OCRProvider   string                      `json:"ocrProvider"`
	OCRError      string                      `json:"ocrError"`
	SliceCount    int                         `json:"sliceCount"`
	TableCount    int                         `json:"tableCount"`
	FigureCount   int                         `json:"figureCount"`
	FragmentCount int                         `json:"fragmentCount"`
	CellCount     int                         `json:"cellCount"`
	Markdown      string                      `json:"markdown,omitempty"`
	Text          string                      `json:"text,omitempty"`
	Document      json.RawMessage             `json:"document,omitempty"`
	Slices        []FileParseSlicePreviewDTO  `json:"slices"`
	Tables        []FileParseTablePreviewDTO  `json:"tables"`
	Figures       []FileParseFigurePreviewDTO `json:"figures"`
}

type FileParseSlicePreviewDTO struct {
	SliceType   string          `json:"sliceType"`
	Title       string          `json:"title"`
	PageStart   int             `json:"pageStart"`
	PageEnd     int             `json:"pageEnd"`
	SourceRef   string          `json:"sourceRef"`
	BBox        json.RawMessage `json:"bbox"`
	CleanText   string          `json:"cleanText"`
	Confidence  float64         `json:"confidence"`
	ParseStatus string          `json:"parseStatus"`
}

type FileParseTableCellPreviewDTO struct {
	Text      string `json:"text"`
	SourceRef string `json:"sourceRef"`
}

type FileParseTableRowPreviewDTO struct {
	RowIndex int                            `json:"rowIndex"`
	Cells    []FileParseTableCellPreviewDTO `json:"cells"`
}

type FileParseTablePreviewDTO struct {
	Title          string                        `json:"title"`
	PageStart      int                           `json:"pageStart"`
	PageEnd        int                           `json:"pageEnd"`
	HeaderRowCount int                           `json:"headerRowCount"`
	ColumnCount    int                           `json:"columnCount"`
	SourceRef      string                        `json:"sourceRef"`
	BBox           json.RawMessage               `json:"bbox"`
	PreviewRows    []FileParseTableRowPreviewDTO `json:"previewRows"`
}

type FileParseFigurePreviewDTO struct {
	Title       string                            `json:"title"`
	FigureType  string                            `json:"figureType"`
	PageNo      int                               `json:"pageNo"`
	SourceRef   string                            `json:"sourceRef"`
	BBox        json.RawMessage                   `json:"bbox"`
	CleanText   string                            `json:"cleanText"`
	Regions     []FileParseFigureRegionPreviewDTO `json:"regions"`
	Confidence  float64                           `json:"confidence"`
	ParseStatus string                            `json:"parseStatus"`
}

type FileParseFigureRegionPreviewDTO struct {
	RowIndex  int             `json:"rowIndex"`
	Region    string          `json:"region"`
	Text      string          `json:"text"`
	SourceRef string          `json:"sourceRef"`
	BBox      json.RawMessage `json:"bbox"`
}

type FileParseJob struct {
	ID            int64           `json:"id"`
	FileID        int64           `json:"fileId"`
	VersionNo     int             `json:"versionNo"`
	SourceScope   string          `json:"sourceScope"`
	ProjectID     int64           `json:"projectId"`
	ProjectName   string          `json:"projectName"`
	CaseFileID    int64           `json:"caseFileId"`
	ManualCategory string         `json:"manualCategory"`
	Status        string          `json:"status"`
	RetryCount    int             `json:"retryCount"`
	ErrorMessage  string          `json:"errorMessage"`
	FileType      string          `json:"fileType"`
	SourceType    string          `json:"sourceType"`
	ParseStrategy string          `json:"parseStrategy"`
	OCRTaskStatus string          `json:"ocrTaskStatus"`
	OCRPending    bool            `json:"ocrPending"`
	OCRError      string          `json:"ocrError"`
	ResultJSON    json.RawMessage `json:"resultJson"`
	RequestedBy   int64           `json:"requestedBy"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	StartedAt     *time.Time      `json:"startedAt,omitempty"`
	FinishedAt    *time.Time      `json:"finishedAt,omitempty"`
}

type FileParseJobDTO struct {
	JobID          int64               `json:"jobId"`
	FileID         int64               `json:"fileId"`
	VersionNo      int                 `json:"versionNo"`
	SourceScope    string              `json:"sourceScope"`
	ProjectID      int64               `json:"projectId"`
	ProjectName    string              `json:"projectName"`
	CaseFileID     int64               `json:"caseFileId"`
	ManualCategory string              `json:"manualCategory"`
	Status         string              `json:"status"`
	RetryCount     int                 `json:"retryCount"`
	ErrorMessage   string              `json:"errorMessage"`
	FileType       string              `json:"fileType"`
	SourceType     string              `json:"sourceType"`
	ParseStrategy  string              `json:"parseStrategy"`
	OCRTaskStatus  string              `json:"ocrTaskStatus"`
	OCRPending     bool                `json:"ocrPending"`
	OCRError       string              `json:"ocrError"`
	UpdatedAt      time.Time           `json:"updatedAt"`
	StartedAt      *time.Time          `json:"startedAt,omitempty"`
	FinishedAt     *time.Time          `json:"finishedAt,omitempty"`
	LatestResult   *FileParseResultDTO `json:"latestResult,omitempty"`
	ResultReady    bool                `json:"resultReady"`
	RequestIgnored bool                `json:"requestIgnored,omitempty"`
}

type FileParseQueueItemDTO struct {
	JobID         int64      `json:"jobId"`
	FileID        int64      `json:"fileId"`
	VersionNo     int        `json:"versionNo"`
	FileName      string     `json:"fileName"`
	SourceScope   string     `json:"sourceScope"`
	ProjectID     int64      `json:"projectId"`
	ProjectName   string     `json:"projectName"`
	CaseFileID    int64      `json:"caseFileId"`
	ManualCategory string    `json:"manualCategory"`
	FileType      string     `json:"fileType"`
	SourceType    string     `json:"sourceType"`
	ParseStrategy string     `json:"parseStrategy"`
	OCRTaskStatus string     `json:"ocrTaskStatus"`
	OCRPending    bool       `json:"ocrPending"`
	OCRError      string     `json:"ocrError"`
	ParseStatus   string     `json:"parseStatus"`
	CurrentStage  string     `json:"currentStage"`
	ErrorMessage  string     `json:"errorMessage"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	StartedAt     *time.Time `json:"startedAt,omitempty"`
	FinishedAt    *time.Time `json:"finishedAt,omitempty"`
}

type FileParseJobContext struct {
	SourceScope    string `json:"sourceScope"`
	ProjectID      int64  `json:"projectId"`
	ProjectName    string `json:"projectName"`
	CaseFileID     int64  `json:"caseFileId"`
	ManualCategory string `json:"manualCategory"`
}

func (file File) ToDTO(latest *FileVersion) FileDTO {
	dto := FileDTO{
		ID:              file.ID,
		BizKey:          file.BizKey,
		LatestVersionNo: file.LatestVersionNo,
		Status:          file.Status,
		CreatedAt:       file.CreatedAt,
		UpdatedAt:       file.UpdatedAt,
	}
	if latest != nil {
		versionDTO := latest.ToDTO()
		dto.LatestVersion = &versionDTO
	}
	return dto
}

func (version FileVersion) ToDTO() FileVersionDTO {
	return FileVersionDTO{
		ID:         version.ID,
		FileID:     version.FileID,
		VersionNo:  version.VersionNo,
		OriginName: version.OriginName,
		MimeType:   version.MimeType,
		SizeBytes:  version.SizeBytes,
		Checksum:   version.Checksum,
		StorageKey: version.StorageKey,
		Status:     version.Status,
		CreatedAt:  version.CreatedAt,
		UpdatedAt:  version.UpdatedAt,
	}
}

func (session UploadSession) ToDTO() UploadSessionDTO {
	return UploadSessionDTO{
		ID:              session.ID,
		FileID:          session.FileID,
		TargetVersionNo: session.TargetVersionNo,
		Status:          session.Status,
		ExpiresAt:       session.ExpiresAt,
		CreatedAt:       session.CreatedAt,
		UpdatedAt:       session.UpdatedAt,
	}
}

type UploadedFileMeta struct {
	OriginName string
	MimeType   string
	SizeBytes  int64
	Checksum   string
	StorageKey string
}

type OCRTask struct {
	ID                 int64           `json:"id"`
	FileID             int64           `json:"fileId"`
	VersionNo          int             `json:"versionNo"`
	Status             string          `json:"status"`
	ProviderMode       string          `json:"providerMode"`
	ProviderUsed       string          `json:"providerUsed"`
	ProviderTaskID     string          `json:"providerTaskId"`
	RequestPayloadJSON json.RawMessage `json:"requestPayloadJson"`
	ResultPayloadJSON  json.RawMessage `json:"resultPayloadJson"`
	PageCount          int             `json:"pageCount"`
	Confidence         float64         `json:"confidence"`
	ErrorCode          string          `json:"errorCode"`
	ErrorMessage       string          `json:"errorMessage"`
	RetryCount         int             `json:"retryCount"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
	StartedAt          *time.Time      `json:"startedAt,omitempty"`
	FinishedAt         *time.Time      `json:"finishedAt,omitempty"`
}

type OCRTaskDTO struct {
	ID             int64           `json:"id"`
	FileID         int64           `json:"fileId"`
	VersionNo      int             `json:"versionNo"`
	Status         string          `json:"status"`
	ProviderMode   string          `json:"providerMode"`
	ProviderUsed   string          `json:"providerUsed"`
	ProviderTaskID string          `json:"providerTaskId"`
	PageCount      int             `json:"pageCount"`
	Confidence     float64         `json:"confidence"`
	ErrorCode      string          `json:"errorCode"`
	ErrorMessage   string          `json:"errorMessage"`
	RetryCount     int             `json:"retryCount"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	StartedAt      *time.Time      `json:"startedAt,omitempty"`
	FinishedAt     *time.Time      `json:"finishedAt,omitempty"`
	Result         json.RawMessage `json:"result,omitempty"`
}

func (task OCRTask) ToDTO(includeResult bool) OCRTaskDTO {
	dto := OCRTaskDTO{
		ID:             task.ID,
		FileID:         task.FileID,
		VersionNo:      task.VersionNo,
		Status:         task.Status,
		ProviderMode:   task.ProviderMode,
		ProviderUsed:   task.ProviderUsed,
		ProviderTaskID: task.ProviderTaskID,
		PageCount:      task.PageCount,
		Confidence:     task.Confidence,
		ErrorCode:      task.ErrorCode,
		ErrorMessage:   task.ErrorMessage,
		RetryCount:     task.RetryCount,
		CreatedAt:      task.CreatedAt,
		UpdatedAt:      task.UpdatedAt,
		StartedAt:      task.StartedAt,
		FinishedAt:     task.FinishedAt,
	}
	if includeResult {
		dto.Result = task.ResultPayloadJSON
	}
	return dto
}
