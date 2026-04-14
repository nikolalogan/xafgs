package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type FileService interface {
	ListFiles(ctx context.Context) ([]model.FileDTO, *model.APIError)
	CreateSession(ctx context.Context, operatorID int64, request model.CreateUploadSessionRequest) (model.UploadSessionDTO, *model.APIError)
	UploadBySession(ctx context.Context, operatorID int64, sessionID string, fileHeader *multipart.FileHeader) (model.FileUploadResultDTO, *model.APIError)
	UploadVersion(ctx context.Context, operatorID int64, fileID int64, fileHeader *multipart.FileHeader) (model.FileUploadResultDTO, *model.APIError)
	CancelSession(ctx context.Context, operatorID int64, sessionID string) *model.APIError
	GetFile(ctx context.Context, fileID int64) (model.FileDTO, *model.APIError)
	ListVersions(ctx context.Context, fileID int64) ([]model.FileVersionDTO, *model.APIError)
	ResolveReference(ctx context.Context, fileID int64, versionNo int) (model.FileVersionDTO, *model.APIError)
	ReadReferenceContent(ctx context.Context, fileID int64, versionNo int, maxBytes int64) (model.FileVersionDTO, []byte, *model.APIError)
	DeleteFile(ctx context.Context, fileID int64) *model.APIError
}

type fileService struct {
	fileRepository repository.FileRepository
	fileStorage    FileStorage
	sessionTTL     time.Duration
	indexEnqueuer  KnowledgeIndexEnqueuer
}

const (
	maxUploadSizeBytes              int64 = 10 * 1024 * 1024
	maxDebugFeedbackUploadSizeBytes int64 = 10 * 1024 * 1024
	debugFeedbackBizKeyPrefix             = "debug-feedback_"
)

type KnowledgeIndexEnqueuer interface {
	Enqueue(ctx context.Context, fileID int64, versionNo int) *model.APIError
}

func NewFileService(fileRepository repository.FileRepository, fileStorage FileStorage, indexEnqueuer ...KnowledgeIndexEnqueuer) FileService {
	var selectedEnqueuer KnowledgeIndexEnqueuer
	if len(indexEnqueuer) > 0 {
		selectedEnqueuer = indexEnqueuer[0]
	}
	return &fileService{
		fileRepository: fileRepository,
		fileStorage:    fileStorage,
		sessionTTL:     15 * time.Minute,
		indexEnqueuer:  selectedEnqueuer,
	}
}

func (service *fileService) ListFiles(_ context.Context) ([]model.FileDTO, *model.APIError) {
	files := service.fileRepository.FindAllFiles()
	result := make([]model.FileDTO, 0, len(files))
	for _, fileEntity := range files {
		var latestVersion *model.FileVersion
		if fileEntity.LatestVersionNo > 0 {
			version, ok := service.fileRepository.FindVersion(fileEntity.ID, fileEntity.LatestVersionNo)
			if ok {
				latestVersion = &version
			}
		}
		result = append(result, fileEntity.ToDTO(latestVersion))
	}
	return result, nil
}

func (service *fileService) CreateSession(_ context.Context, operatorID int64, request model.CreateUploadSessionRequest) (model.UploadSessionDTO, *model.APIError) {
	service.expireSessions()

	trimmedBizKey := strings.TrimSpace(request.BizKey)
	if request.FileID <= 0 && trimmedBizKey == "" {
		return model.UploadSessionDTO{}, model.NewAPIError(400, response.CodeBadRequest, "新文件上传必须提供 bizKey")
	}

	sessionID, err := generateSessionID()
	if err != nil {
		return model.UploadSessionDTO{}, model.NewAPIError(500, response.CodeInternal, "生成上传会话失败")
	}
	expiresAt := time.Now().UTC().Add(service.sessionTTL)
	session, ok := service.fileRepository.CreateSession(sessionID, request.FileID, trimmedBizKey, expiresAt, operatorID)
	if !ok {
		if request.FileID > 0 {
			return model.UploadSessionDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件不存在")
		}
		return model.UploadSessionDTO{}, model.NewAPIError(400, response.CodeBadRequest, "创建上传会话失败")
	}
	return session.ToDTO(), nil
}

