package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresFileRepository struct {
	db *sql.DB
}

func NewPostgresFileRepository(db *sql.DB) FileRepository {
	return &PostgresFileRepository{db: db}
}

func (repository *PostgresFileRepository) CreateSession(sessionID string, fileID int64, bizKey string, expiresAt time.Time, operatorID int64) (model.UploadSession, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if strings.TrimSpace(sessionID) == "" {
		return model.UploadSession{}, false
	}

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.UploadSession{}, false
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()
	currentFileID := fileID
	latestVersionNo := 0

	if currentFileID > 0 {
		var status string
		err = tx.QueryRowContext(ctx, `
SELECT status, latest_version_no
FROM file
WHERE id = $1
FOR UPDATE
`, currentFileID).Scan(&status, &latestVersionNo)
		if err != nil || status != model.FileStatusActive {
			return model.UploadSession{}, false
		}
	} else {
		err = tx.QueryRowContext(ctx, `
INSERT INTO file (biz_key, latest_version_no, status, created_at, updated_at, created_by, updated_by)
VALUES ($1, 0, $2, $3, $3, $4, $4)
RETURNING id
`, strings.TrimSpace(bizKey), model.FileStatusActive, now, operatorID).Scan(&currentFileID)
		if err != nil {
			return model.UploadSession{}, false
		}
	}

	targetVersionNo := latestVersionNo + 1
	_, err = tx.ExecContext(ctx, `
INSERT INTO upload_session (id, file_id, target_version_no, status, expires_at, created_at, updated_at, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)
`, sessionID, currentFileID, targetVersionNo, model.UploadSessionStatusSelected, expiresAt, now, operatorID)
	if err != nil {
		return model.UploadSession{}, false
	}

	if err := tx.Commit(); err != nil {
		return model.UploadSession{}, false
	}

	return model.UploadSession{
		ID:              sessionID,
		FileID:          currentFileID,
		TargetVersionNo: targetVersionNo,
		Status:          model.UploadSessionStatusSelected,
		ExpiresAt:       expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       operatorID,
		UpdatedBy:       operatorID,
	}, true
}

func (repository *PostgresFileRepository) FindSessionByID(sessionID string) (model.UploadSession, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var session model.UploadSession
	err := repository.db.QueryRowContext(ctx, `
SELECT id, file_id, target_version_no, status, expires_at, created_at, updated_at, created_by, updated_by
FROM upload_session
WHERE id = $1
`, sessionID).Scan(
		&session.ID,
		&session.FileID,
		&session.TargetVersionNo,
		&session.Status,
		&session.ExpiresAt,
		&session.CreatedAt,
		&session.UpdatedAt,
		&session.CreatedBy,
		&session.UpdatedBy,
	)
	if err != nil {
		return model.UploadSession{}, false
	}
	return session, true
}

func (repository *PostgresFileRepository) MarkSessionUploading(sessionID string, operatorID int64) (model.UploadSession, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	now := time.Now().UTC()
	result, err := repository.db.ExecContext(ctx, `
UPDATE upload_session
SET status = $2, updated_at = $3, updated_by = $4
WHERE id = $1 AND status = $5
`, sessionID, model.UploadSessionStatusUploading, now, operatorID, model.UploadSessionStatusSelected)
	if err != nil {
		return model.UploadSession{}, false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		session, ok := repository.FindSessionByID(sessionID)
		if !ok || session.Status != model.UploadSessionStatusUploading {
			return model.UploadSession{}, false
		}
		return session, true
	}
	return repository.FindSessionByID(sessionID)
}

