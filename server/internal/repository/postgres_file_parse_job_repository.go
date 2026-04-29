package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresFileParseJobRepository struct {
	db *sql.DB
}

func NewPostgresFileParseJobRepository(db *sql.DB) FileParseJobRepository {
	return &PostgresFileParseJobRepository{db: db}
}

func (repository *PostgresFileParseJobRepository) Enqueue(fileID int64, versionNo int, requestedBy int64, jobContext model.FileParseJobContext) (model.FileParseJob, bool, bool) {
	if fileID <= 0 || versionNo <= 0 {
		return model.FileParseJob{}, false, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var existing model.FileParseJob
	if err := repository.db.QueryRowContext(ctx, `
SELECT id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
       status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
       ocr_task_status, ocr_pending, ocr_error,
       created_at, updated_at, started_at, finished_at
FROM file_parse_job
WHERE file_id = $1 AND version_no = $2 AND status IN ($3, $4)
ORDER BY id DESC
LIMIT 1
`, fileID, versionNo, model.FileParseJobStatusPending, model.FileParseJobStatusRunning).Scan(
		&existing.ID, &existing.FileID, &existing.VersionNo, &existing.SourceScope, &existing.ProjectID, &existing.ProjectName, &existing.CaseFileID, &existing.ManualCategory,
		&existing.Status, &existing.RetryCount, &existing.ErrorMessage,
		&existing.FileType, &existing.SourceType, &existing.ParseStrategy, &existing.ResultJSON, &existing.RequestedBy,
		&existing.OCRTaskStatus, &existing.OCRPending, &existing.OCRError,
		&existing.CreatedAt, &existing.UpdatedAt, &existing.StartedAt, &existing.FinishedAt,
	); err == nil {
		return existing, true, true
	}

	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, `
INSERT INTO file_parse_job (
  file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
  status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
  ocr_task_status, ocr_pending, ocr_error,
  started_at, finished_at, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7,
  $8, 0, '', '', '', '', 'null'::jsonb, $9,
  '', false, '',
  NULL, NULL, NOW(), NOW()
)
RETURNING id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
          status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
          ocr_task_status, ocr_pending, ocr_error,
          created_at, updated_at, started_at, finished_at
`, fileID, versionNo, strings.TrimSpace(jobContext.SourceScope), jobContext.ProjectID, strings.TrimSpace(jobContext.ProjectName), jobContext.CaseFileID, strings.TrimSpace(jobContext.ManualCategory), model.FileParseJobStatusPending, requestedBy).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false, false
	}
	return job, true, false
}

