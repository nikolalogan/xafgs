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

type PostgresWorkflowRepository struct {
	db *sql.DB
}

func NewPostgresWorkflowRepository(db *sql.DB) WorkflowRepository {
	return &PostgresWorkflowRepository{db: db}
}

func (repository *PostgresWorkflowRepository) FindByID(workflowID int64) (model.Workflow, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var workflow model.Workflow
	var dslBytes []byte
	err := repository.db.QueryRowContext(ctx, `
SELECT id, workflow_key, name, description, menu_key, status,
       current_draft_version_no, current_published_version_no,
       dsl_json, created_at, updated_at, created_by, updated_by
FROM workflow
WHERE id = $1
`, workflowID).Scan(
		&workflow.ID,
		&workflow.WorkflowKey,
		&workflow.Name,
		&workflow.Description,
		&workflow.MenuKey,
		&workflow.Status,
		&workflow.CurrentDraftVersionNo,
		&workflow.CurrentPublishedVersionNo,
		&dslBytes,
		&workflow.CreatedAt,
		&workflow.UpdatedAt,
		&workflow.CreatedBy,
		&workflow.UpdatedBy,
	)
	if err != nil {
		return model.Workflow{}, false
	}
	workflow.DSL = json.RawMessage(dslBytes)
	return workflow, true
}

func (repository *PostgresWorkflowRepository) FindByWorkflowKey(workflowKey string) (model.Workflow, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(workflowKey)
	if trimmed == "" {
		return model.Workflow{}, false
	}

	var workflow model.Workflow
	var dslBytes []byte
	err := repository.db.QueryRowContext(ctx, `
SELECT id, workflow_key, name, description, menu_key, status,
       current_draft_version_no, current_published_version_no,
       dsl_json, created_at, updated_at, created_by, updated_by
FROM workflow
WHERE workflow_key = $1
`, trimmed).Scan(
		&workflow.ID,
		&workflow.WorkflowKey,
		&workflow.Name,
		&workflow.Description,
		&workflow.MenuKey,
		&workflow.Status,
		&workflow.CurrentDraftVersionNo,
		&workflow.CurrentPublishedVersionNo,
		&dslBytes,
		&workflow.CreatedAt,
		&workflow.UpdatedAt,
		&workflow.CreatedBy,
		&workflow.UpdatedBy,
	)
	if err != nil {
		return model.Workflow{}, false
	}
	workflow.DSL = json.RawMessage(dslBytes)
	return workflow, true
}

func (repository *PostgresWorkflowRepository) FindAll() []model.WorkflowDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, workflow_key, name, description, menu_key, status,
       current_draft_version_no, current_published_version_no,
       created_at, updated_at
FROM workflow
ORDER BY id ASC
`)
	if err != nil {
		return []model.WorkflowDTO{}
	}
	defer rows.Close()

	items := make([]model.WorkflowDTO, 0)
	for rows.Next() {
		var dto model.WorkflowDTO
		if err := rows.Scan(
			&dto.ID,
			&dto.WorkflowKey,
			&dto.Name,
			&dto.Description,
			&dto.MenuKey,
			&dto.Status,
			&dto.CurrentDraftVersionNo,
			&dto.CurrentPublishedVersionNo,
			&dto.CreatedAt,
			&dto.UpdatedAt,
		); err != nil {
			continue
		}
		items = append(items, dto)
	}

	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

func (repository *PostgresWorkflowRepository) FindVersions(workflowID int64) ([]model.WorkflowVersionDTO, bool) {
	workflow, ok := repository.FindByID(workflowID)
	if !ok {
		return nil, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT version_no, created_at
FROM workflow_version
WHERE workflow_id = $1
ORDER BY version_no ASC
`, workflowID)
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	versions := make([]model.WorkflowVersionDTO, 0)
	for rows.Next() {
		var versionNo int
		var createdAt time.Time
		if err := rows.Scan(&versionNo, &createdAt); err != nil {
			continue
		}
		versions = append(versions, model.WorkflowVersionDTO{
			VersionNo:   versionNo,
			CreatedAt:   createdAt,
			IsDraft:     versionNo == workflow.CurrentDraftVersionNo,
			IsPublished: versionNo == workflow.CurrentPublishedVersionNo,
		})
	}

	return versions, true
}

