package repository

import (
	"sort"
	"strings"
	"sync"
	"time"

	"sxfgssever/server/internal/model"
)

type FileParseJobRepository interface {
	Enqueue(fileID int64, versionNo int, requestedBy int64) (model.FileParseJob, bool, bool)
	FindByID(jobID int64) (model.FileParseJob, bool)
	FindLatest(fileID int64, versionNo int) (model.FileParseJob, bool)
	ClaimNext(maxRetry int, runningRetryAfter time.Duration) (model.FileParseJob, bool)
	MarkRunning(jobID int64, resultJSON []byte, fileType string, sourceType string, parseStrategy string, ocrTaskStatus string, ocrPending bool, ocrError string) (model.FileParseJob, bool)
	MarkSucceeded(jobID int64, resultJSON []byte, fileType string, sourceType string, parseStrategy string, ocrTaskStatus string, ocrError string) (model.FileParseJob, bool)
	MarkFailed(jobID int64, errorMessage string) (model.FileParseJob, bool)
	List(limit int) []model.FileParseJob
}

type fileParseJobRepository struct {
	mu        sync.RWMutex
	jobs      map[int64]model.FileParseJob
	nextJobID int64
}

func NewFileParseJobRepository() FileParseJobRepository {
	return &fileParseJobRepository{
		jobs:      make(map[int64]model.FileParseJob),
		nextJobID: 1,
	}
}

