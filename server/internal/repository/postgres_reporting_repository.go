package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresReportingRepository struct {
	ReportingRepository
	db *sql.DB
}

func NewPostgresReportingRepository(db *sql.DB) ReportingRepository {
	return &PostgresReportingRepository{
		ReportingRepository: NewReportingRepository(),
		db:                  db,
	}
}

func (repository *PostgresReportingRepository) FindReportTemplateByID(templateID int64) (model.ReportTemplate, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, template_key, name, description, status,
  doc_file_id, doc_version_no,
  categories_json, processing_config_json,
  content_markdown, outline_json, editor_config_json, annotations_json,
  created_at, updated_at, created_by, updated_by
FROM report_template
WHERE id = $1
`, templateID)
	entity, ok := scanReportTemplate(row)
	if !ok {
		return model.ReportTemplate{}, false
	}
	return entity, true
}

func (repository *PostgresReportingRepository) FindReportTemplateByKey(templateKey string) (model.ReportTemplate, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, template_key, name, description, status,
  doc_file_id, doc_version_no,
  categories_json, processing_config_json,
  content_markdown, outline_json, editor_config_json, annotations_json,
  created_at, updated_at, created_by, updated_by
FROM report_template
WHERE template_key = $1
`, templateKey)
	entity, ok := scanReportTemplate(row)
	if !ok {
		return model.ReportTemplate{}, false
	}
	return entity, true
}

func (repository *PostgresReportingRepository) FindAllReportTemplates() []model.ReportTemplateDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT
  id, template_key, name, description, status,
  doc_file_id, doc_version_no,
  categories_json,
  created_at, updated_at
FROM report_template
ORDER BY id ASC
`)
	if err != nil {
		return []model.ReportTemplateDTO{}
	}
	defer rows.Close()

	out := make([]model.ReportTemplateDTO, 0)
	for rows.Next() {
		var dto model.ReportTemplateDTO
		var categories []byte
		if err := rows.Scan(
			&dto.ID,
			&dto.TemplateKey,
			&dto.Name,
			&dto.Description,
			&dto.Status,
			&dto.DocFileID,
			&dto.DocVersionNo,
			&categories,
			&dto.CreatedAt,
			&dto.UpdatedAt,
		); err != nil {
			continue
		}
		dto.Categories = fallbackJSONArray(categories)
		out = append(out, dto)
	}
	return out
}

func (repository *PostgresReportingRepository) CreateReportTemplate(template model.ReportTemplate) model.ReportTemplateDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	template.CreatedAt = now
	template.UpdatedAt = now
	template.CategoriesJSON = fallbackJSONArray(template.CategoriesJSON)
	template.ProcessingConfigJSON = fallbackJSONObject(template.ProcessingConfigJSON)
	template.OutlineJSON = fallbackJSONArray(template.OutlineJSON)
	template.EditorConfigJSON = fallbackJSONObject(template.EditorConfigJSON)
	template.AnnotationsJSON = fallbackJSONArray(template.AnnotationsJSON)

	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO report_template (
  template_key, name, description, status,
  doc_file_id, doc_version_no,
  categories_json, processing_config_json,
  content_markdown, outline_json, editor_config_json, annotations_json,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4,
  $5, $6,
  $7::jsonb, $8::jsonb,
  $9, $10::jsonb, $11::jsonb, $12::jsonb,
  $13, $13, $14, $14
)
RETURNING id
`, template.TemplateKey, template.Name, template.Description, template.Status,
		template.DocFileID, template.DocVersionNo,
		string(template.CategoriesJSON), string(template.ProcessingConfigJSON),
		template.ContentMarkdown, string(template.OutlineJSON), string(template.EditorConfigJSON), string(template.AnnotationsJSON),
		now, template.CreatedBy).Scan(&template.ID)

	return template.ToDTO()
}

