package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresKnowledgeRepository struct {
	db *sql.DB
}

func NewPostgresKnowledgeRepository(db *sql.DB) KnowledgeRepository {
	return &PostgresKnowledgeRepository{db: db}
}

func (repository *PostgresKnowledgeRepository) EnqueueJob(fileID int64, versionNo int) (model.KnowledgeIndexJob, bool) {
	if fileID <= 0 || versionNo <= 0 {
		return model.KnowledgeIndexJob{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var job model.KnowledgeIndexJob
	err := repository.db.QueryRowContext(ctx, `
INSERT INTO knowledge_index_job (file_id, version_no, status, retry_count, error_message, started_at, finished_at, created_at, updated_at)
VALUES ($1, $2, $3, 0, '', NULL, NULL, NOW(), NOW())
ON CONFLICT (file_id, version_no) DO UPDATE SET
  status = $3,
  error_message = '',
  started_at = NULL,
  finished_at = NULL,
  updated_at = NOW()
RETURNING id, file_id, version_no, status, retry_count, error_message, started_at, finished_at, created_at, updated_at
`, fileID, versionNo, model.KnowledgeIndexJobStatusPending).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.StartedAt, &job.FinishedAt, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return model.KnowledgeIndexJob{}, false
	}
	return job, true
}

func (repository *PostgresKnowledgeRepository) CancelJob(fileID int64, versionNo int) bool {
	if fileID <= 0 || versionNo <= 0 {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := repository.db.ExecContext(ctx, `
UPDATE knowledge_index_job
SET status = $3, error_message = '', finished_at = NOW(), updated_at = NOW()
WHERE file_id = $1 AND version_no = $2 AND status IN ($4, $5)
`, fileID, versionNo, model.KnowledgeIndexJobStatusCancelled, model.KnowledgeIndexJobStatusPending, model.KnowledgeIndexJobStatusRunning)
	if err != nil {
		return false
	}
	affected, _ := result.RowsAffected()
	if affected > 0 {
		return true
	}
	existsResult, existsErr := repository.db.ExecContext(ctx, `
UPDATE knowledge_index_job
SET updated_at = updated_at
WHERE file_id = $1 AND version_no = $2
`, fileID, versionNo)
	if existsErr != nil {
		return false
	}
	existsAffected, _ := existsResult.RowsAffected()
	return existsAffected > 0
}

func (repository *PostgresKnowledgeRepository) ClaimNextJob(maxRetry int) (model.KnowledgeIndexJob, bool) {
	if maxRetry <= 0 {
		maxRetry = 3
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.KnowledgeIndexJob{}, false
	}
	defer func() { _ = tx.Rollback() }()

	var job model.KnowledgeIndexJob
	err = tx.QueryRowContext(ctx, `
WITH picked AS (
  SELECT id
  FROM knowledge_index_job
  WHERE status IN ($1, $2)
    AND retry_count < $3
  ORDER BY updated_at ASC, id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE knowledge_index_job j
SET status = $4, started_at = NOW(), updated_at = NOW()
FROM picked
WHERE j.id = picked.id
RETURNING j.id, j.file_id, j.version_no, j.status, j.retry_count, j.error_message, j.started_at, j.finished_at, j.created_at, j.updated_at
`,
		model.KnowledgeIndexJobStatusPending,
		model.KnowledgeIndexJobStatusFailed,
		maxRetry,
		model.KnowledgeIndexJobStatusRunning,
	).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.StartedAt, &job.FinishedAt, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.KnowledgeIndexJob{}, false
		}
		return model.KnowledgeIndexJob{}, false
	}
	if err := tx.Commit(); err != nil {
		return model.KnowledgeIndexJob{}, false
	}
	return job, true
}

func (repository *PostgresKnowledgeRepository) MarkJobSucceeded(jobID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := repository.db.ExecContext(ctx, `
UPDATE knowledge_index_job
SET status = $2, error_message = '', finished_at = NOW(), updated_at = NOW()
WHERE id = $1 AND status <> $3
`, jobID, model.KnowledgeIndexJobStatusSucceeded, model.KnowledgeIndexJobStatusCancelled)
	if err != nil {
		return false
	}
	affected, _ := result.RowsAffected()
	return affected > 0
}

func (repository *PostgresKnowledgeRepository) MarkJobFailed(jobID int64, errorMessage string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := repository.db.ExecContext(ctx, `
UPDATE knowledge_index_job
SET status = $2, retry_count = retry_count + 1, error_message = $3, finished_at = NOW(), updated_at = NOW()
WHERE id = $1 AND status <> $4
`, jobID, model.KnowledgeIndexJobStatusFailed, truncateText(strings.TrimSpace(errorMessage), 1000), model.KnowledgeIndexJobStatusCancelled)
	if err != nil {
		return false
	}
	affected, _ := result.RowsAffected()
	return affected > 0
}

