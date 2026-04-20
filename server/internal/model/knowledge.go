package model

import (
	"encoding/json"
	"time"
)

const (
	KnowledgeIndexJobStatusPending   = "pending"
	KnowledgeIndexJobStatusRunning   = "running"
	KnowledgeIndexJobStatusSucceeded = "succeeded"
	KnowledgeIndexJobStatusFailed    = "failed"
	KnowledgeIndexJobStatusCancelled = "cancelled"
)

type KnowledgeIndexJob struct {
	ID           int64      `json:"id"`
	FileID       int64      `json:"fileId"`
	VersionNo    int        `json:"versionNo"`
	Status       string     `json:"status"`
	RetryCount   int        `json:"retryCount"`
	ErrorMessage string     `json:"errorMessage"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type KnowledgeChunk struct {
	FileID        int64
	VersionNo     int
	BizKey        string
	ChunkIndex    int
	ChunkText     string
	ChunkSummary  string
	SourceType    string
	PageStart     int
	PageEnd       int
	SourceRef     string
	BBoxJSON      []byte
	AnchorJSON    []byte
	Anchors       []KnowledgeChunkAnchor
	ParseStrategy string
	ContentHash   string
	Embedding     []float64
}

type KnowledgeChunkAnchor struct {
	SourceType string          `json:"sourceType"`
	SliceType  string          `json:"sliceType"`
	PageStart  int             `json:"pageStart"`
	PageEnd    int             `json:"pageEnd"`
	SourceRef  string          `json:"sourceRef"`
	BBox       json.RawMessage `json:"bbox,omitempty"`
	OOXMLPath  string          `json:"ooxmlPath,omitempty"`
	CharStart  int             `json:"charStart"`
	CharEnd    int             `json:"charEnd"`
}

type KnowledgeSearchHitDTO struct {
	FileID       int64                  `json:"fileId"`
	VersionNo    int                    `json:"versionNo"`
	ChunkIndex   int                    `json:"chunkIndex"`
	ChunkText    string                 `json:"chunkText"`
	ChunkSummary string                 `json:"chunkSummary"`
	SourceType   string                 `json:"sourceType"`
	PageStart    int                    `json:"pageStart"`
	PageEnd      int                    `json:"pageEnd"`
	SourceRef    string                 `json:"sourceRef"`
	BBox         json.RawMessage        `json:"bbox"`
	Anchors      []KnowledgeChunkAnchor `json:"anchors"`
	Score        float64                `json:"score"`
}

type KnowledgeSearchResultDTO struct {
	Hits []KnowledgeSearchHitDTO `json:"hits"`
}

type KnowledgeIndexStatusDTO struct {
	FileID       int64      `json:"fileId"`
	VersionNo    int        `json:"versionNo"`
	Status       string     `json:"status"`
	RetryCount   int        `json:"retryCount"`
	ErrorMessage string     `json:"errorMessage"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type KnowledgeIndexQueueItemDTO struct {
	JobID        int64      `json:"jobId"`
	FileID       int64      `json:"fileId"`
	VersionNo    int        `json:"versionNo"`
	FileName     string     `json:"fileName"`
	Status       string     `json:"status"`
	RetryCount   int        `json:"retryCount"`
	ErrorMessage string     `json:"errorMessage"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
}