func (repository *PostgresReportingRepository) UpdateReportTemplate(templateID int64, update model.ReportTemplate) (model.ReportTemplateDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE report_template
SET
  name = $2,
  description = $3,
  status = $4,
  doc_file_id = $5,
  doc_version_no = $6,
  categories_json = $7::jsonb,
  processing_config_json = $8::jsonb,
  content_markdown = $9,
  outline_json = $10::jsonb,
  editor_config_json = $11::jsonb,
  annotations_json = $12::jsonb,
  updated_at = $13,
  updated_by = $14
WHERE id = $1
`, templateID, update.Name, update.Description, update.Status,
		update.DocFileID,
		update.DocVersionNo,
		string(fallbackJSONArray(update.CategoriesJSON)),
		string(fallbackJSONObject(update.ProcessingConfigJSON)),
		update.ContentMarkdown,
		string(fallbackJSONArray(update.OutlineJSON)),
		string(fallbackJSONObject(update.EditorConfigJSON)),
		string(fallbackJSONArray(update.AnnotationsJSON)),
		now,
		update.UpdatedBy)
	if err != nil {
		return model.ReportTemplateDTO{}, false
	}

	entity, ok := repository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *PostgresReportingRepository) FindReportCaseByID(caseID int64) (model.ReportCase, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, template_id, name, subject_id, subject_name, status, summary_json,
  created_at, updated_at, created_by, updated_by
FROM report_case
WHERE id = $1
`, caseID)
	entity, ok := scanReportCase(row)
	if !ok {
		return model.ReportCase{}, false
	}
	return entity, true
}

func (repository *PostgresReportingRepository) FindAllReportCases() []model.ReportCaseDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT
  id, template_id, name, subject_id, subject_name, status, summary_json,
  created_at, updated_at
FROM report_case
ORDER BY id DESC
`)
	if err != nil {
		return []model.ReportCaseDTO{}
	}
	defer rows.Close()

	out := make([]model.ReportCaseDTO, 0)
	for rows.Next() {
		var dto model.ReportCaseDTO
		var summary []byte
		if err := rows.Scan(
			&dto.ID,
			&dto.TemplateID,
			&dto.Name,
			&dto.SubjectID,
			&dto.SubjectName,
			&dto.Status,
			&summary,
			&dto.CreatedAt,
			&dto.UpdatedAt,
		); err != nil {
			continue
		}
		dto.Summary = fallbackJSONObject(summary)
		out = append(out, dto)
	}
	return out
}

func (repository *PostgresReportingRepository) CreateReportCase(reportCase model.ReportCase) model.ReportCaseDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	reportCase.CreatedAt = now
	reportCase.UpdatedAt = now
	reportCase.SummaryJSON = fallbackJSONObject(reportCase.SummaryJSON)
	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO report_case (
  template_id, name, subject_id, subject_name, status, summary_json,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4, $5, $6::jsonb,
  $7, $7, $8, $8
)
RETURNING id
`, reportCase.TemplateID, reportCase.Name, reportCase.SubjectID, reportCase.SubjectName, reportCase.Status, string(reportCase.SummaryJSON), now, reportCase.CreatedBy).Scan(&reportCase.ID)
	return reportCase.ToDTO()
}

func (repository *PostgresReportingRepository) UpdateReportCase(reportCase model.ReportCase) (model.ReportCaseDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE report_case
SET
  template_id = $2,
  name = $3,
  subject_id = $4,
  subject_name = $5,
  status = $6,
  summary_json = $7::jsonb,
  updated_at = $8,
  updated_by = $9
WHERE id = $1
`, reportCase.ID, reportCase.TemplateID, reportCase.Name, reportCase.SubjectID, reportCase.SubjectName, reportCase.Status, string(fallbackJSONObject(reportCase.SummaryJSON)), now, reportCase.UpdatedBy)
	if err != nil {
		return model.ReportCaseDTO{}, false
	}
	entity, ok := repository.FindReportCaseByID(reportCase.ID)
	if !ok {
		return model.ReportCaseDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *PostgresReportingRepository) FindEnterpriseProjectByID(projectID int64) (model.EnterpriseProject, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, enterprise_id, template_id, report_case_id, name, status,
  created_at, updated_at, created_by, updated_by
FROM enterprise_project
WHERE id = $1
`, projectID)
	entity, ok := scanEnterpriseProject(row)
	if !ok {
		return model.EnterpriseProject{}, false
	}
	return entity, true
}