func (repository *PostgresFileRepository) CompleteSessionUpload(sessionID string, operatorID int64, meta model.UploadedFileMeta) (model.File, model.FileVersion, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}
	defer func() { _ = tx.Rollback() }()

	var session model.UploadSession
	err = tx.QueryRowContext(ctx, `
SELECT id, file_id, target_version_no, status, expires_at, created_at, updated_at, created_by, updated_by
FROM upload_session
WHERE id = $1
FOR UPDATE
`, sessionID).Scan(
		&session.ID,
		&session.FileID,
		&session.TargetVersionNo,
		&session.Status,
		&session.ExpiresAt,
		&session.CreatedAt,
		&session.UpdatedAt,
		&session.CreatedBy,
		&session.UpdatedBy,
	)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	if session.Status != model.UploadSessionStatusSelected && session.Status != model.UploadSessionStatusUploading {
		return model.File{}, model.FileVersion{}, false
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		return model.File{}, model.FileVersion{}, false
	}

	var file model.File
	err = tx.QueryRowContext(ctx, `
SELECT id, biz_key, latest_version_no, status, created_at, updated_at, created_by, updated_by
FROM file
WHERE id = $1
FOR UPDATE
`, session.FileID).Scan(
		&file.ID,
		&file.BizKey,
		&file.LatestVersionNo,
		&file.Status,
		&file.CreatedAt,
		&file.UpdatedAt,
		&file.CreatedBy,
		&file.UpdatedBy,
	)
	if err != nil || file.Status != model.FileStatusActive {
		return model.File{}, model.FileVersion{}, false
	}

	now := time.Now().UTC()
	var versionID int64
	err = tx.QueryRowContext(ctx, `
INSERT INTO file_version (file_id, version_no, storage_key, origin_name, mime_type, size_bytes, checksum, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
RETURNING id
`, session.FileID, session.TargetVersionNo, meta.StorageKey, meta.OriginName, meta.MimeType, meta.SizeBytes, meta.Checksum, model.FileVersionStatusUploaded, now).Scan(&versionID)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	nextLatest := file.LatestVersionNo
	if session.TargetVersionNo > nextLatest {
		nextLatest = session.TargetVersionNo
	}
	_, err = tx.ExecContext(ctx, `
UPDATE file
SET latest_version_no = $2, updated_at = $3, updated_by = $4
WHERE id = $1
`, file.ID, nextLatest, now, operatorID)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	_, err = tx.ExecContext(ctx, `
UPDATE upload_session
SET status = $2, updated_at = $3, updated_by = $4
WHERE id = $1
`, session.ID, model.UploadSessionStatusUploaded, now, operatorID)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	if err := tx.Commit(); err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	file.LatestVersionNo = nextLatest
	file.UpdatedAt = now
	file.UpdatedBy = operatorID
	version := model.FileVersion{
		ID:         versionID,
		FileID:     session.FileID,
		VersionNo:  session.TargetVersionNo,
		StorageKey: meta.StorageKey,
		OriginName: meta.OriginName,
		MimeType:   meta.MimeType,
		SizeBytes:  meta.SizeBytes,
		Checksum:   meta.Checksum,
		Status:     model.FileVersionStatusUploaded,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	return file, version, true
}

func (repository *PostgresFileRepository) CancelSession(sessionID string, operatorID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	result, err := repository.db.ExecContext(ctx, `
UPDATE upload_session
SET status = $2, updated_at = $3, updated_by = $4
WHERE id = $1 AND status IN ($5, $6)
`, sessionID, model.UploadSessionStatusCancelled, time.Now().UTC(), operatorID, model.UploadSessionStatusSelected, model.UploadSessionStatusUploading)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	return err == nil && affected > 0
}

func (repository *PostgresFileRepository) ExpireSessions(now time.Time) int {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	result, err := repository.db.ExecContext(ctx, `
UPDATE upload_session
SET status = $2, updated_at = $1
WHERE status IN ($3, $4) AND expires_at < $1
`, now, model.UploadSessionStatusExpired, model.UploadSessionStatusSelected, model.UploadSessionStatusUploading)
	if err != nil {
		return 0
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0
	}
	return int(affected)
}

func (repository *PostgresFileRepository) FindFileByID(fileID int64) (model.File, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var file model.File
	err := repository.db.QueryRowContext(ctx, `
SELECT id, biz_key, latest_version_no, status, created_at, updated_at, created_by, updated_by
FROM file
WHERE id = $1
`, fileID).Scan(
		&file.ID,
		&file.BizKey,
		&file.LatestVersionNo,
		&file.Status,
		&file.CreatedAt,
		&file.UpdatedAt,
		&file.CreatedBy,
		&file.UpdatedBy,
	)
	if err != nil {
		return model.File{}, false
	}
	return file, true
}

