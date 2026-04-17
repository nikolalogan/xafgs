package repository

import (
	"context"
	"database/sql"
	"sort"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresResourceShareRepository struct {
	db *sql.DB
}

func NewPostgresResourceShareRepository(db *sql.DB) ResourceShareRepository {
	return &PostgresResourceShareRepository{db: db}
}

func (repository *PostgresResourceShareRepository) FindByResource(resourceType string, resourceID int64) []model.ResourceShare {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := repository.db.QueryContext(ctx, `
SELECT id, resource_type, resource_id, target_user_id, permission, created_at, updated_at, created_by, updated_by
FROM resource_share
WHERE resource_type = $1 AND resource_id = $2
ORDER BY target_user_id ASC
`, resourceType, resourceID)
	if err != nil {
		return []model.ResourceShare{}
	}
	defer rows.Close()
	out := make([]model.ResourceShare, 0)
	for rows.Next() {
		var item model.ResourceShare
		if scanErr := rows.Scan(
			&item.ID,
			&item.ResourceType,
			&item.ResourceID,
			&item.TargetUserID,
			&item.Permission,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.CreatedBy,
			&item.UpdatedBy,
		); scanErr == nil {
			out = append(out, item)
		}
	}
	return out
}

func (repository *PostgresResourceShareRepository) FindByUser(resourceType string, userID int64) []model.ResourceShare {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := repository.db.QueryContext(ctx, `
SELECT id, resource_type, resource_id, target_user_id, permission, created_at, updated_at, created_by, updated_by
FROM resource_share
WHERE resource_type = $1 AND target_user_id = $2
ORDER BY resource_id ASC
`, resourceType, userID)
	if err != nil {
		return []model.ResourceShare{}
	}
	defer rows.Close()
	out := make([]model.ResourceShare, 0)
	for rows.Next() {
		var item model.ResourceShare
		if scanErr := rows.Scan(
			&item.ID,
			&item.ResourceType,
			&item.ResourceID,
			&item.TargetUserID,
			&item.Permission,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.CreatedBy,
			&item.UpdatedBy,
		); scanErr == nil {
			out = append(out, item)
		}
	}
	return out
}

func (repository *PostgresResourceShareRepository) HasResourceAccess(resourceType string, resourceID int64, userID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var exists bool
	err := repository.db.QueryRowContext(ctx, `
SELECT EXISTS(
  SELECT 1 FROM resource_share
  WHERE resource_type = $1 AND resource_id = $2 AND target_user_id = $3
)
`, resourceType, resourceID, userID).Scan(&exists)
	return err == nil && exists
}

func (repository *PostgresResourceShareRepository) ReplaceResourceShares(resourceType string, resourceID int64, userIDs []int64, operatorID int64) []model.ResourceShare {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return []model.ResourceShare{}
	}
	defer func() { _ = tx.Rollback() }()

	if _, err = tx.ExecContext(ctx, `DELETE FROM resource_share WHERE resource_type = $1 AND resource_id = $2`, resourceType, resourceID); err != nil {
		return []model.ResourceShare{}
	}
	now := time.Now().UTC()
	unique := map[int64]struct{}{}
	out := make([]model.ResourceShare, 0, len(userIDs))
	for _, userID := range userIDs {
		if userID <= 0 {
			continue
		}
		if _, exists := unique[userID]; exists {
			continue
		}
		unique[userID] = struct{}{}
		var id int64
		if err = tx.QueryRowContext(ctx, `
INSERT INTO resource_share (
  resource_type, resource_id, target_user_id, permission,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4,
  $5, $5, $6, $6
)
RETURNING id
`, resourceType, resourceID, userID, model.ResourcePermissionEdit, now, operatorID).Scan(&id); err != nil {
			return []model.ResourceShare{}
		}
		out = append(out, model.ResourceShare{
			BaseEntity: model.BaseEntity{
				ID:        id,
				CreatedAt: now,
				UpdatedAt: now,
				CreatedBy: operatorID,
				UpdatedBy: operatorID,
			},
			ResourceType: resourceType,
			ResourceID:   resourceID,
			TargetUserID: userID,
			Permission:   model.ResourcePermissionEdit,
		})
	}
	if err = tx.Commit(); err != nil {
		return []model.ResourceShare{}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TargetUserID < out[j].TargetUserID })
	return out
}