func (repository *PostgresReportingRepository) FindEnterpriseProjectsByEnterpriseID(enterpriseID int64) []model.EnterpriseProjectDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	query := `
SELECT
  id, enterprise_id, template_id, report_case_id, name, status,
  created_at, updated_at, created_by, updated_by
FROM enterprise_project
`
	args := make([]any, 0)
	if enterpriseID > 0 {
		query += "WHERE enterprise_id = $1 "
		args = append(args, enterpriseID)
	}
	query += "ORDER BY id DESC"

	rows, err := repository.db.QueryContext(ctx, query, args...)
	if err != nil {
		return []model.EnterpriseProjectDTO{}
	}
	defer rows.Close()

	out := make([]model.EnterpriseProjectDTO, 0)
	for rows.Next() {
		var entity model.EnterpriseProject
		if err := rows.Scan(
			&entity.ID,
			&entity.EnterpriseID,
			&entity.TemplateID,
			&entity.ReportCaseID,
			&entity.Name,
			&entity.Status,
			&entity.CreatedAt,
			&entity.UpdatedAt,
			&entity.CreatedBy,
			&entity.UpdatedBy,
		); err != nil {
			continue
		}
		out = append(out, entity.ToDTO())
	}
	return out
}

func (repository *PostgresReportingRepository) CreateEnterpriseProject(project model.EnterpriseProject) model.EnterpriseProjectDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO enterprise_project (
  enterprise_id, template_id, report_case_id, name, status,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $6, $7, $7
)
RETURNING id
`, project.EnterpriseID, project.TemplateID, project.ReportCaseID, project.Name, project.Status, now, project.CreatedBy).Scan(&project.ID)
	return project.ToDTO()
}

func (repository *PostgresReportingRepository) UpdateEnterpriseProject(project model.EnterpriseProject) (model.EnterpriseProjectDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE enterprise_project
SET
  enterprise_id = $2,
  template_id = $3,
  report_case_id = $4,
  name = $5,
  status = $6,
  updated_at = $7,
  updated_by = $8
WHERE id = $1
`, project.ID, project.EnterpriseID, project.TemplateID, project.ReportCaseID, project.Name, project.Status, now, project.UpdatedBy)
	if err != nil {
		return model.EnterpriseProjectDTO{}, false
	}
	entity, ok := repository.FindEnterpriseProjectByID(project.ID)
	if !ok {
		return model.EnterpriseProjectDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *PostgresReportingRepository) CreateReportParseJob(job model.ReportParseJob) model.ReportParseJob {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	job.CreatedAt = now
	job.UpdatedAt = now
	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO report_parse_job (
  project_id, case_id, case_file_id, file_id, version_no,
  manual_category, file_type_group, status, retry_count, error_message,
  started_at, finished_at, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9, $10,
  $11, $12, $13, $13
)
RETURNING id
`, job.ProjectID, job.CaseID, job.CaseFileID, job.FileID, job.VersionNo, job.ManualCategory, job.FileTypeGroup, job.Status, job.RetryCount, job.ErrorMessage, job.StartedAt, job.FinishedAt, now).Scan(&job.ID)
	return job
}

func (repository *PostgresReportingRepository) FindReportParseJobsByProjectID(projectID int64) []model.ReportParseJob {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	query := `
SELECT
  id, project_id, case_id, case_file_id, file_id, version_no,
  manual_category, file_type_group, status, retry_count, error_message,
  started_at, finished_at, created_at, updated_at
FROM report_parse_job
`
	args := make([]any, 0)
	if projectID > 0 {
		query += "WHERE project_id = $1 "
		args = append(args, projectID)
	}
	query += "ORDER BY id ASC"
	rows, err := repository.db.QueryContext(ctx, query, args...)
	if err != nil {
		return []model.ReportParseJob{}
	}
	defer rows.Close()

	out := make([]model.ReportParseJob, 0)
	for rows.Next() {
		var job model.ReportParseJob
		if err := rows.Scan(
			&job.ID, &job.ProjectID, &job.CaseID, &job.CaseFileID, &job.FileID, &job.VersionNo,
			&job.ManualCategory, &job.FileTypeGroup, &job.Status, &job.RetryCount, &job.ErrorMessage,
			&job.StartedAt, &job.FinishedAt, &job.CreatedAt, &job.UpdatedAt,
		); err != nil {
			continue
		}
		out = append(out, job)
	}
	return out
}

func (repository *PostgresReportingRepository) FindReportParseJobByID(jobID int64) (model.ReportParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, project_id, case_id, case_file_id, file_id, version_no,
  manual_category, file_type_group, status, retry_count, error_message,
  started_at, finished_at, created_at, updated_at
FROM report_parse_job
WHERE id = $1
`, jobID)
	var job model.ReportParseJob
	err := row.Scan(
		&job.ID, &job.ProjectID, &job.CaseID, &job.CaseFileID, &job.FileID, &job.VersionNo,
		&job.ManualCategory, &job.FileTypeGroup, &job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.StartedAt, &job.FinishedAt, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return model.ReportParseJob{}, false
	}
	return job, true
}

