package model

import "time"

const (
	DebugFeedbackTypeRequirement = "requirement"
	DebugFeedbackTypeBug         = "bug"
)

const (
	DebugFeedbackStatusOpen = "open"
	DebugFeedbackStatusDone = "done"
)

type DebugFeedback struct {
	BaseEntity
	Title             string     `json:"title"`
	Type              string     `json:"type"`
	Description       string     `json:"description"`
	Status            string     `json:"status"`
	SubmitterID       int64      `json:"submitterId"`
	CompletedAt       *time.Time `json:"completedAt,omitempty"`
	CompletedByUserID int64      `json:"completedByUserId"`
}

type DebugFeedbackAttachment struct {
	ID         int64 `json:"id"`
	FeedbackID int64 `json:"feedbackId"`
	FileID     int64 `json:"fileId"`
	VersionNo  int   `json:"versionNo"`
}

type DebugFeedbackAttachmentDTO struct {
	ID        int64  `json:"id"`
	FileID    int64  `json:"fileId"`
	VersionNo int    `json:"versionNo"`
	Name      string `json:"name"`
	MimeType  string `json:"mimeType"`
	Size      int64  `json:"size"`
}

type DebugFeedbackItemDTO struct {
	ID                int64                        `json:"id"`
	Title             string                       `json:"title"`
	Type              string                       `json:"type"`
	Description       string                       `json:"description"`
	Status            string                       `json:"status"`
	Attachments       []DebugFeedbackAttachmentDTO `json:"attachments"`
	SubmitterID       int64                        `json:"submitterId"`
	SubmitterUsername string                       `json:"submitterUsername"`
	SubmitterName     string                       `json:"submitterName"`
	SubmitterRole     string                       `json:"submitterRole"`
	CreatedAt         time.Time                    `json:"createdAt"`
	CompletedAt       *time.Time                   `json:"completedAt"`
	CompletedBy       string                       `json:"completedBy"`
}

type DebugFeedbackSummaryDTO struct {
	Items     []DebugFeedbackItemDTO `json:"items"`
	OpenCount int                    `json:"openCount"`
}

type DebugFeedbackCreateAttachmentRequest struct {
	FileID    int64 `json:"fileId"`
	VersionNo int   `json:"versionNo"`
}

type CreateDebugFeedbackRequest struct {
	Title       string                                 `json:"title"`
	Type        string                                 `json:"type"`
	Description string                                 `json:"description"`
	Attachments []DebugFeedbackCreateAttachmentRequest `json:"attachments"`
}

func IsValidDebugFeedbackType(value string) bool {
	return value == DebugFeedbackTypeRequirement || value == DebugFeedbackTypeBug
}

func IsValidDebugFeedbackStatus(value string) bool {
	return value == DebugFeedbackStatusOpen || value == DebugFeedbackStatusDone
}
