package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type OCRTaskService interface {
	EnsureTask(ctx context.Context, version model.FileVersionDTO, raw []byte, profile DocumentProfile) (model.OCRTask, *model.APIError)
	GetTaskStatus(ctx context.Context, fileID int64, versionNo int) (model.OCRTaskDTO, *model.APIError)
}

type ocrTaskService struct {
	fileRepository repository.FileRepository
	ocrClient      OCRClient
	keyLocks       sync.Map
}

const (
	ocrProviderLocalAsync     = "local-async"
	ocrAsyncRetryMaxAttempts  = 2
	ocrAsyncRetryBackoff      = 2 * time.Second
	ocrAsyncAttemptTimeout    = 6 * time.Minute
)

func NewOCRTaskService(fileRepository repository.FileRepository, ocrClient OCRClient) OCRTaskService {
	return &ocrTaskService{
		fileRepository: fileRepository,
		ocrClient:      ocrClient,
	}
}

func (service *ocrTaskService) EnsureTask(_ context.Context, version model.FileVersionDTO, raw []byte, _ DocumentProfile) (model.OCRTask, *model.APIError) {
	unlock := service.lockFor(version.FileID, version.VersionNo)
	defer unlock()
	if existing, ok := service.fileRepository.FindLatestOCRTask(version.FileID, version.VersionNo); ok {
		if existing.Status == model.OCRTaskStatusSucceeded || existing.Status == model.OCRTaskStatusPending || existing.Status == model.OCRTaskStatusRunning {
			return existing, nil
		}
	}

	requestPayload := OCRTaskSubmitRequest{
		FileID:        version.FileID,
		VersionNo:     version.VersionNo,
		FileName:      version.OriginName,
		MimeType:      version.MimeType,
		ProviderMode:  "auto",
		EnableTables:  true,
		ContentBase64: base64.StdEncoding.EncodeToString(raw),
	}
	requestJSON, _ := json.Marshal(requestPayload)
	now := time.Now().UTC()
	task := service.fileRepository.CreateOCRTask(model.OCRTask{
		FileID:             version.FileID,
		VersionNo:          version.VersionNo,
		Status:             model.OCRTaskStatusPending,
		ProviderMode:       "auto",
		ProviderUsed:       ocrProviderLocalAsync,
		RequestPayloadJSON: requestJSON,
		CreatedAt:          now,
		UpdatedAt:          now,
	})
	task.ProviderTaskID = fmt.Sprintf("local-%d", task.ID)
	task.UpdatedAt = time.Now().UTC()
	updated, _ := service.fileRepository.UpdateOCRTask(task)
	go service.runAsyncOCRTask(updated.ID, requestPayload)
	return updated, nil
}

func (service *ocrTaskService) lockFor(fileID int64, versionNo int) func() {
	key := fmt.Sprintf("%d:%d", fileID, versionNo)
	actual, _ := service.keyLocks.LoadOrStore(key, &sync.Mutex{})
	lock := actual.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}

func (service *ocrTaskService) GetTaskStatus(ctx context.Context, fileID int64, versionNo int) (model.OCRTaskDTO, *model.APIError) {
	if versionNo <= 0 {
		fileEntity, ok := service.fileRepository.FindFileByID(fileID)
		if !ok {
			return model.OCRTaskDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件不存在")
		}
		versionNo = fileEntity.LatestVersionNo
	}
	task, ok := service.fileRepository.FindLatestOCRTask(fileID, versionNo)
	if !ok {
		return model.OCRTaskDTO{}, model.NewAPIError(404, response.CodeNotFound, "OCR 任务不存在")
	}
	if task.Status == model.OCRTaskStatusPending || task.Status == model.OCRTaskStatusRunning {
		synced, apiError := service.syncTask(ctx, task)
		if apiError == nil {
			task = synced
		}
	}
	return task.ToDTO(true), nil
}

