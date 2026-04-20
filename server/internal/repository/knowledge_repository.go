package repository

import (
	"sxfgssever/server/internal/model"
)

type KnowledgeSearchFilter struct {
	FileIDs        []int64
	BizKey         string
	BizKeyPrefixes []string
	TopK           int
	MinScore       float64
}

type KnowledgeRepository interface {
	EnqueueJob(fileID int64, versionNo int) (model.KnowledgeIndexJob, bool)
	CancelJob(fileID int64, versionNo int) bool
	ClaimNextJob(maxRetry int) (model.KnowledgeIndexJob, bool)
	MarkJobSucceeded(jobID int64) bool
	MarkJobFailed(jobID int64, errorMessage string) bool
	FindLatestJob(fileID int64, versionNo int) (model.KnowledgeIndexJob, bool)
	ListJobs(limit int) []model.KnowledgeIndexJob
	ReplaceChunks(fileID int64, versionNo int, modelName string, chunks []model.KnowledgeChunk) bool
	Search(modelName string, queryVector []float64, filter KnowledgeSearchFilter) []model.KnowledgeSearchHitDTO
}