func (repository *PostgresKnowledgeRepository) FindLatestJob(fileID int64, versionNo int) (model.KnowledgeIndexJob, bool) {
	if fileID <= 0 {
		return model.KnowledgeIndexJob{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	base := `
SELECT id, file_id, version_no, status, retry_count, error_message, started_at, finished_at, created_at, updated_at
FROM knowledge_index_job
WHERE file_id = $1
`
	args := []any{fileID}
	if versionNo > 0 {
		base += " AND version_no = $2 ORDER BY id DESC LIMIT 1"
		args = append(args, versionNo)
	} else {
		base += " ORDER BY version_no DESC, id DESC LIMIT 1"
	}

	var job model.KnowledgeIndexJob
	err := repository.db.QueryRowContext(ctx, base, args...).Scan(
		&job.ID, &job.FileID, &job.VersionNo, &job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.StartedAt, &job.FinishedAt, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return model.KnowledgeIndexJob{}, false
	}
	return job, true
}

func (repository *PostgresKnowledgeRepository) ListJobs(limit int) []model.KnowledgeIndexJob {
	if limit <= 0 {
		limit = 100
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, file_id, version_no, status, retry_count, error_message, started_at, finished_at, created_at, updated_at
FROM knowledge_index_job
ORDER BY updated_at DESC, id DESC
LIMIT $1
`, limit)
	if err != nil {
		return []model.KnowledgeIndexJob{}
	}
	defer rows.Close()

	out := make([]model.KnowledgeIndexJob, 0, limit)
	for rows.Next() {
		var item model.KnowledgeIndexJob
		if scanErr := rows.Scan(
			&item.ID,
			&item.FileID,
			&item.VersionNo,
			&item.Status,
			&item.RetryCount,
			&item.ErrorMessage,
			&item.StartedAt,
			&item.FinishedAt,
			&item.CreatedAt,
			&item.UpdatedAt,
		); scanErr != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func (repository *PostgresKnowledgeRepository) ReplaceChunks(fileID int64, versionNo int, modelName string, chunks []model.KnowledgeChunk) bool {
	if fileID <= 0 || versionNo <= 0 {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return false
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
DELETE FROM knowledge_embedding
WHERE chunk_id IN (
  SELECT id FROM knowledge_chunk WHERE file_id = $1 AND version_no = $2
)
`, fileID, versionNo); err != nil {
		return false
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM knowledge_chunk
WHERE file_id = $1 AND version_no = $2
`, fileID, versionNo); err != nil {
		return false
	}

	for _, chunk := range chunks {
		if strings.TrimSpace(chunk.ChunkText) == "" || len(chunk.Embedding) == 0 {
			continue
		}
		var chunkID int64
		err := tx.QueryRowContext(ctx, `
INSERT INTO knowledge_chunk (
  file_id, version_no, biz_key, chunk_index, chunk_text, chunk_summary,
  source_type, page_start, page_end, source_ref, bbox_json, anchor_json, parse_strategy,
  content_hash, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13,
  $14, NOW(), NOW()
)
RETURNING id
`,
			fileID,
			versionNo,
			strings.TrimSpace(chunk.BizKey),
			chunk.ChunkIndex,
			chunk.ChunkText,
			chunk.ChunkSummary,
			chunk.SourceType,
			chunk.PageStart,
			chunk.PageEnd,
			chunk.SourceRef,
			normalizeBBoxJSON(chunk.BBoxJSON),
			normalizeAnchorJSON(chunk.AnchorJSON, chunk.Anchors),
			chunk.ParseStrategy,
			chunk.ContentHash,
		).Scan(&chunkID)
		if err != nil {
			return false
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO knowledge_embedding (chunk_id, model_name, embedding, created_at)
VALUES ($1, $2, $3::vector, NOW())
ON CONFLICT (chunk_id, model_name) DO UPDATE SET
  embedding = EXCLUDED.embedding,
  created_at = NOW()
`, chunkID, strings.TrimSpace(modelName), toVectorLiteral(chunk.Embedding)); err != nil {
			return false
		}
	}
	if err := tx.Commit(); err != nil {
		return false
	}
	return true
}

func (repository *PostgresKnowledgeRepository) Search(modelName string, queryVector []float64, filter KnowledgeSearchFilter) []model.KnowledgeSearchHitDTO {
	if strings.TrimSpace(modelName) == "" || len(queryVector) == 0 {
		return nil
	}
	topK := filter.TopK
	if topK <= 0 {
		topK = 8
	}
	if topK > 50 {
		topK = 50
	}
	minScore := filter.MinScore
	if minScore <= 0 {
		minScore = 0.2
	}
	if minScore > 1 {
		minScore = 1
	}

	builder := strings.Builder{}
	builder.WriteString(`
SELECT
  c.file_id, c.version_no, c.chunk_index, c.chunk_text, c.chunk_summary,
  c.source_type, c.page_start, c.page_end, c.source_ref, c.bbox_json, c.anchor_json,
  (1 - (e.embedding <=> $1::vector)) AS score
FROM knowledge_embedding e
JOIN knowledge_chunk c ON c.id = e.chunk_id
WHERE e.model_name = $2
`)
	args := []any{toVectorLiteral(queryVector), strings.TrimSpace(modelName)}
	argIndex := 3
	if strings.TrimSpace(filter.BizKey) != "" {
		builder.WriteString(fmt.Sprintf(" AND c.biz_key = $%d", argIndex))
		args = append(args, strings.TrimSpace(filter.BizKey))
		argIndex++
	}
	if len(filter.BizKeyPrefixes) > 0 {
		conditions := make([]string, 0, len(filter.BizKeyPrefixes))
		for _, prefix := range filter.BizKeyPrefixes {
			trimmed := strings.TrimSpace(prefix)
			if trimmed == "" {
				continue
			}
			conditions = append(conditions, fmt.Sprintf("c.biz_key LIKE $%d", argIndex))
			args = append(args, trimmed+"%")
			argIndex++
		}
		if len(conditions) > 0 {
			builder.WriteString(" AND (" + strings.Join(conditions, " OR ") + ")")
		}
	}
	if len(filter.FileIDs) > 0 {
		holders := make([]string, 0, len(filter.FileIDs))
		for _, fileID := range filter.FileIDs {
			if fileID <= 0 {
				continue
			}
			holders = append(holders, fmt.Sprintf("$%d", argIndex))
			args = append(args, fileID)
			argIndex++
		}
		if len(holders) > 0 {
			builder.WriteString(" AND c.file_id IN (" + strings.Join(holders, ",") + ")")
		}
	}
	builder.WriteString(fmt.Sprintf(" AND (1 - (e.embedding <=> $1::vector)) >= $%d", argIndex))
	args = append(args, minScore)
	argIndex++
	builder.WriteString(fmt.Sprintf(" ORDER BY e.embedding <=> $1::vector ASC LIMIT $%d", argIndex))
	args = append(args, topK)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	rows, err := repository.db.QueryContext(ctx, builder.String(), args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]model.KnowledgeSearchHitDTO, 0, topK)
	for rows.Next() {
		var item model.KnowledgeSearchHitDTO
		var anchorsRaw []byte
		if err := rows.Scan(
			&item.FileID,
			&item.VersionNo,
			&item.ChunkIndex,
			&item.ChunkText,
			&item.ChunkSummary,
			&item.SourceType,
			&item.PageStart,
			&item.PageEnd,
			&item.SourceRef,
			&item.BBox,
			&anchorsRaw,
			&item.Score,
		); err != nil {
			continue
		}
		item.Anchors = decodeAnchors(anchorsRaw)
		out = append(out, item)
	}
	return out
}