func (repository *PostgresFileRepository) FindAllFiles() []model.File {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, biz_key, latest_version_no, status, created_at, updated_at, created_by, updated_by
FROM file
ORDER BY id ASC
`)
	if err != nil {
		return []model.File{}
	}
	defer rows.Close()

	files := make([]model.File, 0)
	for rows.Next() {
		var file model.File
		if err := rows.Scan(
			&file.ID,
			&file.BizKey,
			&file.LatestVersionNo,
			&file.Status,
			&file.CreatedAt,
			&file.UpdatedAt,
			&file.CreatedBy,
			&file.UpdatedBy,
		); err != nil {
			continue
		}
		files = append(files, file)
	}
	return files
}

func (repository *PostgresFileRepository) FindVersions(fileID int64) ([]model.FileVersion, bool) {
	if _, ok := repository.FindFileByID(fileID); !ok {
		return nil, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, file_id, version_no, storage_key, origin_name, mime_type, size_bytes, checksum, status, created_at, updated_at
FROM file_version
WHERE file_id = $1
ORDER BY version_no ASC
`, fileID)
	if err != nil {
		return []model.FileVersion{}, true
	}
	defer rows.Close()

	versions := make([]model.FileVersion, 0)
	for rows.Next() {
		var version model.FileVersion
		if err := rows.Scan(
			&version.ID,
			&version.FileID,
			&version.VersionNo,
			&version.StorageKey,
			&version.OriginName,
			&version.MimeType,
			&version.SizeBytes,
			&version.Checksum,
			&version.Status,
			&version.CreatedAt,
			&version.UpdatedAt,
		); err != nil {
			continue
		}
		versions = append(versions, version)
	}

	sort.Slice(versions, func(i, j int) bool { return versions[i].VersionNo < versions[j].VersionNo })
	return versions, true
}

func (repository *PostgresFileRepository) FindVersion(fileID int64, versionNo int) (model.FileVersion, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var version model.FileVersion
	err := repository.db.QueryRowContext(ctx, `
SELECT id, file_id, version_no, storage_key, origin_name, mime_type, size_bytes, checksum, status, created_at, updated_at
FROM file_version
WHERE file_id = $1 AND version_no = $2
`, fileID, versionNo).Scan(
		&version.ID,
		&version.FileID,
		&version.VersionNo,
		&version.StorageKey,
		&version.OriginName,
		&version.MimeType,
		&version.SizeBytes,
		&version.Checksum,
		&version.Status,
		&version.CreatedAt,
		&version.UpdatedAt,
	)
	if err != nil {
		return model.FileVersion{}, false
	}
	return version, true
}

func (repository *PostgresFileRepository) CreateVersion(fileID int64, operatorID int64, meta model.UploadedFileMeta) (model.File, model.FileVersion, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}
	defer func() { _ = tx.Rollback() }()

	var file model.File
	err = tx.QueryRowContext(ctx, `
SELECT id, biz_key, latest_version_no, status, created_at, updated_at, created_by, updated_by
FROM file
WHERE id = $1
FOR UPDATE
`, fileID).Scan(
		&file.ID,
		&file.BizKey,
		&file.LatestVersionNo,
		&file.Status,
		&file.CreatedAt,
		&file.UpdatedAt,
		&file.CreatedBy,
		&file.UpdatedBy,
	)
	if err != nil || file.Status != model.FileStatusActive {
		return model.File{}, model.FileVersion{}, false
	}

	versionNo := file.LatestVersionNo + 1
	now := time.Now().UTC()
	var versionID int64
	err = tx.QueryRowContext(ctx, `
INSERT INTO file_version (file_id, version_no, storage_key, origin_name, mime_type, size_bytes, checksum, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
RETURNING id
`, fileID, versionNo, meta.StorageKey, meta.OriginName, meta.MimeType, meta.SizeBytes, meta.Checksum, model.FileVersionStatusUploaded, now).Scan(&versionID)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	_, err = tx.ExecContext(ctx, `
UPDATE file
SET latest_version_no = $2, updated_at = $3, updated_by = $4
WHERE id = $1
`, fileID, versionNo, now, operatorID)
	if err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	if err := tx.Commit(); err != nil {
		return model.File{}, model.FileVersion{}, false
	}

	file.LatestVersionNo = versionNo
	file.UpdatedAt = now
	file.UpdatedBy = operatorID
	version := model.FileVersion{
		ID:         versionID,
		FileID:     fileID,
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
	return file, version, true
}

func (repository *PostgresFileRepository) DeleteFile(fileID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	result, err := repository.db.ExecContext(ctx, `
DELETE FROM file
WHERE id = $1
`, fileID)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false
	}
	return affected > 0
}