func (repository *PostgresReportingRepository) ClaimNextReportParseJob(maxRetry int) (model.ReportParseJob, bool) {
	if maxRetry <= 0 {
		maxRetry = 3
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.ReportParseJob{}, false
	}
	defer func() { _ = tx.Rollback() }()

	var job model.ReportParseJob
	err = tx.QueryRowContext(ctx, `
WITH picked AS (
  SELECT id
  FROM report_parse_job
  WHERE status IN ($1, $2)
    AND retry_count < $3
  ORDER BY updated_at ASC, id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE report_parse_job j
SET status = $4, started_at = NOW(), updated_at = NOW()
FROM picked
WHERE j.id = picked.id
RETURNING
  j.id, j.project_id, j.case_id, j.case_file_id, j.file_id, j.version_no,
  j.manual_category, j.file_type_group, j.status, j.retry_count, j.error_message,
  j.started_at, j.finished_at, j.created_at, j.updated_at
`, model.ReportParseJobStatusPending, model.ReportParseJobStatusFailed, maxRetry, model.ReportParseJobStatusRunning).Scan(
		&job.ID, &job.ProjectID, &job.CaseID, &job.CaseFileID, &job.FileID, &job.VersionNo,
		&job.ManualCategory, &job.FileTypeGroup, &job.Status, &job.RetryCount, &job.ErrorMessage,
		&job.StartedAt, &job.FinishedAt, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.ReportParseJob{}, false
		}
		return model.ReportParseJob{}, false
	}
	if err := tx.Commit(); err != nil {
		return model.ReportParseJob{}, false
	}
	return job, true
}

func (repository *PostgresReportingRepository) UpdateReportParseJob(job model.ReportParseJob) (model.ReportParseJob, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE report_parse_job
SET
  project_id = $2,
  case_id = $3,
  case_file_id = $4,
  file_id = $5,
  version_no = $6,
  manual_category = $7,
  file_type_group = $8,
  status = $9,
  retry_count = $10,
  error_message = $11,
  started_at = $12,
  finished_at = $13,
  updated_at = $14
WHERE id = $1
`, job.ID, job.ProjectID, job.CaseID, job.CaseFileID, job.FileID, job.VersionNo, job.ManualCategory, job.FileTypeGroup, job.Status, job.RetryCount, job.ErrorMessage, job.StartedAt, job.FinishedAt, now)
	if err != nil {
		return model.ReportParseJob{}, false
	}
	return repository.FindReportParseJobByID(job.ID)
}

func (repository *PostgresReportingRepository) FindReportCaseFiles(caseID int64) []model.ReportCaseFile {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := repository.db.QueryContext(ctx, `
SELECT
  id, case_id, file_id, version_no, manual_category, suggested_sub_category, final_sub_category,
  status, review_status, confidence, file_type, source_type, parse_status,
  ocr_pending, is_scanned_suspected, processing_notes_json,
  created_at, updated_at, created_by, updated_by
FROM report_case_file
WHERE case_id = $1
ORDER BY id ASC
`, caseID)
	if err != nil {
		return []model.ReportCaseFile{}
	}
	defer rows.Close()
	out := make([]model.ReportCaseFile, 0)
	for rows.Next() {
		entity, ok := scanReportCaseFile(rows)
		if !ok {
			continue
		}
		out = append(out, entity)
	}
	return out
}

func (repository *PostgresReportingRepository) FindReportCaseFileByID(caseFileID int64) (model.ReportCaseFile, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, case_id, file_id, version_no, manual_category, suggested_sub_category, final_sub_category,
  status, review_status, confidence, file_type, source_type, parse_status,
  ocr_pending, is_scanned_suspected, processing_notes_json,
  created_at, updated_at, created_by, updated_by
FROM report_case_file
WHERE id = $1
`, caseFileID)
	entity, ok := scanReportCaseFileFromRow(row)
	if !ok {
		return model.ReportCaseFile{}, false
	}
	return entity, true
}

