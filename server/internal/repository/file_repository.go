package repository

import (
	"sort"
	"strings"
	"sync"
	"time"

	"sxfgssever/server/internal/model"
)

type FileRepository interface {
	CreateSession(sessionID string, fileID int64, bizKey string, expiresAt time.Time, operatorID int64) (model.UploadSession, bool)
	FindSessionByID(sessionID string) (model.UploadSession, bool)
	MarkSessionUploading(sessionID string, operatorID int64) (model.UploadSession, bool)
	CompleteSessionUpload(sessionID string, operatorID int64, meta model.UploadedFileMeta) (model.File, model.FileVersion, bool)
	CancelSession(sessionID string, operatorID int64) bool
	ExpireSessions(now time.Time) int
	FindAllFiles() []model.File
	FindFileByID(fileID int64) (model.File, bool)
	FindVersions(fileID int64) ([]model.FileVersion, bool)
	FindVersion(fileID int64, versionNo int) (model.FileVersion, bool)
	CreateVersion(fileID int64, operatorID int64, meta model.UploadedFileMeta) (model.File, model.FileVersion, bool)
}

type fileRepository struct {
	mu            sync.RWMutex
	files         map[int64]model.File
	versions      map[int64]map[int]model.FileVersion
	sessions      map[string]model.UploadSession
	nextFileID    int64
	nextVersionID int64
}

func NewFileRepository() FileRepository {
	return &fileRepository{
		files:         make(map[int64]model.File),
		versions:      make(map[int64]map[int]model.FileVersion),
		sessions:      make(map[string]model.UploadSession),
		nextFileID:    1,
		nextVersionID: 1,
	}
}

func (repository *fileRepository) CreateSession(sessionID string, fileID int64, bizKey string, expiresAt time.Time, operatorID int64) (model.UploadSession, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	if strings.TrimSpace(sessionID) == "" {
		return model.UploadSession{}, false
	}
	if _, exists := repository.sessions[sessionID]; exists {
		return model.UploadSession{}, false
	}

	now := time.Now().UTC()
	file, ok := repository.files[fileID]
	if fileID > 0 {
		if !ok {
			return model.UploadSession{}, false
		}
		if file.Status != model.FileStatusActive {
			return model.UploadSession{}, false
		}
	} else {
		file = model.File{
			BaseEntity: model.BaseEntity{
				ID:        repository.nextFileID,
				CreatedAt: now,
				UpdatedAt: now,
				CreatedBy: operatorID,
				UpdatedBy: operatorID,
			},
			BizKey:          strings.TrimSpace(bizKey),
			LatestVersionNo: 0,
			Status:          model.FileStatusActive,
		}
		repository.files[file.ID] = file
		repository.nextFileID++
	}

	targetVersionNo := file.LatestVersionNo + 1
	session := model.UploadSession{
		ID:              sessionID,
		FileID:          file.ID,
		TargetVersionNo: targetVersionNo,
		Status:          model.UploadSessionStatusSelected,
		ExpiresAt:       expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       operatorID,
		UpdatedBy:       operatorID,
	}
	repository.sessions[sessionID] = session
	return session, true
}

func (repository *fileRepository) FindSessionByID(sessionID string) (model.UploadSession, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	session, ok := repository.sessions[sessionID]
	return session, ok
}

func (repository *fileRepository) MarkSessionUploading(sessionID string, operatorID int64) (model.UploadSession, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	session, ok := repository.sessions[sessionID]
	if !ok {
		return model.UploadSession{}, false
	}
	if session.Status == model.UploadSessionStatusUploading {
		return session, true
	}
	if session.Status != model.UploadSessionStatusSelected {
		return model.UploadSession{}, false
	}
	now := time.Now().UTC()
	session.Status = model.UploadSessionStatusUploading
	session.UpdatedBy = operatorID
	session.UpdatedAt = now
	repository.sessions[sessionID] = session
	return session, true
}

