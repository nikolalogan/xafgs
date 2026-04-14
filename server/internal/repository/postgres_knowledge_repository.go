package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
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
WHERE id = $1
`, jobID, model.KnowledgeIndexJobStatusSucceeded)
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
WHERE id = $1
`, jobID, model.KnowledgeIndexJobStatusFailed, truncateText(strings.TrimSpace(errorMessage), 1000))
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
  source_type, page_start, page_end, source_ref, bbox_json, parse_strategy,
  content_hash, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10, $11::jsonb, $12,
  $13, NOW(), NOW()
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

func (repository *PostgresKnowledgeRepository) Search(modelName string, queryText string, queryVector []float64, filter KnowledgeSearchFilter) []model.KnowledgeSearchHitDTO {
	if strings.TrimSpace(modelName) == "" || strings.TrimSpace(queryText) == "" || len(queryVector) == 0 {
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
	semanticLimit := topK * 3
	if semanticLimit > 120 {
		semanticLimit = 120
	}
	keywordLimit := topK * 3
	if keywordLimit > 120 {
		keywordLimit = 120
	}

	type candidate struct {
		hit          model.KnowledgeSearchHitDTO
		semanticRank int
		keywordRank  int
	}
	candidates := map[string]*candidate{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	semanticHits := repository.searchSemantic(ctx, strings.TrimSpace(modelName), queryVector, minScore, semanticLimit, filter)
	for index, hit := range semanticHits {
		key := buildChunkKey(hit.FileID, hit.VersionNo, hit.ChunkIndex)
		item, exists := candidates[key]
		if !exists {
			item = &candidate{hit: hit}
			candidates[key] = item
		}
		item.semanticRank = index + 1
		item.hit.SemanticScore = hit.SemanticScore
	}

	keywordHits := repository.searchKeyword(ctx, strings.TrimSpace(queryText), keywordLimit, filter)
	for index, hit := range keywordHits {
		key := buildChunkKey(hit.FileID, hit.VersionNo, hit.ChunkIndex)
		item, exists := candidates[key]
		if !exists {
			item = &candidate{hit: hit}
			candidates[key] = item
		}
		item.keywordRank = index + 1
		item.hit.KeywordScore = hit.KeywordScore
		if strings.TrimSpace(item.hit.ChunkText) == "" {
			item.hit.ChunkText = hit.ChunkText
		}
		if strings.TrimSpace(item.hit.ChunkSummary) == "" {
			item.hit.ChunkSummary = hit.ChunkSummary
		}
		if strings.TrimSpace(item.hit.SourceRef) == "" {
			item.hit.SourceRef = hit.SourceRef
		}
		if len(item.hit.BBox) == 0 {
			item.hit.BBox = hit.BBox
		}
		if strings.TrimSpace(item.hit.SourceType) == "" {
			item.hit.SourceType = hit.SourceType
		}
		if item.hit.PageStart == 0 {
			item.hit.PageStart = hit.PageStart
		}
		if item.hit.PageEnd == 0 {
			item.hit.PageEnd = hit.PageEnd
		}
	}

	const rrfK = 60.0
	out := make([]model.KnowledgeSearchHitDTO, 0, len(candidates))
	for _, item := range candidates {
		final := 0.0
		if item.semanticRank > 0 {
			final += 1.0 / (rrfK + float64(item.semanticRank))
		}
		if item.keywordRank > 0 {
			final += 1.0 / (rrfK + float64(item.keywordRank))
		}
		item.hit.FinalScore = final
		item.hit.Score = final
		switch {
		case item.semanticRank > 0 && item.keywordRank > 0:
			item.hit.RetrievalType = "hybrid"
		case item.semanticRank > 0:
			item.hit.RetrievalType = "semantic"
		case item.keywordRank > 0:
			item.hit.RetrievalType = "keyword"
		default:
			item.hit.RetrievalType = "unknown"
		}
		out = append(out, item.hit)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].FinalScore != out[j].FinalScore {
			return out[i].FinalScore > out[j].FinalScore
		}
		if out[i].SemanticScore != out[j].SemanticScore {
			return out[i].SemanticScore > out[j].SemanticScore
		}
		return out[i].KeywordScore > out[j].KeywordScore
	})
	if len(out) > topK {
		out = out[:topK]
	}
	return out
}

func (repository *PostgresKnowledgeRepository) searchSemantic(ctx context.Context, modelName string, queryVector []float64, minScore float64, limit int, filter KnowledgeSearchFilter) []model.KnowledgeSearchHitDTO {
	builder := strings.Builder{}
	builder.WriteString(`
SELECT
  c.file_id, c.version_no, c.chunk_index, c.chunk_text, c.chunk_summary,
  c.source_type, c.page_start, c.page_end, c.source_ref, c.bbox_json,
  (1 - (e.embedding <=> $1::vector)) AS semantic_score
FROM knowledge_embedding e
JOIN knowledge_chunk c ON c.id = e.chunk_id
WHERE e.model_name = $2
`)
	args := []any{toVectorLiteral(queryVector), modelName}
	argIndex := 3
	builder, args, argIndex = appendChunkFilters(builder, args, argIndex, filter)
	builder.WriteString(fmt.Sprintf(" AND (1 - (e.embedding <=> $1::vector)) >= $%d", argIndex))
	args = append(args, minScore)
	argIndex++
	builder.WriteString(fmt.Sprintf(" ORDER BY e.embedding <=> $1::vector ASC LIMIT $%d", argIndex))
	args = append(args, limit)

	rows, err := repository.db.QueryContext(ctx, builder.String(), args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]model.KnowledgeSearchHitDTO, 0, limit)
	for rows.Next() {
		var item model.KnowledgeSearchHitDTO
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
			&item.SemanticScore,
		); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func (repository *PostgresKnowledgeRepository) searchKeyword(ctx context.Context, queryText string, limit int, filter KnowledgeSearchFilter) []model.KnowledgeSearchHitDTO {
	builder := strings.Builder{}
	builder.WriteString(`
SELECT
  c.file_id, c.version_no, c.chunk_index, c.chunk_text, c.chunk_summary,
  c.source_type, c.page_start, c.page_end, c.source_ref, c.bbox_json,
  (
    ts_rank_cd(to_tsvector('simple', coalesce(c.chunk_text, '')), plainto_tsquery('simple', $1)) * 0.7
    + similarity(c.chunk_text, $1) * 0.3
  ) AS keyword_score
FROM knowledge_chunk c
WHERE (
  to_tsvector('simple', coalesce(c.chunk_text, '')) @@ plainto_tsquery('simple', $1)
  OR similarity(c.chunk_text, $1) >= 0.12
)
`)
	args := []any{queryText}
	argIndex := 2
	builder, args, argIndex = appendChunkFilters(builder, args, argIndex, filter)
	builder.WriteString(fmt.Sprintf(" ORDER BY keyword_score DESC LIMIT $%d", argIndex))
	args = append(args, limit)

	rows, err := repository.db.QueryContext(ctx, builder.String(), args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]model.KnowledgeSearchHitDTO, 0, limit)
	for rows.Next() {
		var item model.KnowledgeSearchHitDTO
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
			&item.KeywordScore,
		); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func appendChunkFilters(builder strings.Builder, args []any, argIndex int, filter KnowledgeSearchFilter) (strings.Builder, []any, int) {
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
	return builder, args, argIndex
}

func buildChunkKey(fileID int64, versionNo int, chunkIndex int) string {
	return fmt.Sprintf("%d:%d:%d", fileID, versionNo, chunkIndex)
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