func (repository *PostgresFileParseJobRepository) FindByID(jobID int64) (model.FileParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, `
SELECT id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
       status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
       ocr_task_status, ocr_pending, ocr_error,
       created_at, updated_at, started_at, finished_at
FROM file_parse_job
WHERE id = $1
`, jobID).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) FindLatest(fileID int64, versionNo int) (model.FileParseJob, bool) {
	if fileID <= 0 {
		return model.FileParseJob{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
SELECT id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
       status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
       ocr_task_status, ocr_pending, ocr_error,
       created_at, updated_at, started_at, finished_at
FROM file_parse_job
WHERE file_id = $1
`
	args := []any{fileID}
	if versionNo > 0 {
		query += " AND version_no = $2 ORDER BY id DESC LIMIT 1"
		args = append(args, versionNo)
	} else {
		query += " ORDER BY id DESC LIMIT 1"
	}

	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, query, args...).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) ClaimNext(maxRetry int, runningRetryAfter time.Duration) (model.FileParseJob, bool) {
	if maxRetry <= 0 {
		maxRetry = 3
	}
	if runningRetryAfter <= 0 {
		runningRetryAfter = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.FileParseJob{}, false
	}
	defer func() { _ = tx.Rollback() }()

	var job model.FileParseJob
	err = tx.QueryRowContext(ctx, `
WITH picked AS (
  SELECT id
  FROM file_parse_job
  WHERE (
      status IN ($1, $2)
      OR (status = $5 AND updated_at <= NOW() - make_interval(secs => $6))
    )
    AND retry_count < $3
  ORDER BY updated_at ASC, id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE file_parse_job p
SET status = $4, started_at = COALESCE(started_at, NOW()), finished_at = NULL, updated_at = NOW()
FROM picked
WHERE p.id = picked.id
RETURNING p.id, p.file_id, p.version_no, p.source_scope, p.project_id, p.project_name, p.case_file_id, p.manual_category,
          p.status, p.retry_count, p.error_message, p.file_type, p.source_type, p.parse_strategy, p.result_json, p.requested_by,
          p.ocr_task_status, p.ocr_pending, p.ocr_error,
          p.created_at, p.updated_at, p.started_at, p.finished_at
`, model.FileParseJobStatusPending, model.FileParseJobStatusFailed, maxRetry, model.FileParseJobStatusRunning, model.FileParseJobStatusRunning, int(runningRetryAfter.Seconds())).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.FileParseJob{}, false
		}
		return model.FileParseJob{}, false
	}
	if err := tx.Commit(); err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) MarkSucceeded(jobID int64, resultJSON []byte, fileType string, sourceType string, parseStrategy string, ocrTaskStatus string, ocrError string) (model.FileParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if len(resultJSON) == 0 {
		resultJSON = []byte(`null`)
	}
	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, `
UPDATE file_parse_job
SET status = $2,
    error_message = '',
    file_type = $3,
    source_type = $4,
    parse_strategy = $5,
    ocr_task_status = $6,
    ocr_pending = false,
    ocr_error = $7,
    result_json = $8::jsonb,
    finished_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND status <> $9
RETURNING id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
          status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
          ocr_task_status, ocr_pending, ocr_error,
          created_at, updated_at, started_at, finished_at
`, jobID, model.FileParseJobStatusSucceeded, strings.TrimSpace(fileType), strings.TrimSpace(sourceType), strings.TrimSpace(parseStrategy), strings.TrimSpace(ocrTaskStatus), truncateText(strings.TrimSpace(ocrError), 1000), string(resultJSON), model.FileParseJobStatusCancelled).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) MarkRunning(jobID int64, resultJSON []byte, fileType string, sourceType string, parseStrategy string, ocrTaskStatus string, ocrPending bool, ocrError string) (model.FileParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if len(resultJSON) == 0 {
		resultJSON = []byte(`null`)
	}
	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, `
UPDATE file_parse_job
SET status = $2,
    file_type = $3,
    source_type = $4,
    parse_strategy = $5,
    ocr_task_status = $6,
    ocr_pending = $7,
    ocr_error = $8,
    result_json = $9::jsonb,
    finished_at = NULL,
    updated_at = NOW()
WHERE id = $1 AND status <> $10
RETURNING id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
          status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
          ocr_task_status, ocr_pending, ocr_error,
          created_at, updated_at, started_at, finished_at
`, jobID, model.FileParseJobStatusRunning, strings.TrimSpace(fileType), strings.TrimSpace(sourceType), strings.TrimSpace(parseStrategy), strings.TrimSpace(ocrTaskStatus), ocrPending, truncateText(strings.TrimSpace(ocrError), 1000), string(resultJSON), model.FileParseJobStatusCancelled).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) MarkFailed(jobID int64, errorMessage string) (model.FileParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, `
UPDATE file_parse_job
SET status = $2,
    retry_count = retry_count + 1,
    error_message = $3,
    ocr_pending = false,
    finished_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND status <> $4
RETURNING id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
          status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
          ocr_task_status, ocr_pending, ocr_error,
          created_at, updated_at, started_at, finished_at
`, jobID, model.FileParseJobStatusFailed, truncateText(strings.TrimSpace(errorMessage), 1000), model.FileParseJobStatusCancelled).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) Cancel(jobID int64, errorMessage string) (model.FileParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var job model.FileParseJob
	err := repository.db.QueryRowContext(ctx, `
UPDATE file_parse_job
SET status = $2,
    error_message = $3,
    ocr_pending = false,
    finished_at = NOW(),
    updated_at = NOW()
WHERE id = $1
RETURNING id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
          status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
          ocr_task_status, ocr_pending, ocr_error,
          created_at, updated_at, started_at, finished_at
`, jobID, model.FileParseJobStatusCancelled, truncateText(strings.TrimSpace(errorMessage), 1000)).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.SourceScope, &job.ProjectID, &job.ProjectName, &job.CaseFileID, &job.ManualCategory,
		&job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.FileType, &job.SourceType, &job.ParseStrategy, &job.ResultJSON, &job.RequestedBy,
		&job.OCRTaskStatus, &job.OCRPending, &job.OCRError,
		&job.CreatedAt, &job.UpdatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return model.FileParseJob{}, false
	}
	return job, true
}

func (repository *PostgresFileParseJobRepository) List(limit int) []model.FileParseJob {
	if limit <= 0 {
		limit = 100
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, file_id, version_no, source_scope, project_id, project_name, case_file_id, manual_category,
       status, retry_count, error_message, file_type, source_type, parse_strategy, result_json, requested_by,
       ocr_task_status, ocr_pending, ocr_error,
       created_at, updated_at, started_at, finished_at
FROM file_parse_job
ORDER BY updated_at DESC, id DESC
LIMIT $1
`, limit)
	if err != nil {
		return []model.FileParseJob{}
	}
	defer rows.Close()

	out := make([]model.FileParseJob, 0, limit)
	for rows.Next() {
		var item model.FileParseJob
		if scanErr := rows.Scan(
			&item.ID, &item.FileID, &item.VersionNo, &item.SourceScope, &item.ProjectID, &item.ProjectName, &item.CaseFileID, &item.ManualCategory,
			&item.Status, &item.RetryCount, &item.ErrorMessage,
			&item.FileType, &item.SourceType, &item.ParseStrategy, &item.ResultJSON, &item.RequestedBy,
			&item.OCRTaskStatus, &item.OCRPending, &item.OCRError,
			&item.CreatedAt, &item.UpdatedAt, &item.StartedAt, &item.FinishedAt,
		); scanErr != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}
