package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresSystemConfigRepository struct {
	db *sql.DB
}

func NewPostgresSystemConfigRepository(db *sql.DB) SystemConfigRepository {
	return &PostgresSystemConfigRepository{db: db}
}

func (repository *PostgresSystemConfigRepository) Get() (model.SystemConfigDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var entity model.SystemConfig
	var modelsRaw []byte
	err := repository.db.QueryRowContext(ctx, `
SELECT id, models_json, default_model, code_default_model, search_service, created_at, updated_at, created_by, updated_by
FROM system_config
WHERE id = 1
`).Scan(
		&entity.ID,
		&modelsRaw,
		&entity.DefaultModel,
		&entity.CodeDefaultModel,
		&entity.SearchService,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.SystemConfigDTO{}, false
	}

	if len(modelsRaw) > 0 {
		if err := json.Unmarshal(modelsRaw, &entity.Models); err != nil {
			return model.SystemConfigDTO{}, false
		}
	}
	return entity.ToDTO(), true
}

func (repository *PostgresSystemConfigRepository) Upsert(config model.SystemConfig) (model.SystemConfigDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	modelsRaw, err := json.Marshal(config.Models)
	if err != nil {
		return model.SystemConfigDTO{}, false
	}

	now := time.Now().UTC()
	_, err = repository.db.ExecContext(ctx, `
INSERT INTO system_config (id, models_json, default_model, code_default_model, search_service, created_at, updated_at, created_by, updated_by)
VALUES (1, $1::jsonb, $2, $3, $4, $5, $5, $6, $6)
ON CONFLICT (id) DO UPDATE SET
  models_json = EXCLUDED.models_json,
  default_model = EXCLUDED.default_model,
  code_default_model = EXCLUDED.code_default_model,
  search_service = EXCLUDED.search_service,
  updated_at = EXCLUDED.updated_at,
  updated_by = EXCLUDED.updated_by
`, string(modelsRaw), config.DefaultModel, config.CodeDefaultModel, config.SearchService, now, config.UpdatedBy)
	if err != nil {
		return model.SystemConfigDTO{}, false
	}
	return repository.Get()
}