func (service *fileService) UploadBySession(_ context.Context, operatorID int64, sessionID string, fileHeader *multipart.FileHeader) (model.FileUploadResultDTO, *model.APIError) {
	service.expireSessions()
	cleanSessionID := strings.TrimSpace(sessionID)
	fileName := ""
	fileSize := int64(0)
	if fileHeader != nil {
		fileName = strings.TrimSpace(fileHeader.Filename)
		fileSize = fileHeader.Size
	}
	log.Printf("file-upload session start operator=%d session=%s file=%s size=%d", operatorID, cleanSessionID, fileName, fileSize)

	session, ok := service.fileRepository.FindSessionByID(cleanSessionID)
	if !ok {
		log.Printf("file-upload session failed operator=%d session=%s reason=session_not_found", operatorID, cleanSessionID)
		return model.FileUploadResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "上传会话不存在")
	}
	if session.Status == model.UploadSessionStatusExpired || session.Status == model.UploadSessionStatusCancelled {
		log.Printf("file-upload session failed operator=%d session=%s reason=session_invalid status=%s", operatorID, cleanSessionID, session.Status)
		return model.FileUploadResultDTO{}, model.NewAPIError(409, response.CodeBadRequest, "上传会话已失效")
	}
	if session.Status == model.UploadSessionStatusUploaded {
		log.Printf("file-upload session failed operator=%d session=%s reason=session_already_uploaded", operatorID, cleanSessionID)
		return model.FileUploadResultDTO{}, model.NewAPIError(409, response.CodeBadRequest, "该会话已完成上传")
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		log.Printf("file-upload session failed operator=%d session=%s reason=session_expired", operatorID, cleanSessionID)
		return model.FileUploadResultDTO{}, model.NewAPIError(409, response.CodeBadRequest, "上传会话已过期")
	}
	if apiError := service.validateSessionUploadSize(session, fileHeader); apiError != nil {
		log.Printf("file-upload session failed operator=%d session=%s reason=size_exceeded err=%s", operatorID, cleanSessionID, apiError.Message)
		return model.FileUploadResultDTO{}, apiError
	}
	if _, ok := service.fileRepository.MarkSessionUploading(session.ID, operatorID); !ok {
		log.Printf("file-upload session failed operator=%d session=%s reason=session_state_unavailable", operatorID, cleanSessionID)
		return model.FileUploadResultDTO{}, model.NewAPIError(409, response.CodeBadRequest, "上传会话状态不可用")
	}

	meta, apiError := service.persistUploadedFile(session.FileID, session.TargetVersionNo, fileHeader)
	if apiError != nil {
		log.Printf("file-upload session failed operator=%d session=%s reason=persist_failed err=%s", operatorID, cleanSessionID, apiError.Message)
		return model.FileUploadResultDTO{}, apiError
	}

	fileEntity, versionEntity, ok := service.fileRepository.CompleteSessionUpload(session.ID, operatorID, meta)
	if !ok {
		_ = service.fileStorage.Delete(meta.StorageKey)
		log.Printf("file-upload session failed operator=%d session=%s reason=complete_failed storage=%s", operatorID, cleanSessionID, meta.StorageKey)
		return model.FileUploadResultDTO{}, model.NewAPIError(409, response.CodeBadRequest, "会话提交失败，请重试")
	}
	log.Printf("file-upload session success operator=%d session=%s fileId=%d versionNo=%d storage=%s size=%d", operatorID, cleanSessionID, fileEntity.ID, versionEntity.VersionNo, meta.StorageKey, meta.SizeBytes)

	latestVersion := versionEntity
	service.enqueueIndexTask(context.Background(), versionEntity.FileID, versionEntity.VersionNo)
	return model.FileUploadResultDTO{
		FileID:    fileEntity.ID,
		VersionNo: versionEntity.VersionNo,
		SessionID: session.ID,
		File:      fileEntity.ToDTO(&latestVersion),
		Version:   versionEntity.ToDTO(),
	}, nil
}