func (repository *PostgresReportingRepository) FindReportCaseFile(caseID int64, fileID int64) (model.ReportCaseFile, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	row := repository.db.QueryRowContext(ctx, `
SELECT
  id, case_id, file_id, version_no, manual_category, suggested_sub_category, final_sub_category,
  status, review_status, confidence, file_type, source_type, parse_status,
  ocr_pending, is_scanned_suspected, processing_notes_json,
  created_at, updated_at, created_by, updated_by
FROM report_case_file
WHERE case_id = $1 AND file_id = $2
ORDER BY id DESC
LIMIT 1
`, caseID, fileID)
	entity, ok := scanReportCaseFileFromRow(row)
	if !ok {
		return model.ReportCaseFile{}, false
	}
	return entity, true
}

func (repository *PostgresReportingRepository) CreateReportCaseFile(caseFile model.ReportCaseFile) model.ReportCaseFileDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	now := time.Now().UTC()
	caseFile.CreatedAt = now
	caseFile.UpdatedAt = now
	caseFile.ProcessingNotesJSON = fallbackJSONObject(caseFile.ProcessingNotesJSON)
	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO report_case_file (
  case_id, file_id, version_no, manual_category, suggested_sub_category, final_sub_category,
  status, review_status, confidence, file_type, source_type, parse_status,
  ocr_pending, is_scanned_suspected, processing_notes_json,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $8, $9, $10, $11, $12,
  $13, $14, $15::jsonb,
  $16, $16, $17, $17
)
RETURNING id
`, caseFile.CaseID, caseFile.FileID, caseFile.VersionNo, caseFile.ManualCategory, caseFile.SuggestedSubCategory, caseFile.FinalSubCategory, caseFile.Status, caseFile.ReviewStatus, caseFile.Confidence, caseFile.FileType, caseFile.SourceType, caseFile.ParseStatus, caseFile.OCRPending, caseFile.IsScannedSuspected, string(caseFile.ProcessingNotesJSON), now, caseFile.CreatedBy).Scan(&caseFile.ID)
	return caseFile.ToDTO()
}

func (repository *PostgresReportingRepository) UpdateReportCaseFile(caseFile model.ReportCaseFile) (model.ReportCaseFileDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE report_case_file
SET
  version_no = $2,
  manual_category = $3,
  suggested_sub_category = $4,
  final_sub_category = $5,
  status = $6,
  review_status = $7,
  confidence = $8,
  file_type = $9,
  source_type = $10,
  parse_status = $11,
  ocr_pending = $12,
  is_scanned_suspected = $13,
  processing_notes_json = $14::jsonb,
  updated_at = $15,
  updated_by = $16
WHERE id = $1
`, caseFile.ID, caseFile.VersionNo, caseFile.ManualCategory, caseFile.SuggestedSubCategory, caseFile.FinalSubCategory, caseFile.Status, caseFile.ReviewStatus, caseFile.Confidence, caseFile.FileType, caseFile.SourceType, caseFile.ParseStatus, caseFile.OCRPending, caseFile.IsScannedSuspected, string(fallbackJSONObject(caseFile.ProcessingNotesJSON)), now, caseFile.UpdatedBy)
	if err != nil {
		return model.ReportCaseFileDTO{}, false
	}
	entity, ok := repository.FindReportCaseFileByID(caseFile.ID)
	if !ok {
		return model.ReportCaseFileDTO{}, false
	}
	return entity.ToDTO(), true
}