func (service *ocrTaskService) syncTask(ctx context.Context, task model.OCRTask) (model.OCRTask, *model.APIError) {
	if isLocalAsyncOCRTask(task) {
		return task, nil
	}
	if strings.TrimSpace(task.ProviderTaskID) == "" {
		return task, nil
	}
	status, err := service.ocrClient.GetTask(ctx, task.ProviderTaskID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "status=404") {
			now := time.Now().UTC()
			task.Status = model.OCRTaskStatusFailed
			task.ErrorCode = response.CodeNotFound
			task.ErrorMessage = "ocr provider task not found; will recreate on next ensure"
			task.FinishedAt = &now
			task.UpdatedAt = now
			updated, _ := service.fileRepository.UpdateOCRTask(task)
			return updated, nil
		}
		return task, model.NewAPIError(502, response.CodeInternal, "查询 OCR 任务失败")
	}
	task.Status = normalizeOCRTaskStatus(status.Status)
	task.ProviderUsed = firstNonEmpty(strings.TrimSpace(status.Provider), task.ProviderUsed)
	task.PageCount = status.PageCount
	task.Confidence = status.Confidence
	task.ErrorCode = strings.TrimSpace(status.ErrorCode)
	task.ErrorMessage = strings.TrimSpace(status.ErrorMessage)
	now := time.Now().UTC()
	task.UpdatedAt = now
	if task.StartedAt == nil {
		task.StartedAt = &now
	}
	if status.Result != nil {
		raw, _ := json.Marshal(status.Result)
		task.ResultPayloadJSON = raw
	}
	if task.Status == model.OCRTaskStatusSucceeded || task.Status == model.OCRTaskStatusFailed || task.Status == model.OCRTaskStatusCancelled {
		task.FinishedAt = &now
	}
	updated, ok := service.fileRepository.UpdateOCRTask(task)
	if !ok {
		return task, model.NewAPIError(500, response.CodeInternal, "更新 OCR 任务失败")
	}
	return updated, nil
}

func (service *ocrTaskService) runAsyncOCRTask(taskID int64, requestPayload OCRTaskSubmitRequest) {
	for attempt := 1; attempt <= ocrAsyncRetryMaxAttempts; attempt++ {
		task, ok := service.fileRepository.FindOCRTaskByID(taskID)
		if !ok {
			return
		}
		now := time.Now().UTC()
		if task.StartedAt == nil {
			task.StartedAt = &now
		}
		task.Status = model.OCRTaskStatusRunning
		task.ProviderUsed = ocrProviderLocalAsync
		if strings.TrimSpace(task.ProviderTaskID) == "" {
			task.ProviderTaskID = fmt.Sprintf("local-%d", task.ID)
		}
		task.RetryCount = attempt - 1
		task.UpdatedAt = now
		task.ErrorCode = ""
		task.ErrorMessage = ""
		if updated, ok := service.fileRepository.UpdateOCRTask(task); ok {
			task = updated
		}

		attemptCtx, cancel := context.WithTimeout(context.Background(), ocrAsyncAttemptTimeout)
		resp, err := service.ocrClient.SubmitTask(attemptCtx, requestPayload)
		cancel()
		if err != nil {
			if attempt < ocrAsyncRetryMaxAttempts {
				time.Sleep(ocrAsyncRetryBackoff)
				continue
			}
			failedAt := time.Now().UTC()
			task.Status = model.OCRTaskStatusFailed
			task.ErrorCode = response.CodeInternal
			task.ErrorMessage = err.Error()
			task.RetryCount = attempt - 1
			task.FinishedAt = &failedAt
			task.UpdatedAt = failedAt
			_, _ = service.fileRepository.UpdateOCRTask(task)
			return
		}

		completedAt := time.Now().UTC()
		task.Status = normalizeOCRTaskStatus(resp.Status)
		if provider := strings.TrimSpace(resp.Provider); provider != "" {
			task.ProviderUsed = provider
		}
		if providerTaskID := strings.TrimSpace(resp.TaskID); providerTaskID != "" {
			task.ProviderTaskID = providerTaskID
		}
		task.PageCount = resp.PageCount
		task.Confidence = resp.Confidence
		task.ErrorCode = strings.TrimSpace(resp.ErrorCode)
		task.ErrorMessage = strings.TrimSpace(resp.ErrorMessage)
		task.RetryCount = attempt - 1
		task.UpdatedAt = completedAt
		if resp.Result != nil {
			raw, _ := json.Marshal(resp.Result)
			task.ResultPayloadJSON = raw
		}
		if task.Status == model.OCRTaskStatusSucceeded || task.Status == model.OCRTaskStatusFailed || task.Status == model.OCRTaskStatusCancelled {
			task.FinishedAt = &completedAt
		} else {
			task.Status = model.OCRTaskStatusSucceeded
			task.FinishedAt = &completedAt
		}
		_, _ = service.fileRepository.UpdateOCRTask(task)
		return
	}
}

func isLocalAsyncOCRTask(task model.OCRTask) bool {
	providerUsed := strings.TrimSpace(strings.ToLower(task.ProviderUsed))
	if providerUsed == ocrProviderLocalAsync {
		return true
	}
	return strings.HasPrefix(strings.TrimSpace(strings.ToLower(task.ProviderTaskID)), "local-")
}

func normalizeOCRTaskStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case model.OCRTaskStatusRunning:
		return model.OCRTaskStatusRunning
	case model.OCRTaskStatusSucceeded:
		return model.OCRTaskStatusSucceeded
	case model.OCRTaskStatusFailed:
		return model.OCRTaskStatusFailed
	case model.OCRTaskStatusCancelled:
		return model.OCRTaskStatusCancelled
	default:
		return model.OCRTaskStatusPending
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
