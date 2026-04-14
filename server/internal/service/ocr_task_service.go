package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
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
}

func NewOCRTaskService(fileRepository repository.FileRepository, ocrClient OCRClient) OCRTaskService {
	return &ocrTaskService{
		fileRepository: fileRepository,
		ocrClient:      ocrClient,
	}
}

func (service *ocrTaskService) EnsureTask(ctx context.Context, version model.FileVersionDTO, raw []byte, _ DocumentProfile) (model.OCRTask, *model.APIError) {
	if existing, ok := service.fileRepository.FindLatestOCRTask(version.FileID, version.VersionNo); ok {
		if existing.Status == model.OCRTaskStatusPending || existing.Status == model.OCRTaskStatusRunning {
			synced, apiError := service.syncTask(ctx, existing)
			if apiError == nil {
				return synced, nil
			}
			return existing, nil
		}
		if existing.Status == model.OCRTaskStatusSucceeded {
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
		RequestPayloadJSON: requestJSON,
		CreatedAt:          now,
		UpdatedAt:          now,
	})

	resp, err := service.ocrClient.SubmitTask(ctx, requestPayload)
	if err != nil {
		task.Status = model.OCRTaskStatusFailed
		task.ErrorCode = response.CodeInternal
		task.ErrorMessage = err.Error()
		finishedAt := time.Now().UTC()
		task.FinishedAt = &finishedAt
		task.UpdatedAt = finishedAt
		updated, _ := service.fileRepository.UpdateOCRTask(task)
		return updated, nil
	}

	startedAt := time.Now().UTC()
	task.ProviderTaskID = strings.TrimSpace(resp.TaskID)
	task.ProviderUsed = strings.TrimSpace(resp.Provider)
	task.Status = normalizeOCRTaskStatus(resp.Status)
	task.StartedAt = &startedAt
	task.UpdatedAt = startedAt
	updated, _ := service.fileRepository.UpdateOCRTask(task)
	return updated, nil
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
	if strings.TrimSpace(task.ProviderTaskID) == "" {
		return task, nil
	}
	status, err := service.ocrClient.GetTask(ctx, task.ProviderTaskID)
	if err != nil {
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
