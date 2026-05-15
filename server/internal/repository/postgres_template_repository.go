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

type PostgresTemplateRepository struct {
	db *sql.DB
}

func NewPostgresTemplateRepository(db *sql.DB) TemplateRepository {
	return &PostgresTemplateRepository{db: db}
}

func (repository *PostgresTemplateRepository) FindByID(templateID int64) (model.TemplateDTO, bool) {
	entity, ok := repository.FindEntityByID(templateID)
	if !ok {
		return model.TemplateDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *PostgresTemplateRepository) FindEntityByID(templateID int64) (model.Template, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var template model.Template
	var defaultContextJSONBytes []byte
	err := repository.db.QueryRowContext(ctx, `
SELECT
  id, template_key, name, description, engine, output_type, status,
  content, default_context_json, template_type, preprocess_js,
  created_at, updated_at, created_by, updated_by
FROM template
WHERE id = $1
`, templateID).Scan(
		&template.ID,
		&template.TemplateKey,
		&template.Name,
		&template.Description,
		&template.Engine,
		&template.OutputType,
		&template.Status,
		&template.Content,
		&defaultContextJSONBytes,
		&template.TemplateType,
		&template.PreprocessJS,
		&template.CreatedAt,
		&template.UpdatedAt,
		&template.CreatedBy,
		&template.UpdatedBy,
	)
	if err != nil {
		return model.Template{}, false
	}
	if len(defaultContextJSONBytes) == 0 {
		template.DefaultContextJSON = json.RawMessage(`{}`)
	} else {
		template.DefaultContextJSON = json.RawMessage(defaultContextJSONBytes)
	}
	if strings.TrimSpace(template.TemplateType) == "" {
		template.TemplateType = model.TemplateTypeGonja
	}
	return template, true
}

func (repository *PostgresTemplateRepository) FindByTemplateKey(templateKey string) (model.Template, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(templateKey)
	if trimmed == "" {
		return model.Template{}, false
	}

	var template model.Template
	var defaultContextJSONBytes []byte
	err := repository.db.QueryRowContext(ctx, `
SELECT
  id, template_key, name, description, engine, output_type, status,
  content, default_context_json, template_type, preprocess_js,
  created_at, updated_at, created_by, updated_by
FROM template
WHERE template_key = $1
`, trimmed).Scan(
		&template.ID,
		&template.TemplateKey,
		&template.Name,
		&template.Description,
		&template.Engine,
		&template.OutputType,
		&template.Status,
		&template.Content,
		&defaultContextJSONBytes,
		&template.TemplateType,
		&template.PreprocessJS,
		&template.CreatedAt,
		&template.UpdatedAt,
		&template.CreatedBy,
		&template.UpdatedBy,
	)
	if err != nil {
		return model.Template{}, false
	}
	if len(defaultContextJSONBytes) == 0 {
		template.DefaultContextJSON = json.RawMessage(`{}`)
	} else {
		template.DefaultContextJSON = json.RawMessage(defaultContextJSONBytes)
	}
	if strings.TrimSpace(template.TemplateType) == "" {
		template.TemplateType = model.TemplateTypeGonja
	}
	return template, true
}

func (repository *PostgresTemplateRepository) FindAll() []model.TemplateDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, template_key, name, description, engine, output_type, status, template_type, created_at, updated_at
FROM template
ORDER BY id ASC
`)
	if err != nil {
		return []model.TemplateDTO{}
	}
	defer rows.Close()

	templates := make([]model.TemplateDTO, 0)
	for rows.Next() {
		var dto model.TemplateDTO
		if err := rows.Scan(
			&dto.ID,
			&dto.TemplateKey,
			&dto.Name,
			&dto.Description,
			&dto.Engine,
			&dto.OutputType,
			&dto.Status,
			&dto.TemplateType,
			&dto.CreatedAt,
			&dto.UpdatedAt,
		); err != nil {
			continue
		}
		if strings.TrimSpace(dto.TemplateType) == "" {
			dto.TemplateType = model.TemplateTypeGonja
		}
		templates = append(templates, dto)
	}

	sort.Slice(templates, func(i, j int) bool { return templates[i].ID < templates[j].ID })
	return templates
}

func (repository *PostgresTemplateRepository) Create(template model.Template) model.TemplateDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	template.CreatedAt = now
	template.UpdatedAt = now

	defaultContext := template.DefaultContextJSON
	if len(defaultContext) == 0 {
		defaultContext = json.RawMessage(`{}`)
	}
	if strings.TrimSpace(template.TemplateType) == "" {
		template.TemplateType = model.TemplateTypeGonja
	}

	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO template (
  template_key, name, description, engine, output_type, status,
  content, default_context_json, template_type, preprocess_js,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8::jsonb, $9, $10,
  $11, $11, $12, $12
)
RETURNING id
`, template.TemplateKey, template.Name, template.Description, template.Engine, template.OutputType, template.Status, template.Content, string(defaultContext), template.TemplateType, template.PreprocessJS, now, template.CreatedBy).Scan(&template.ID)

	return template.ToDTO()
}

func (repository *PostgresTemplateRepository) Update(templateID int64, update model.Template) (model.TemplateDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	defaultContext := update.DefaultContextJSON
	if len(defaultContext) == 0 {
		defaultContext = json.RawMessage(`{}`)
	}
	if strings.TrimSpace(update.TemplateType) == "" {
		update.TemplateType = model.TemplateTypeGonja
	}

	_, err := repository.db.ExecContext(ctx, `
UPDATE template
SET
  name = $2,
  description = $3,
  output_type = $4,
  status = $5,
  content = $6,
  default_context_json = $7::jsonb,
  template_type = $8,
  preprocess_js = $9,
  updated_at = $10,
  updated_by = $11
WHERE id = $1
`, templateID, update.Name, update.Description, update.OutputType, update.Status, update.Content, string(defaultContext), update.TemplateType, update.PreprocessJS, now, update.UpdatedBy)
	if err != nil {
		return model.TemplateDTO{}, false
	}

	dto, ok := repository.FindByID(templateID)
	return dto, ok
}

func (repository *PostgresTemplateRepository) Delete(templateID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := repository.db.ExecContext(ctx, `DELETE FROM template WHERE id = $1`, templateID)
	return err == nil
}

