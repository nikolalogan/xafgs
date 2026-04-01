package repository

import (
	"context"
	"database/sql"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresUserConfigRepository struct {
	db *sql.DB
}

func NewPostgresUserConfigRepository(db *sql.DB) UserConfigRepository {
	return &PostgresUserConfigRepository{db: db}
}

func (repository *PostgresUserConfigRepository) FindByUserID(userID int64) (model.UserConfigDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var entity model.UserConfig
	err := repository.db.QueryRowContext(ctx, `
SELECT user_id, warning_account, warning_password, ai_base_url, ai_api_key, created_at, updated_at, created_by, updated_by
FROM user_config
WHERE user_id = $1
`, userID).Scan(
		&entity.UserID,
		&entity.WarningAccount,
		&entity.WarningPassword,
		&entity.AIBaseURL,
		&entity.AIApiKey,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.UserConfigDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *PostgresUserConfigRepository) Upsert(config model.UserConfig) (model.UserConfigDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	config.UpdatedAt = now
	if config.CreatedAt.IsZero() {
		config.CreatedAt = now
	}

	_, err := repository.db.ExecContext(ctx, `
INSERT INTO user_config (user_id, warning_account, warning_password, ai_base_url, ai_api_key, created_at, updated_at, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)
ON CONFLICT (user_id) DO UPDATE SET
  warning_account = EXCLUDED.warning_account,
  warning_password = EXCLUDED.warning_password,
  ai_base_url = EXCLUDED.ai_base_url,
  ai_api_key = EXCLUDED.ai_api_key,
  updated_at = EXCLUDED.updated_at,
  updated_by = EXCLUDED.updated_by
`, config.UserID, config.WarningAccount, config.WarningPassword, config.AIBaseURL, config.AIApiKey, now, config.UpdatedBy)
	if err != nil {
		return model.UserConfigDTO{}, false
	}

	dto, ok := repository.FindByUserID(config.UserID)
	return dto, ok
}