func (service *fileService) UploadVersion(_ context.Context, operatorID int64, fileID int64, fileHeader *multipart.FileHeader) (model.FileUploadResultDTO, *model.APIError) {
	service.expireSessions()

	fileEntity, ok := service.fileRepository.FindFileByID(fileID)
	if !ok {
		return model.FileUploadResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件不存在")
	}
	nextVersionNo := fileEntity.LatestVersionNo + 1
	meta, apiError := service.persistUploadedFile(fileID, nextVersionNo, fileHeader)
	if apiError != nil {
		return model.FileUploadResultDTO{}, apiError
	}
	fileEntity, versionEntity, ok := service.fileRepository.CreateVersion(fileID, operatorID, meta)
	if !ok {
		_ = service.fileStorage.Delete(meta.StorageKey)
		return model.FileUploadResultDTO{}, model.NewAPIError(409, response.CodeBadRequest, "创建版本失败")
	}

	latestVersion := versionEntity
	service.enqueueIndexTask(context.Background(), versionEntity.FileID, versionEntity.VersionNo)
	return model.FileUploadResultDTO{
		FileID:    fileEntity.ID,
		VersionNo: versionEntity.VersionNo,
		File:      fileEntity.ToDTO(&latestVersion),
		Version:   versionEntity.ToDTO(),
	}, nil
}

func (service *fileService) enqueueIndexTask(ctx context.Context, fileID int64, versionNo int) {
	if service.indexEnqueuer == nil || fileID <= 0 || versionNo <= 0 {
		return
	}
	if apiError := service.indexEnqueuer.Enqueue(ctx, fileID, versionNo); apiError != nil {
		log.Printf("knowledge-index enqueue failed fileId=%d versionNo=%d err=%s", fileID, versionNo, apiError.Message)
	}
}

func (service *fileService) CancelSession(_ context.Context, operatorID int64, sessionID string) *model.APIError {
	service.expireSessions()

	if strings.TrimSpace(sessionID) == "" {
		return model.NewAPIError(400, response.CodeBadRequest, "sessionId 不能为空")
	}
	if !service.fileRepository.CancelSession(sessionID, operatorID) {
		return model.NewAPIError(404, response.CodeNotFound, "上传会话不存在或无法取消")
	}
	return nil
}

func (service *fileService) GetFile(_ context.Context, fileID int64) (model.FileDTO, *model.APIError) {
	fileEntity, ok := service.fileRepository.FindFileByID(fileID)
	if !ok {
		return model.FileDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件不存在")
	}

	var latestVersion *model.FileVersion
	if fileEntity.LatestVersionNo > 0 {
		version, ok := service.fileRepository.FindVersion(fileID, fileEntity.LatestVersionNo)
		if ok {
			latestVersion = &version
		}
	}
	return fileEntity.ToDTO(latestVersion), nil
}

func (service *fileService) ListVersions(_ context.Context, fileID int64) ([]model.FileVersionDTO, *model.APIError) {
	versions, ok := service.fileRepository.FindVersions(fileID)
	if !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "文件不存在")
	}
	dtos := make([]model.FileVersionDTO, 0, len(versions))
	for _, version := range versions {
		dtos = append(dtos, version.ToDTO())
	}
	return dtos, nil
}

