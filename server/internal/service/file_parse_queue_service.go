package service

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

const (
	fileParseMaxRetry          = 3
	fileParseRunningRetryAfter = 8 * time.Second
	fileParseOCRTimeout        = 30 * time.Minute
)

type FileParseQueueService interface {
	Enqueue(ctx context.Context, fileID int64, versionNo int, requestedBy int64) (model.FileParseJobDTO, *model.APIError)
	EnqueueWithContext(ctx context.Context, fileID int64, versionNo int, requestedBy int64, jobContext model.FileParseJobContext) (model.FileParseJobDTO, *model.APIError)
	GetLatest(ctx context.Context, fileID int64, versionNo int) (model.FileParseJobDTO, *model.APIError)
	GetByID(ctx context.Context, jobID int64) (model.FileParseJobDTO, *model.APIError)
	CancelByID(ctx context.Context, jobID int64, reason string) (model.FileParseJobDTO, *model.APIError)
	List(ctx context.Context, limit int) ([]model.FileParseQueueItemDTO, *model.APIError)
	RunOnce(ctx context.Context) bool
	StartWorker(ctx context.Context, interval time.Duration)
}

type FileParseJobSyncer interface {
	SyncParsedFileJob(ctx context.Context, job model.FileParseJob, parsed ParsedDocument) *model.APIError
}

type fileParseQueueService struct {
	repository           repository.FileParseJobRepository
	fileService          FileService
	documentParseService DocumentParseService
	syncer               FileParseJobSyncer
}

func NewFileParseQueueService(
	repository repository.FileParseJobRepository,
	fileService FileService,
	documentParseService DocumentParseService,
) FileParseQueueService {
	return &fileParseQueueService{
		repository:           repository,
		fileService:          fileService,
		documentParseService: documentParseService,
	}
}

func (service *fileParseQueueService) Enqueue(ctx context.Context, fileID int64, versionNo int, requestedBy int64) (model.FileParseJobDTO, *model.APIError) {
	return service.EnqueueWithContext(ctx, fileID, versionNo, requestedBy, model.FileParseJobContext{SourceScope: "file_management"})
}

