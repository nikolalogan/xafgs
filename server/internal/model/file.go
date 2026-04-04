package model

import "time"

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
	UploadSessionStatusSelected  = "selected"
	UploadSessionStatusUploading = "uploading"
	UploadSessionStatusUploaded  = "uploaded"
	UploadSessionStatusCancelled = "cancelled"
	UploadSessionStatusExpired   = "expired"
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