func (repository *PostgresFileRepository) CreateOCRTask(task model.OCRTask) model.OCRTask {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	now := time.Now().UTC()
	task.CreatedAt = now
	task.UpdatedAt = now
	if task.RequestPayloadJSON == nil {
		task.RequestPayloadJSON = json.RawMessage(`{}`)
	}
	if task.ResultPayloadJSON == nil {
		task.ResultPayloadJSON = json.RawMessage(`null`)
	}
	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO ocr_task (
  file_id, version_no, status, provider_mode, provider_used, provider_task_id,
  request_payload_json, result_payload_json, page_count, confidence,
  error_code, error_message, retry_count, started_at, finished_at, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $16
)
RETURNING id
`, task.FileID, task.VersionNo, task.Status, task.ProviderMode, task.ProviderUsed, task.ProviderTaskID,
		task.RequestPayloadJSON, task.ResultPayloadJSON, task.PageCount, task.Confidence,
		task.ErrorCode, task.ErrorMessage, task.RetryCount, task.StartedAt, task.FinishedAt, now).Scan(&task.ID)
	return task
}

func (repository *PostgresFileRepository) UpdateOCRTask(task model.OCRTask) (model.OCRTask, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	task.UpdatedAt = time.Now().UTC()
	if task.RequestPayloadJSON == nil {
		task.RequestPayloadJSON = json.RawMessage(`{}`)
	}
	if task.ResultPayloadJSON == nil {
		task.ResultPayloadJSON = json.RawMessage(`null`)
	}
	result, err := repository.db.ExecContext(ctx, `
UPDATE ocr_task
SET status = $2,
    provider_mode = $3,
    provider_used = $4,
    provider_task_id = $5,
    request_payload_json = $6,
    result_payload_json = $7,
    page_count = $8,
    confidence = $9,
    error_code = $10,
    error_message = $11,
    retry_count = $12,
    started_at = $13,
    finished_at = $14,
    updated_at = $15
WHERE id = $1
`, task.ID, task.Status, task.ProviderMode, task.ProviderUsed, task.ProviderTaskID,
		task.RequestPayloadJSON, task.ResultPayloadJSON, task.PageCount, task.Confidence,
		task.ErrorCode, task.ErrorMessage, task.RetryCount, task.StartedAt, task.FinishedAt, task.UpdatedAt)
	if err != nil {
		return model.OCRTask{}, false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected <= 0 {
		return model.OCRTask{}, false
	}
	return task, true
}

func (repository *PostgresFileRepository) FindOCRTaskByID(taskID int64) (model.OCRTask, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var task model.OCRTask
	var startedAt sql.NullTime
	var finishedAt sql.NullTime
	err := repository.db.QueryRowContext(ctx, `
SELECT id, file_id, version_no, status, provider_mode, provider_used, provider_task_id,
       request_payload_json, result_payload_json, page_count, confidence,
       error_code, error_message, retry_count, started_at, finished_at, created_at, updated_at
FROM ocr_task
WHERE id = $1
`, taskID).Scan(
		&task.ID, &task.FileID, &task.VersionNo, &task.Status, &task.ProviderMode, &task.ProviderUsed, &task.ProviderTaskID,
		&task.RequestPayloadJSON, &task.ResultPayloadJSON, &task.PageCount, &task.Confidence,
		&task.ErrorCode, &task.ErrorMessage, &task.RetryCount, &startedAt, &finishedAt, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return model.OCRTask{}, false
	}
	if startedAt.Valid {
		task.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		task.FinishedAt = &finishedAt.Time
	}
	return task, true
}

func (repository *PostgresFileRepository) FindLatestOCRTask(fileID int64, versionNo int) (model.OCRTask, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var task model.OCRTask
	var startedAt sql.NullTime
	var finishedAt sql.NullTime
	err := repository.db.QueryRowContext(ctx, `
SELECT id, file_id, version_no, status, provider_mode, provider_used, provider_task_id,
       request_payload_json, result_payload_json, page_count, confidence,
       error_code, error_message, retry_count, started_at, finished_at, created_at, updated_at
FROM ocr_task
WHERE file_id = $1 AND version_no = $2
ORDER BY created_at DESC, id DESC
LIMIT 1
`, fileID, versionNo).Scan(
		&task.ID, &task.FileID, &task.VersionNo, &task.Status, &task.ProviderMode, &task.ProviderUsed, &task.ProviderTaskID,
		&task.RequestPayloadJSON, &task.ResultPayloadJSON, &task.PageCount, &task.Confidence,
		&task.ErrorCode, &task.ErrorMessage, &task.RetryCount, &startedAt, &finishedAt, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return model.OCRTask{}, false
	}
	if startedAt.Valid {
		task.StartedAt = &startedAt.Time
	}
	if finishedAt.Valid {
		task.FinishedAt = &finishedAt.Time
	}
	return task, true
}