func scanReportTemplate(row *sql.Row) (model.ReportTemplate, bool) {
	var entity model.ReportTemplate
	var categories []byte
	var config []byte
	var outline []byte
	var editorConfig []byte
	var annotations []byte

	err := row.Scan(
		&entity.ID,
		&entity.TemplateKey,
		&entity.Name,
		&entity.Description,
		&entity.Status,
		&entity.DocFileID,
		&entity.DocVersionNo,
		&categories,
		&config,
		&entity.ContentMarkdown,
		&outline,
		&editorConfig,
		&annotations,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.ReportTemplate{}, false
	}

	entity.CategoriesJSON = fallbackJSONArray(categories)
	entity.ProcessingConfigJSON = fallbackJSONObject(config)
	entity.OutlineJSON = fallbackJSONArray(outline)
	entity.EditorConfigJSON = fallbackJSONObject(editorConfig)
	entity.AnnotationsJSON = fallbackJSONArray(annotations)
	return entity, true
}

func scanReportCase(row *sql.Row) (model.ReportCase, bool) {
	var entity model.ReportCase
	var summary []byte
	err := row.Scan(
		&entity.ID,
		&entity.TemplateID,
		&entity.Name,
		&entity.SubjectID,
		&entity.SubjectName,
		&entity.Status,
		&summary,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.ReportCase{}, false
	}
	entity.SummaryJSON = fallbackJSONObject(summary)
	return entity, true
}

func scanEnterpriseProject(row *sql.Row) (model.EnterpriseProject, bool) {
	var entity model.EnterpriseProject
	err := row.Scan(
		&entity.ID,
		&entity.EnterpriseID,
		&entity.TemplateID,
		&entity.ReportCaseID,
		&entity.Name,
		&entity.Status,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.EnterpriseProject{}, false
	}
	return entity, true
}

func scanReportCaseFile(rows *sql.Rows) (model.ReportCaseFile, bool) {
	var entity model.ReportCaseFile
	var notes []byte
	err := rows.Scan(
		&entity.ID,
		&entity.CaseID,
		&entity.FileID,
		&entity.VersionNo,
		&entity.ManualCategory,
		&entity.SuggestedSubCategory,
		&entity.FinalSubCategory,
		&entity.Status,
		&entity.ReviewStatus,
		&entity.Confidence,
		&entity.FileType,
		&entity.SourceType,
		&entity.ParseStatus,
		&entity.OCRPending,
		&entity.IsScannedSuspected,
		&notes,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.ReportCaseFile{}, false
	}
	entity.ProcessingNotesJSON = fallbackJSONObject(notes)
	return entity, true
}

func scanReportCaseFileFromRow(row *sql.Row) (model.ReportCaseFile, bool) {
	var entity model.ReportCaseFile
	var notes []byte
	err := row.Scan(
		&entity.ID,
		&entity.CaseID,
		&entity.FileID,
		&entity.VersionNo,
		&entity.ManualCategory,
		&entity.SuggestedSubCategory,
		&entity.FinalSubCategory,
		&entity.Status,
		&entity.ReviewStatus,
		&entity.Confidence,
		&entity.FileType,
		&entity.SourceType,
		&entity.ParseStatus,
		&entity.OCRPending,
		&entity.IsScannedSuspected,
		&notes,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.ReportCaseFile{}, false
	}
	entity.ProcessingNotesJSON = fallbackJSONObject(notes)
	return entity, true
}

func fallbackJSONArray(raw []byte) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`[]`)
	}
	return json.RawMessage(raw)
}

func fallbackJSONObject(raw []byte) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}