func (repository *fileRepository) CompleteSessionUpload(sessionID string, operatorID int64, meta model.UploadedFileMeta) (model.File, model.FileVersion, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	session, ok := repository.sessions[sessionID]
	if !ok {
		return model.File{}, model.FileVersion{}, false
	}
	if session.Status != model.UploadSessionStatusSelected && session.Status != model.UploadSessionStatusUploading {
		return model.File{}, model.FileVersion{}, false
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		return model.File{}, model.FileVersion{}, false
	}

	file, ok := repository.files[session.FileID]
	if !ok || file.Status != model.FileStatusActive {
		return model.File{}, model.FileVersion{}, false
	}

	versionNo := session.TargetVersionNo
	if _, exists := repository.versions[file.ID]; !exists {
		repository.versions[file.ID] = make(map[int]model.FileVersion)
	}
	if _, exists := repository.versions[file.ID][versionNo]; exists {
		return model.File{}, model.FileVersion{}, false
	}

	now := time.Now().UTC()
	version := model.FileVersion{
		ID:         repository.nextVersionID,
		FileID:     file.ID,
		VersionNo:  versionNo,
		StorageKey: meta.StorageKey,
		OriginName: meta.OriginName,
		MimeType:   meta.MimeType,
		SizeBytes:  meta.SizeBytes,
		Checksum:   meta.Checksum,
		Status:     model.FileVersionStatusUploaded,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	repository.nextVersionID++
	repository.versions[file.ID][versionNo] = version

	if versionNo > file.LatestVersionNo {
		file.LatestVersionNo = versionNo
	}
	file.UpdatedBy = operatorID
	file.UpdatedAt = now
	repository.files[file.ID] = file

	session.Status = model.UploadSessionStatusUploaded
	session.UpdatedBy = operatorID
	session.UpdatedAt = now
	repository.sessions[sessionID] = session

	return file, version, true
}

func (repository *fileRepository) CancelSession(sessionID string, operatorID int64) bool {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	session, ok := repository.sessions[sessionID]
	if !ok {
		return false
	}
	if session.Status == model.UploadSessionStatusUploaded || session.Status == model.UploadSessionStatusExpired {
		return false
	}
	session.Status = model.UploadSessionStatusCancelled
	session.UpdatedBy = operatorID
	session.UpdatedAt = time.Now().UTC()
	repository.sessions[sessionID] = session
	return true
}

func (repository *fileRepository) ExpireSessions(now time.Time) int {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	expiredCount := 0
	for sessionID, session := range repository.sessions {
		if (session.Status == model.UploadSessionStatusSelected || session.Status == model.UploadSessionStatusUploading) && now.After(session.ExpiresAt) {
			session.Status = model.UploadSessionStatusExpired
			session.UpdatedAt = now
			repository.sessions[sessionID] = session
			expiredCount++
		}
	}
	return expiredCount
}

func (repository *fileRepository) FindFileByID(fileID int64) (model.File, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	file, ok := repository.files[fileID]
	return file, ok
}

func (repository *fileRepository) FindAllFiles() []model.File {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	ids := make([]int64, 0, len(repository.files))
	for fileID := range repository.files {
		ids = append(ids, fileID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	files := make([]model.File, 0, len(ids))
	for _, fileID := range ids {
		files = append(files, repository.files[fileID])
	}
	return files
}

func (repository *fileRepository) FindVersions(fileID int64) ([]model.FileVersion, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	if _, ok := repository.files[fileID]; !ok {
		return nil, false
	}
	versionMap, ok := repository.versions[fileID]
	if !ok {
		return []model.FileVersion{}, true
	}
	versionNos := make([]int, 0, len(versionMap))
	for versionNo := range versionMap {
		versionNos = append(versionNos, versionNo)
	}
	sort.Ints(versionNos)
	versions := make([]model.FileVersion, 0, len(versionNos))
	for _, versionNo := range versionNos {
		versions = append(versions, versionMap[versionNo])
	}
	return versions, true
}

func (repository *fileRepository) FindVersion(fileID int64, versionNo int) (model.FileVersion, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	versionMap, ok := repository.versions[fileID]
	if !ok {
		return model.FileVersion{}, false
	}
	version, ok := versionMap[versionNo]
	return version, ok
}

func (repository *fileRepository) CreateVersion(fileID int64, operatorID int64, meta model.UploadedFileMeta) (model.File, model.FileVersion, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	file, ok := repository.files[fileID]
	if !ok || file.Status != model.FileStatusActive {
		return model.File{}, model.FileVersion{}, false
	}
	if _, exists := repository.versions[file.ID]; !exists {
		repository.versions[file.ID] = make(map[int]model.FileVersion)
	}
	versionNo := file.LatestVersionNo + 1
	now := time.Now().UTC()
	version := model.FileVersion{
		ID:         repository.nextVersionID,
		FileID:     file.ID,
		VersionNo:  versionNo,
		StorageKey: meta.StorageKey,
		OriginName: meta.OriginName,
		MimeType:   meta.MimeType,
		SizeBytes:  meta.SizeBytes,
		Checksum:   meta.Checksum,
		Status:     model.FileVersionStatusUploaded,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	repository.nextVersionID++
	repository.versions[file.ID][versionNo] = version

	file.LatestVersionNo = versionNo
	file.UpdatedBy = operatorID
	file.UpdatedAt = now
	repository.files[file.ID] = file
	return file, version, true
}
