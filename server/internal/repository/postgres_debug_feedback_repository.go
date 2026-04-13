package repository

import (
	"context"
	"database/sql"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresDebugFeedbackRepository struct {
	db *sql.DB
}

func NewPostgresDebugFeedbackRepository(db *sql.DB) DebugFeedbackRepository {
	return &PostgresDebugFeedbackRepository{db: db}
}

func (repository *PostgresDebugFeedbackRepository) CreateFeedback(feedback model.DebugFeedback, attachments []model.DebugFeedbackAttachment) (model.DebugFeedback, []model.DebugFeedbackAttachment, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.DebugFeedback{}, nil, false
	}
	defer tx.Rollback()

	var created model.DebugFeedback
	err = tx.QueryRowContext(ctx, `
INSERT INTO debug_feedback (
  title, type, description, status, submitter_id, completed_at, completed_by_user_id,
  created_at, updated_at, created_by, updated_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8, $8)
RETURNING id, title, type, description, status, submitter_id, completed_at, completed_by_user_id, created_at, updated_at, created_by, updated_by
`, feedback.Title, feedback.Type, feedback.Description, feedback.Status, feedback.SubmitterID, feedback.CompletedAt, feedback.CompletedByUserID, feedback.CreatedBy).Scan(
		&created.ID,
		&created.Title,
		&created.Type,
		&created.Description,
		&created.Status,
		&created.SubmitterID,
		&created.CompletedAt,
		&created.CompletedByUserID,
		&created.CreatedAt,
		&created.UpdatedAt,
		&created.CreatedBy,
		&created.UpdatedBy,
	)
	if err != nil {
		return model.DebugFeedback{}, nil, false
	}

	createdAttachments := make([]model.DebugFeedbackAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		var createdAttachment model.DebugFeedbackAttachment
		err = tx.QueryRowContext(ctx, `
INSERT INTO debug_feedback_attachment (feedback_id, file_id, version_no)
VALUES ($1, $2, $3)
RETURNING id, feedback_id, file_id, version_no
`, created.ID, attachment.FileID, attachment.VersionNo).Scan(
			&createdAttachment.ID,
			&createdAttachment.FeedbackID,
			&createdAttachment.FileID,
			&createdAttachment.VersionNo,
		)
		if err != nil {
			return model.DebugFeedback{}, nil, false
		}
		createdAttachments = append(createdAttachments, createdAttachment)
	}

	if err := tx.Commit(); err != nil {
		return model.DebugFeedback{}, nil, false
	}
	return created, createdAttachments, true
}

func (repository *PostgresDebugFeedbackRepository) ListFeedbacks() []model.DebugFeedback {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, title, type, description, status, submitter_id, completed_at, completed_by_user_id, created_at, updated_at, created_by, updated_by
FROM debug_feedback
ORDER BY created_at DESC, id DESC
`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]model.DebugFeedback, 0)
	for rows.Next() {
		var item model.DebugFeedback
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Type,
			&item.Description,
			&item.Status,
			&item.SubmitterID,
			&item.CompletedAt,
			&item.CompletedByUserID,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.CreatedBy,
			&item.UpdatedBy,
		); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func (repository *PostgresDebugFeedbackRepository) FindFeedbackByID(feedbackID int64) (model.DebugFeedback, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var item model.DebugFeedback
	err := repository.db.QueryRowContext(ctx, `
SELECT id, title, type, description, status, submitter_id, completed_at, completed_by_user_id, created_at, updated_at, created_by, updated_by
FROM debug_feedback
WHERE id = $1
`, feedbackID).Scan(
		&item.ID,
		&item.Title,
		&item.Type,
		&item.Description,
		&item.Status,
		&item.SubmitterID,
		&item.CompletedAt,
		&item.CompletedByUserID,
		&item.CreatedAt,
		&item.UpdatedAt,
		&item.CreatedBy,
		&item.UpdatedBy,
	)
	if err != nil {
		return model.DebugFeedback{}, false
	}
	return item, true
}

func (repository *PostgresDebugFeedbackRepository) ListAttachmentsByFeedbackID(feedbackID int64) []model.DebugFeedbackAttachment {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, feedback_id, file_id, version_no
FROM debug_feedback_attachment
WHERE feedback_id = $1
ORDER BY id ASC
`, feedbackID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]model.DebugFeedbackAttachment, 0)
	for rows.Next() {
		var item model.DebugFeedbackAttachment
		if err := rows.Scan(&item.ID, &item.FeedbackID, &item.FileID, &item.VersionNo); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func (repository *PostgresDebugFeedbackRepository) FindAttachmentByID(attachmentID int64) (model.DebugFeedbackAttachment, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var item model.DebugFeedbackAttachment
	err := repository.db.QueryRowContext(ctx, `
SELECT id, feedback_id, file_id, version_no
FROM debug_feedback_attachment
WHERE id = $1
`, attachmentID).Scan(&item.ID, &item.FeedbackID, &item.FileID, &item.VersionNo)
	if err != nil {
		return model.DebugFeedbackAttachment{}, false
	}
	return item, true
}

func (repository *PostgresDebugFeedbackRepository) CompleteFeedback(feedbackID int64, completedByUserID int64) (model.DebugFeedback, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var item model.DebugFeedback
	err := repository.db.QueryRowContext(ctx, `
UPDATE debug_feedback
SET status = CASE WHEN status = 'done' THEN status ELSE 'done' END,
    completed_at = CASE WHEN status = 'done' THEN completed_at ELSE NOW() END,
    completed_by_user_id = CASE WHEN status = 'done' THEN completed_by_user_id ELSE $2 END,
    updated_at = NOW(),
    updated_by = $2
WHERE id = $1
RETURNING id, title, type, description, status, submitter_id, completed_at, completed_by_user_id, created_at, updated_at, created_by, updated_by
`, feedbackID, completedByUserID).Scan(
		&item.ID,
		&item.Title,
		&item.Type,
		&item.Description,
		&item.Status,
		&item.SubmitterID,
		&item.CompletedAt,
		&item.CompletedByUserID,
		&item.CreatedAt,
		&item.UpdatedAt,
		&item.CreatedBy,
		&item.UpdatedBy,
	)
	if err != nil {
		return model.DebugFeedback{}, false
	}
	return item, true
}