func (service *fileService) ResolveReference(_ context.Context, fileID int64, versionNo int) (model.FileVersionDTO, *model.APIError) {
	fileEntity, ok := service.fileRepository.FindFileByID(fileID)
	if !ok {
		return model.FileVersionDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件不存在")
	}
	if versionNo <= 0 {
		versionNo = fileEntity.LatestVersionNo
	}
	if versionNo <= 0 {
		return model.FileVersionDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件暂无已上传版本")
	}
	version, ok := service.fileRepository.FindVersion(fileID, versionNo)
	if !ok || version.Status != model.FileVersionStatusUploaded {
		return model.FileVersionDTO{}, model.NewAPIError(404, response.CodeNotFound, "文件版本不存在")
	}
	return version.ToDTO(), nil
}

func (service *fileService) ReadReferenceContent(ctx context.Context, fileID int64, versionNo int, maxBytes int64) (model.FileVersionDTO, []byte, *model.APIError) {
	log.Printf("file-read start fileId=%d versionNo=%d maxBytes=%d", fileID, versionNo, maxBytes)
	version, apiError := service.ResolveReference(ctx, fileID, versionNo)
	if apiError != nil {
		log.Printf("file-read failed fileId=%d versionNo=%d reason=resolve_failed err=%s", fileID, versionNo, apiError.Message)
		return model.FileVersionDTO{}, nil, apiError
	}
	if maxBytes > 0 && version.SizeBytes > maxBytes {
		log.Printf("file-read failed fileId=%d versionNo=%d reason=size_exceeded size=%d maxBytes=%d", fileID, version.VersionNo, version.SizeBytes, maxBytes)
		return model.FileVersionDTO{}, nil, model.NewAPIError(400, response.CodeBadRequest, "文件超过 AI 处理大小限制")
	}
	raw, err := service.fileStorage.Read(version.StorageKey)
	if err != nil {
		log.Printf("file-read failed fileId=%d versionNo=%d reason=storage_read_failed storage=%s err=%v", fileID, version.VersionNo, version.StorageKey, err)
		return model.FileVersionDTO{}, nil, model.NewAPIError(500, response.CodeInternal, "读取上传文件失败")
	}
	if maxBytes > 0 && int64(len(raw)) > maxBytes {
		log.Printf("file-read failed fileId=%d versionNo=%d reason=content_exceeded actual=%d maxBytes=%d", fileID, version.VersionNo, len(raw), maxBytes)
		return model.FileVersionDTO{}, nil, model.NewAPIError(400, response.CodeBadRequest, "文件超过 AI 处理大小限制")
	}
	log.Printf("file-read success fileId=%d versionNo=%d storage=%s bytes=%d mime=%s", fileID, version.VersionNo, version.StorageKey, len(raw), version.MimeType)
	return version, raw, nil
}

func (service *fileService) DeleteFile(_ context.Context, fileID int64) *model.APIError {
	fileEntity, ok := service.fileRepository.FindFileByID(fileID)
	if !ok {
		return model.NewAPIError(404, response.CodeNotFound, "文件不存在")
	}

	versions, ok := service.fileRepository.FindVersions(fileID)
	if !ok {
		return model.NewAPIError(404, response.CodeNotFound, "文件不存在")
	}
	storageKeys := make([]string, 0, len(versions))
	for _, version := range versions {
		if strings.TrimSpace(version.StorageKey) != "" {
			storageKeys = append(storageKeys, version.StorageKey)
		}
	}

	if !service.fileRepository.DeleteFile(fileID) {
		return model.NewAPIError(500, response.CodeInternal, "删除文件记录失败")
	}

	failedKeys := make([]string, 0)
	for _, storageKey := range storageKeys {
		if err := service.fileStorage.Delete(storageKey); err != nil {
			failedKeys = append(failedKeys, storageKey)
			log.Printf("file-delete storage cleanup failed fileId=%d bizKey=%s storage=%s err=%v", fileEntity.ID, fileEntity.BizKey, storageKey, err)
		}
	}
	if len(failedKeys) > 0 {
		return model.NewAPIError(500, response.CodeInternal, "文件记录已删除，但部分存储文件清理失败")
	}
	return nil
}