func normalizeBBoxJSON(raw []byte) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return "null"
	}
	var js any
	if err := json.Unmarshal([]byte(trimmed), &js); err != nil {
		return "null"
	}
	return trimmed
}

func normalizeAnchorJSON(raw []byte, anchors []model.KnowledgeChunkAnchor) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" && len(anchors) > 0 {
		marshaled, err := json.Marshal(anchors)
		if err != nil {
			return "[]"
		}
		trimmed = string(marshaled)
	}
	if trimmed == "" {
		return "[]"
	}
	var js any
	if err := json.Unmarshal([]byte(trimmed), &js); err != nil {
		return "[]"
	}
	return trimmed
}

func decodeAnchors(raw []byte) []model.KnowledgeChunkAnchor {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return []model.KnowledgeChunkAnchor{}
	}
	anchors := make([]model.KnowledgeChunkAnchor, 0)
	if err := json.Unmarshal([]byte(trimmed), &anchors); err != nil {
		return []model.KnowledgeChunkAnchor{}
	}
	return anchors
}

func toVectorLiteral(values []float64) string {
	if len(values) == 0 {
		return "[]"
	}
	builder := strings.Builder{}
	builder.WriteString("[")
	for index, value := range values {
		if index > 0 {
			builder.WriteString(",")
		}
		builder.WriteString(fmt.Sprintf("%.8f", value))
	}
	builder.WriteString("]")
	return builder.String()
}

func truncateText(value string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maxLen {
		return value
	}
	return string(runes[:maxLen])
}