func (service *fileParseQueueService) EnqueueWithContext(ctx context.Context, fileID int64, versionNo int, requestedBy int64, jobContext model.FileParseJobContext) (model.FileParseJobDTO, *model.APIError) {
	if fileID <= 0 {
		return model.FileParseJobDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	version, apiError := service.fileService.ResolveReference(ctx, fileID, versionNo)
	if apiError != nil {
		return model.FileParseJobDTO{}, apiError
	}
	if strings.TrimSpace(jobContext.SourceScope) == "" {
		jobContext.SourceScope = "file_management"
	}
	job, ok, ignored := service.repository.Enqueue(fileID, version.VersionNo, requestedBy, jobContext)
	if !ok {
		return model.FileParseJobDTO{}, model.NewAPIError(500, response.CodeInternal, "解析任务入队失败")
	}
	dto := service.toJobDTO(job)
	dto.RequestIgnored = ignored
	if dto.Status == model.FileParseJobStatusSucceeded {
		dto.ResultReady = dto.LatestResult != nil
	}
	return dto, nil
}

func (service *fileParseQueueService) SetSyncer(syncer FileParseJobSyncer) {
	service.syncer = syncer
}

func (service *fileParseQueueService) GetLatest(ctx context.Context, fileID int64, versionNo int) (model.FileParseJobDTO, *model.APIError) {
	if fileID <= 0 {
		return model.FileParseJobDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	resolvedVersionNo := versionNo
	if resolvedVersionNo <= 0 {
		version, apiError := service.fileService.ResolveReference(ctx, fileID, 0)
		if apiError != nil {
			return model.FileParseJobDTO{}, apiError
		}
		resolvedVersionNo = version.VersionNo
	}
	job, ok := service.repository.FindLatest(fileID, resolvedVersionNo)
	if !ok {
		return model.FileParseJobDTO{}, model.NewAPIError(404, response.CodeNotFound, "解析任务不存在")
	}
	return service.toJobDTO(job), nil
}

func (service *fileParseQueueService) GetByID(_ context.Context, jobID int64) (model.FileParseJobDTO, *model.APIError) {
	if jobID <= 0 {
		return model.FileParseJobDTO{}, model.NewAPIError(400, response.CodeBadRequest, "jobId 不合法")
	}
	job, ok := service.repository.FindByID(jobID)
	if !ok {
		return model.FileParseJobDTO{}, model.NewAPIError(404, response.CodeNotFound, "解析任务不存在")
	}
	return service.toJobDTO(job), nil
}

func (service *fileParseQueueService) CancelByID(_ context.Context, jobID int64, reason string) (model.FileParseJobDTO, *model.APIError) {
	if jobID <= 0 {
		return model.FileParseJobDTO{}, model.NewAPIError(400, response.CodeBadRequest, "jobId 不合法")
	}
	job, ok := service.repository.Cancel(jobID, reason)
	if !ok {
		return model.FileParseJobDTO{}, model.NewAPIError(404, response.CodeNotFound, "解析任务不存在")
	}
	return service.toJobDTO(job), nil
}

func (service *fileParseQueueService) List(ctx context.Context, limit int) ([]model.FileParseQueueItemDTO, *model.APIError) {
	jobs := service.repository.List(limit)
	items := make([]model.FileParseQueueItemDTO, 0, len(jobs))
	for _, job := range jobs {
		version, versionErr := service.fileService.ResolveReference(ctx, job.FileID, job.VersionNo)
		fileName := "-"
		if versionErr == nil {
			fileName = version.OriginName
		}
		items = append(items, model.FileParseQueueItemDTO{
			JobID:          job.ID,
			FileID:         job.FileID,
			VersionNo:      job.VersionNo,
			FileName:       fileName,
			SourceScope:    normalizeParseSourceScope(job.SourceScope),
			ProjectID:      job.ProjectID,
			ProjectName:    strings.TrimSpace(job.ProjectName),
			CaseFileID:     job.CaseFileID,
			ManualCategory: strings.TrimSpace(job.ManualCategory),
			FileType:       strings.TrimSpace(job.FileType),
			SourceType:     strings.TrimSpace(job.SourceType),
			ParseStrategy:  strings.TrimSpace(job.ParseStrategy),
			OCRTaskStatus:  strings.TrimSpace(job.OCRTaskStatus),
			OCRPending:     job.OCRPending,
			OCRError:       strings.TrimSpace(job.OCRError),
			ParseStatus:    strings.TrimSpace(job.Status),
			CurrentStage:   deriveParseCurrentStage(job.Status, job.OCRPending, job.OCRTaskStatus),
			ErrorMessage:   strings.TrimSpace(job.ErrorMessage),
			UpdatedAt:      job.UpdatedAt,
			StartedAt:      job.StartedAt,
			FinishedAt:     job.FinishedAt,
		})
	}
	return items, nil
}

func (service *fileParseQueueService) RunOnce(ctx context.Context) bool {
	job, ok := service.repository.ClaimNext(fileParseMaxRetry, fileParseRunningRetryAfter)
	if !ok {
		return false
	}
	parsed, apiError := service.documentParseService.ParseCaseFile(ctx, model.ReportCaseFile{
		FileID:    job.FileID,
		VersionNo: job.VersionNo,
	})
	if apiError != nil {
		_, _ = service.repository.MarkFailed(job.ID, apiError.Message)
		log.Printf("file-parse failed fileId=%d versionNo=%d: %s", job.FileID, job.VersionNo, apiError.Message)
		return true
	}
	result := BuildFileParseResultDTO(parsed)
	raw, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		_, _ = service.repository.MarkFailed(job.ID, marshalErr.Error())
		return true
	}

	ocrTaskStatus := strings.TrimSpace(result.OCRTaskStatus)
	ocrError := strings.TrimSpace(result.OCRError)
	if result.OCRPending || (ocrTaskStatus == model.OCRTaskStatusPending || ocrTaskStatus == model.OCRTaskStatusRunning) {
		if isParseJobOCRTimeout(job, fileParseOCRTimeout) {
			_, _ = service.repository.MarkFailed(job.ID, "等待 Docling 结果超时（30分钟）")
			log.Printf("file-parse ocr-timeout fileId=%d versionNo=%d", job.FileID, job.VersionNo)
			return true
		}
		_, marked := service.repository.MarkRunning(
			job.ID,
			raw,
			parsed.Profile.FileType,
			parsed.Profile.SourceType,
			parsed.Profile.ParseStrategy,
			ocrTaskStatus,
			true,
			ocrError,
		)
		if !marked {
			log.Printf("file-parse mark running ignored jobId=%d", job.ID)
		}
		return true
	}
	if ocrTaskStatus == model.OCRTaskStatusFailed || ocrTaskStatus == model.OCRTaskStatusCancelled {
		if ocrError == "" {
			ocrError = "Docling 任务失败"
		}
		_, _ = service.repository.MarkFailed(job.ID, ocrError)
		return true
	}
	if service.syncer != nil {
		if apiError := service.syncer.SyncParsedFileJob(ctx, job, parsed); apiError != nil {
			_, _ = service.repository.MarkFailed(job.ID, apiError.Message)
			log.Printf("file-parse sync failed jobId=%d fileId=%d versionNo=%d: %s", job.ID, job.FileID, job.VersionNo, apiError.Message)
			return true
		}
	}
	_, marked := service.repository.MarkSucceeded(job.ID, raw, parsed.Profile.FileType, parsed.Profile.SourceType, parsed.Profile.ParseStrategy, ocrTaskStatus, ocrError)
	if !marked {
		log.Printf("file-parse mark succeeded ignored jobId=%d", job.ID)
	}
	return true
}

func (service *fileParseQueueService) StartWorker(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for service.RunOnce(ctx) {
				}
			}
		}
	}()
}