func (service *fileService) persistUploadedFile(fileID int64, versionNo int, fileHeader *multipart.FileHeader) (model.UploadedFileMeta, *model.APIError) {
	if fileHeader == nil {
		return model.UploadedFileMeta{}, model.NewAPIError(400, response.CodeBadRequest, "缺少上传文件")
	}
	if fileHeader.Size > 0 && fileHeader.Size > maxUploadSizeBytes {
		return model.UploadedFileMeta{}, model.NewAPIError(400, response.CodeBadRequest, "上传文件大小不能超过 10MB")
	}
	fileName := sanitizeFileName(fileHeader.Filename)
	openedFile, err := fileHeader.Open()
	if err != nil {
		return model.UploadedFileMeta{}, model.NewAPIError(400, response.CodeBadRequest, "读取上传文件失败")
	}
	defer openedFile.Close()

	storageKey := buildStorageKey(fileID, versionNo, fileName)
	writtenBytes, checksum, err := service.fileStorage.Save(storageKey, openedFile)
	if err != nil {
		return model.UploadedFileMeta{}, model.NewAPIError(500, response.CodeInternal, "保存上传文件失败")
	}

	mimeType := strings.TrimSpace(fileHeader.Header.Get("Content-Type"))
	if mimeType == "" {
		mimeType = detectMimeType(openedFile, fileName)
	}

	return model.UploadedFileMeta{
		OriginName: fileName,
		MimeType:   mimeType,
		SizeBytes:  writtenBytes,
		Checksum:   checksum,
		StorageKey: storageKey,
	}, nil
}

func (service *fileService) validateSessionUploadSize(session model.UploadSession, fileHeader *multipart.FileHeader) *model.APIError {
	if fileHeader == nil || fileHeader.Size <= maxDebugFeedbackUploadSizeBytes {
		return nil
	}
	fileEntity, ok := service.fileRepository.FindFileByID(session.FileID)
	if !ok {
		return nil
	}
	if strings.HasPrefix(fileEntity.BizKey, debugFeedbackBizKeyPrefix) {
		return model.NewAPIError(400, response.CodeBadRequest, "提交 Bug 的单个附件不能超过 10MB")
	}
	return nil
}

func (service *fileService) expireSessions() {
	service.fileRepository.ExpireSessions(time.Now().UTC())
}

func generateSessionID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func buildStorageKey(fileID int64, versionNo int, fileName string) string {
	prefix := time.Now().UTC().Format("20060102T150405")
	ext := strings.TrimSpace(filepath.Ext(fileName))
	name := strings.TrimSuffix(fileName, ext)
	if name == "" {
		name = "file"
	}
	if ext == "" {
		ext = ".bin"
	}
	return fmt.Sprintf("%d/v%d/%s_%s%s", fileID, versionNo, prefix, sanitizeFileName(name), ext)
}

func detectMimeType(file multipart.File, fileName string) string {
	type seeker interface {
		io.Reader
		io.Seeker
	}
	seekable, ok := file.(seeker)
	if !ok {
		return mimeTypeByExt(fileName)
	}
	if _, err := seekable.Seek(0, io.SeekStart); err != nil {
		return mimeTypeByExt(fileName)
	}
	buffer := make([]byte, 512)
	readBytes, err := seekable.Read(buffer)
	if err != nil {
		return mimeTypeByExt(fileName)
	}
	if _, err := seekable.Seek(0, io.SeekStart); err != nil {
		return mimeTypeByExt(fileName)
	}
	if readBytes <= 0 {
		return mimeTypeByExt(fileName)
	}
	return http.DetectContentType(buffer[:readBytes])
}

func mimeTypeByExt(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".txt":
		return "text/plain"
	case ".md":
		return "text/markdown"
	case ".csv":
		return "text/csv"
	case ".tsv":
		return "text/tab-separated-values"
	case ".pdf":
		return "application/pdf"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".json":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}