func (repository *PostgresWorkflowRepository) Create(workflow model.Workflow) model.WorkflowDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	now := time.Now().UTC()
	workflow.CreatedAt = now
	workflow.UpdatedAt = now
	workflow.CurrentDraftVersionNo = 1
	workflow.CurrentPublishedVersionNo = 0
	if len(workflow.DSL) == 0 {
		workflow.DSL = json.RawMessage(`{"nodes":[{"id":"start","type":"custom","position":{"x":80,"y":200},"data":{"title":"开始","type":"start","config":{"variables":[]}}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`)
	}

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.WorkflowDTO{}
	}
	defer func() { _ = tx.Rollback() }()

	if err := tx.QueryRowContext(ctx, `
INSERT INTO workflow (
  workflow_key, name, description, menu_key, status,
  current_draft_version_no, current_published_version_no,
  dsl_json, created_at, updated_at, created_by, updated_by
) VALUES ($1, $2, $3, $4, $5, 1, 0, $6::jsonb, $7, $7, $8, $8)
RETURNING id
`, workflow.WorkflowKey, workflow.Name, workflow.Description, workflow.MenuKey, workflow.Status, string(workflow.DSL), now, workflow.CreatedBy).Scan(&workflow.ID); err != nil {
		return model.WorkflowDTO{}
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO workflow_version (workflow_id, version_no, dsl_json, created_at, updated_at)
VALUES ($1, 1, $2::jsonb, $3, $3)
`, workflow.ID, string(workflow.DSL), now); err != nil {
		return model.WorkflowDTO{}
	}

	if err := tx.Commit(); err != nil {
		return model.WorkflowDTO{}
	}

	return workflow.ToDTO()
}

func (repository *PostgresWorkflowRepository) Update(workflowID int64, update model.Workflow) (model.WorkflowDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	existing, ok := repository.FindByID(workflowID)
	if !ok {
		return model.WorkflowDTO{}, false
	}

	now := time.Now().UTC()
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.WorkflowDTO{}, false
	}
	defer func() { _ = tx.Rollback() }()

	nextDraftNo := existing.CurrentDraftVersionNo
	nextDSL := existing.DSL
	if len(update.DSL) > 0 {
		nextDraftNo = existing.CurrentDraftVersionNo + 1
		nextDSL = update.DSL
		if _, err := tx.ExecContext(ctx, `
INSERT INTO workflow_version (workflow_id, version_no, dsl_json, created_at, updated_at)
VALUES ($1, $2, $3::jsonb, $4, $4)
`, workflowID, nextDraftNo, string(update.DSL), now); err != nil {
			return model.WorkflowDTO{}, false
		}
	}

	_, err = tx.ExecContext(ctx, `
UPDATE workflow
SET name = $2,
    description = $3,
    menu_key = $4,
    status = $5,
    current_draft_version_no = $6,
    dsl_json = $7::jsonb,
    updated_at = $8,
    updated_by = $9
WHERE id = $1
`, workflowID, update.Name, update.Description, update.MenuKey, update.Status, nextDraftNo, string(nextDSL), now, update.UpdatedBy)
	if err != nil {
		return model.WorkflowDTO{}, false
	}

	if err := tx.Commit(); err != nil {
		return model.WorkflowDTO{}, false
	}

	updated, ok := repository.FindByID(workflowID)
	if !ok {
		return model.WorkflowDTO{}, false
	}
	return updated.ToDTO(), true
}

func (repository *PostgresWorkflowRepository) Publish(workflowID int64) (model.WorkflowDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	workflow, ok := repository.FindByID(workflowID)
	if !ok {
		return model.WorkflowDTO{}, false
	}

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE workflow
SET current_published_version_no = current_draft_version_no, updated_at = $2
WHERE id = $1
`, workflowID, now)
	if err != nil {
		return model.WorkflowDTO{}, false
	}

	workflow.CurrentPublishedVersionNo = workflow.CurrentDraftVersionNo
	workflow.UpdatedAt = now
	return workflow.ToDTO(), true
}

func (repository *PostgresWorkflowRepository) Offline(workflowID int64) (model.WorkflowDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	workflow, ok := repository.FindByID(workflowID)
	if !ok {
		return model.WorkflowDTO{}, false
	}

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE workflow
SET current_published_version_no = 0, updated_at = $2
WHERE id = $1
`, workflowID, now)
	if err != nil {
		return model.WorkflowDTO{}, false
	}

	workflow.CurrentPublishedVersionNo = 0
	workflow.UpdatedAt = now
	return workflow.ToDTO(), true
}

func (repository *PostgresWorkflowRepository) Rollback(workflowID int64, versionNo int) (model.WorkflowDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var dslBytes []byte
	err := repository.db.QueryRowContext(ctx, `
SELECT dsl_json
FROM workflow_version
WHERE workflow_id = $1 AND version_no = $2
`, workflowID, versionNo).Scan(&dslBytes)
	if err != nil {
		return model.WorkflowDTO{}, false
	}

	now := time.Now().UTC()
	_, err = repository.db.ExecContext(ctx, `
UPDATE workflow
SET dsl_json = $3::jsonb,
    current_draft_version_no = $2,
    current_published_version_no = $2,
    updated_at = $4
WHERE id = $1
`, workflowID, versionNo, string(dslBytes), now)
	if err != nil {
		return model.WorkflowDTO{}, false
	}

	workflow, ok := repository.FindByID(workflowID)
	if !ok {
		return model.WorkflowDTO{}, false
	}
	return workflow.ToDTO(), true
}

func (repository *PostgresWorkflowRepository) Delete(workflowID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	_, err := repository.db.ExecContext(ctx, `DELETE FROM workflow WHERE id = $1`, workflowID)
	return err == nil
}