func (repository *fileParseJobRepository) Enqueue(fileID int64, versionNo int, requestedBy int64) (model.FileParseJob, bool, bool) {
	if fileID <= 0 || versionNo <= 0 {
		return model.FileParseJob{}, false, false
	}
	repository.mu.Lock()
	defer repository.mu.Unlock()

	for _, item := range repository.jobs {
		if item.FileID != fileID || item.VersionNo != versionNo {
			continue
		}
		if item.Status == model.FileParseJobStatusPending || item.Status == model.FileParseJobStatusRunning {
			return item, true, true
		}
	}

	now := time.Now().UTC()
	job := model.FileParseJob{
		ID:          repository.nextJobID,
		FileID:      fileID,
		VersionNo:   versionNo,
		Status:      model.FileParseJobStatusPending,
		RequestedBy: requestedBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	repository.nextJobID++
	repository.jobs[job.ID] = job
	return job, true, false
}

func (repository *fileParseJobRepository) FindByID(jobID int64) (model.FileParseJob, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	job, ok := repository.jobs[jobID]
	return job, ok
}

func (repository *fileParseJobRepository) FindLatest(fileID int64, versionNo int) (model.FileParseJob, bool) {
	if fileID <= 0 {
		return model.FileParseJob{}, false
	}
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	found := false
	var latest model.FileParseJob
	for _, item := range repository.jobs {
		if item.FileID != fileID {
			continue
		}
		if versionNo > 0 && item.VersionNo != versionNo {
			continue
		}
		if !found || item.ID > latest.ID {
			latest = item
			found = true
		}
	}
	return latest, found
}

func (repository *fileParseJobRepository) ClaimNext(maxRetry int, runningRetryAfter time.Duration) (model.FileParseJob, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	if maxRetry <= 0 {
		maxRetry = 3
	}
	if runningRetryAfter <= 0 {
		runningRetryAfter = 8 * time.Second
	}
	claimRunningBefore := time.Now().UTC().Add(-runningRetryAfter)

	var found *model.FileParseJob
	for _, item := range repository.jobs {
		isRetryableRunning := item.Status == model.FileParseJobStatusRunning && item.UpdatedAt.Before(claimRunningBefore)
		if item.Status != model.FileParseJobStatusPending && item.Status != model.FileParseJobStatusFailed && !isRetryableRunning {
			continue
		}
		if item.RetryCount >= maxRetry {
			continue
		}
		if found == nil || item.UpdatedAt.Before(found.UpdatedAt) || (item.UpdatedAt.Equal(found.UpdatedAt) && item.ID < found.ID) {
			copied := item
			found = &copied
		}
	}
	if found == nil {
		return model.FileParseJob{}, false
	}
	now := time.Now().UTC()
	job := *found
	job.Status = model.FileParseJobStatusRunning
	if job.StartedAt == nil {
		job.StartedAt = &now
	}
	job.FinishedAt = nil
	job.UpdatedAt = now
	repository.jobs[job.ID] = job
	return job, true
}

func (repository *fileParseJobRepository) MarkSucceeded(jobID int64, resultJSON []byte, fileType string, sourceType string, parseStrategy string, ocrTaskStatus string, ocrError string) (model.FileParseJob, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	job, ok := repository.jobs[jobID]
	if !ok || job.Status == model.FileParseJobStatusCancelled {
		return model.FileParseJob{}, false
	}
	now := time.Now().UTC()
	job.Status = model.FileParseJobStatusSucceeded
	job.ErrorMessage = ""
	job.ResultJSON = resultJSON
	job.FileType = strings.TrimSpace(fileType)
	job.SourceType = strings.TrimSpace(sourceType)
	job.ParseStrategy = strings.TrimSpace(parseStrategy)
	job.OCRTaskStatus = strings.TrimSpace(ocrTaskStatus)
	job.OCRPending = false
	job.OCRError = truncateRepositoryText(strings.TrimSpace(ocrError), 1000)
	job.FinishedAt = &now
	job.UpdatedAt = now
	repository.jobs[jobID] = job
	return job, true
}

func (repository *fileParseJobRepository) MarkRunning(jobID int64, resultJSON []byte, fileType string, sourceType string, parseStrategy string, ocrTaskStatus string, ocrPending bool, ocrError string) (model.FileParseJob, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	job, ok := repository.jobs[jobID]
	if !ok || job.Status == model.FileParseJobStatusCancelled {
		return model.FileParseJob{}, false
	}
	now := time.Now().UTC()
	if len(resultJSON) > 0 {
		job.ResultJSON = resultJSON
	}
	job.Status = model.FileParseJobStatusRunning
	job.FileType = strings.TrimSpace(fileType)
	job.SourceType = strings.TrimSpace(sourceType)
	job.ParseStrategy = strings.TrimSpace(parseStrategy)
	job.OCRTaskStatus = strings.TrimSpace(ocrTaskStatus)
	job.OCRPending = ocrPending
	job.OCRError = truncateRepositoryText(strings.TrimSpace(ocrError), 1000)
	job.FinishedAt = nil
	if job.StartedAt == nil {
		job.StartedAt = &now
	}
	job.UpdatedAt = now
	repository.jobs[jobID] = job
	return job, true
}

func (repository *fileParseJobRepository) MarkFailed(jobID int64, errorMessage string) (model.FileParseJob, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	job, ok := repository.jobs[jobID]
	if !ok || job.Status == model.FileParseJobStatusCancelled {
		return model.FileParseJob{}, false
	}
	now := time.Now().UTC()
	job.Status = model.FileParseJobStatusFailed
	job.RetryCount++
	job.ErrorMessage = truncateRepositoryText(strings.TrimSpace(errorMessage), 1000)
	job.OCRPending = false
	job.FinishedAt = &now
	job.UpdatedAt = now
	repository.jobs[jobID] = job
	return job, true
}

func (repository *fileParseJobRepository) List(limit int) []model.FileParseJob {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	if limit <= 0 {
		limit = 100
	}
	jobs := make([]model.FileParseJob, 0, len(repository.jobs))
	for _, item := range repository.jobs {
		jobs = append(jobs, item)
	}
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].UpdatedAt.Equal(jobs[j].UpdatedAt) {
			return jobs[i].ID > jobs[j].ID
		}
		return jobs[i].UpdatedAt.After(jobs[j].UpdatedAt)
	})
	if len(jobs) > limit {
		return jobs[:limit]
	}
	return jobs
}

func truncateRepositoryText(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