func (service *fileParseQueueService) toJobDTO(job model.FileParseJob) model.FileParseJobDTO {
	result := decodeFileParseResult(job.ResultJSON)
	return model.FileParseJobDTO{
		JobID:          job.ID,
		FileID:         job.FileID,
		VersionNo:      job.VersionNo,
		SourceScope:    normalizeParseSourceScope(job.SourceScope),
		ProjectID:      job.ProjectID,
		ProjectName:    strings.TrimSpace(job.ProjectName),
		CaseFileID:     job.CaseFileID,
		ManualCategory: strings.TrimSpace(job.ManualCategory),
		Status:         job.Status,
		RetryCount:     job.RetryCount,
		ErrorMessage:   job.ErrorMessage,
		FileType:       job.FileType,
		SourceType:     job.SourceType,
		ParseStrategy:  job.ParseStrategy,
		OCRTaskStatus:  job.OCRTaskStatus,
		OCRPending:     job.OCRPending,
		OCRError:       job.OCRError,
		UpdatedAt:      job.UpdatedAt,
		StartedAt:      job.StartedAt,
		FinishedAt:     job.FinishedAt,
		LatestResult:   result,
		ResultReady:    result != nil,
	}
}

func decodeFileParseResult(raw []byte) *model.FileParseResultDTO {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	var result model.FileParseResultDTO
	if err := json.Unmarshal([]byte(trimmed), &result); err != nil {
		return nil
	}
	return &result
}

func deriveParseCurrentStage(status string, ocrPending bool, ocrTaskStatus string) string {
	if strings.TrimSpace(status) == model.FileParseJobStatusRunning && (ocrPending || ocrTaskStatus == model.OCRTaskStatusPending || ocrTaskStatus == model.OCRTaskStatusRunning) {
		return "等待Docling"
	}
	switch strings.TrimSpace(status) {
	case model.FileParseJobStatusPending:
		return "解析排队"
	case model.FileParseJobStatusRunning:
		return "Docling解析中"
	case model.FileParseJobStatusSucceeded:
		return "解析完成"
	case model.FileParseJobStatusFailed:
		return "解析失败"
	case model.FileParseJobStatusCancelled:
		return "解析已终止"
	default:
		return "未知"
	}
}

func isParseJobOCRTimeout(job model.FileParseJob, timeout time.Duration) bool {
	if timeout <= 0 {
		return false
	}
	if job.StartedAt == nil {
		return false
	}
	return time.Since(job.StartedAt.UTC()) > timeout
}

func normalizeParseSourceScope(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "file_management"
	}
	return trimmed
}
