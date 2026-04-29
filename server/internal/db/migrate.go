package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"sxfgssever/server/internal/admindivisiondata"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS app_user (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  password VARCHAR(256) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_config (
  user_id BIGINT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  warning_account TEXT NOT NULL DEFAULT '',
  warning_password TEXT NOT NULL DEFAULT '',
  ai_base_url TEXT NOT NULL DEFAULT '',
  ai_api_key TEXT NOT NULL DEFAULT '',
  search_ai_base_url TEXT NOT NULL DEFAULT '',
  search_ai_api_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  models_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini',
  code_default_model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini',
  search_service VARCHAR(64) NOT NULL DEFAULT 'tavily',
  local_embedding_base_url TEXT NOT NULL DEFAULT '',
  local_embedding_api_key TEXT NOT NULL DEFAULT '',
  local_embedding_model VARCHAR(256) NOT NULL DEFAULT '',
  local_embedding_dimension INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  CHECK (jsonb_typeof(models_json) = 'array')
);

CREATE TABLE IF NOT EXISTS template (
  id BIGSERIAL PRIMARY KEY,
  template_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  engine VARCHAR(32) NOT NULL DEFAULT 'jinja2' CHECK (engine IN ('jinja2')),
  output_type VARCHAR(16) NOT NULL DEFAULT 'html' CHECK (output_type IN ('text', 'html')),
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  content TEXT NOT NULL,
  default_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  CHECK (jsonb_typeof(default_context_json) = 'object')
);

CREATE TABLE IF NOT EXISTS report_template (
  id BIGSERIAL PRIMARY KEY,
  template_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  doc_file_id BIGINT NOT NULL DEFAULT 0,
  doc_version_no INT NOT NULL DEFAULT 0,
  categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  processing_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_markdown TEXT NOT NULL DEFAULT '',
  outline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  editor_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  CHECK (jsonb_typeof(categories_json) = 'array'),
  CHECK (jsonb_typeof(processing_config_json) = 'object'),
  CHECK (jsonb_typeof(outline_json) = 'array'),
  CHECK (jsonb_typeof(editor_config_json) = 'object'),
  CHECK (jsonb_typeof(annotations_json) = 'array')
);

CREATE TABLE IF NOT EXISTS resource_share (
  id BIGSERIAL PRIMARY KEY,
  resource_type VARCHAR(64) NOT NULL,
  resource_id BIGINT NOT NULL,
  target_user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permission VARCHAR(32) NOT NULL DEFAULT 'edit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  UNIQUE (resource_type, resource_id, target_user_id)
);

CREATE TABLE IF NOT EXISTS workflow (
  id BIGSERIAL PRIMARY KEY,
  workflow_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  current_draft_version_no INT NOT NULL DEFAULT 1,
  current_published_version_no INT NOT NULL DEFAULT 0,
  breaker_window_minutes INT NOT NULL DEFAULT 1 CHECK (breaker_window_minutes > 0),
  breaker_max_requests INT NOT NULL DEFAULT 5 CHECK (breaker_max_requests > 0),
  dsl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  CHECK (jsonb_typeof(dsl_json) = 'object'),
  CHECK (jsonb_typeof(dsl_json->'nodes') = 'array'),
  CHECK (jsonb_array_length(dsl_json->'nodes') > 0)
);

CREATE TABLE IF NOT EXISTS workflow_version (
  id BIGSERIAL PRIMARY KEY,
  workflow_id BIGINT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  dsl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version_no),
  CHECK (jsonb_typeof(dsl_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_workflow_status ON workflow(status);
CREATE INDEX IF NOT EXISTS idx_workflow_version_workflow_version ON workflow_version(workflow_id, version_no);
CREATE INDEX IF NOT EXISTS idx_template_status ON template(status);
CREATE INDEX IF NOT EXISTS idx_report_template_status ON report_template(status);
CREATE INDEX IF NOT EXISTS idx_resource_share_type_resource ON resource_share(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_share_type_user ON resource_share(resource_type, target_user_id);

CREATE TABLE IF NOT EXISTS enterprise_project (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  report_case_id BIGINT NOT NULL DEFAULT 0,
  name VARCHAR(256) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_case (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL,
  name VARCHAR(256) NOT NULL DEFAULT '',
  subject_id BIGINT NOT NULL DEFAULT 0,
  subject_name VARCHAR(256) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'pending_review', 'ready')),
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_case_file (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES report_case(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL,
  version_no INT NOT NULL DEFAULT 0,
  manual_category VARCHAR(128) NOT NULL DEFAULT '',
  suggested_sub_category VARCHAR(128) NOT NULL DEFAULT '',
  final_sub_category VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processed', 'pending_review', 'approved', 'rejected')),
  review_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  file_type VARCHAR(64) NOT NULL DEFAULT '',
  source_type VARCHAR(64) NOT NULL DEFAULT '',
  parse_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsed', 'needs_ocr', 'failed')),
  ocr_pending BOOLEAN NOT NULL DEFAULT false,
  is_scanned_suspected BOOLEAN NOT NULL DEFAULT false,
  processing_notes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_parse_job (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  case_id BIGINT NOT NULL DEFAULT 0,
  case_file_id BIGINT NOT NULL DEFAULT 0,
  file_id BIGINT NOT NULL,
  version_no INT NOT NULL DEFAULT 0,
  manual_category VARCHAR(128) NOT NULL DEFAULT '',
  file_type_group VARCHAR(64) NOT NULL DEFAULT 'other',
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_slice (
  id BIGSERIAL PRIMARY KEY,
  parse_job_id BIGINT NOT NULL DEFAULT 0,
  parent_slice_id BIGINT NOT NULL DEFAULT 0,
  case_file_id BIGINT NOT NULL REFERENCES report_case_file(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL DEFAULT 0,
  version_no INT NOT NULL DEFAULT 0,
  slice_type VARCHAR(64) NOT NULL DEFAULT '',
  source_type VARCHAR(64) NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  title_level INT NOT NULL DEFAULT 0,
  page_start INT NOT NULL DEFAULT 1,
  page_end INT NOT NULL DEFAULT 1,
  bbox_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  raw_text TEXT NOT NULL DEFAULT '',
  clean_text TEXT NOT NULL DEFAULT '',
  table_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  parse_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ocr_pending BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_table (
  id BIGSERIAL PRIMARY KEY,
  case_file_id BIGINT NOT NULL REFERENCES report_case_file(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL DEFAULT 0,
  version_no INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  page_start INT NOT NULL DEFAULT 1,
  page_end INT NOT NULL DEFAULT 1,
  header_row_count INT NOT NULL DEFAULT 0,
  column_count INT NOT NULL DEFAULT 0,
  source_type VARCHAR(64) NOT NULL DEFAULT '',
  parse_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  is_cross_page BOOLEAN NOT NULL DEFAULT false,
  bbox_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_table_fragment (
  id BIGSERIAL PRIMARY KEY,
  table_id BIGINT NOT NULL REFERENCES document_table(id) ON DELETE CASCADE,
  case_file_id BIGINT NOT NULL REFERENCES report_case_file(id) ON DELETE CASCADE,
  page_no INT NOT NULL DEFAULT 1,
  row_start INT NOT NULL DEFAULT 0,
  row_end INT NOT NULL DEFAULT 0,
  fragment_order INT NOT NULL DEFAULT 0,
  bbox_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_table_cell (
  id BIGSERIAL PRIMARY KEY,
  table_id BIGINT NOT NULL REFERENCES document_table(id) ON DELETE CASCADE,
  fragment_id BIGINT NOT NULL DEFAULT 0,
  case_file_id BIGINT NOT NULL REFERENCES report_case_file(id) ON DELETE CASCADE,
  row_index INT NOT NULL DEFAULT 0,
  col_index INT NOT NULL DEFAULT 0,
  row_span INT NOT NULL DEFAULT 1,
  col_span INT NOT NULL DEFAULT 1,
  raw_text TEXT NOT NULL DEFAULT '',
  normalized_value TEXT NOT NULL DEFAULT '',
  bbox_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_project_enterprise ON enterprise_project(enterprise_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_project_template ON enterprise_project(template_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_case_template ON report_case(template_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_case_subject ON report_case(subject_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_case_status_updated ON report_case(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_case_file_case ON report_case_file(case_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_case_file_file ON report_case_file(file_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_case_file_status_updated ON report_case_file(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_parse_job_project ON report_parse_job(project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_parse_job_status_updated ON report_parse_job(status, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_document_slice_case_file ON document_slice(case_file_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_document_slice_file_version ON document_slice(file_id, version_no, id ASC);
CREATE INDEX IF NOT EXISTS idx_document_table_case_file ON document_table(case_file_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_document_table_file_version ON document_table(file_id, version_no, id ASC);
CREATE INDEX IF NOT EXISTS idx_document_table_fragment_case_file ON document_table_fragment(case_file_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_document_table_cell_case_file ON document_table_cell(case_file_id, id ASC);

CREATE TABLE IF NOT EXISTS workflow_execution_task (
  execution_id VARCHAR(64) PRIMARY KEY,
  workflow_id BIGINT NOT NULL DEFAULT 0,
  workflow_name VARCHAR(256) NOT NULL DEFAULT '',
  menu_key VARCHAR(32) NOT NULL DEFAULT '',
  starter_user_id BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  waiting_node_id VARCHAR(128) NOT NULL DEFAULT '',
  waiting_node_title VARCHAR(256) NOT NULL DEFAULT '',
  waiting_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(payload_json) = 'object'),
  CHECK (jsonb_typeof(waiting_schema_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_workflow_execution_task_starter_created ON workflow_execution_task(starter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_task_status_created ON workflow_execution_task(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_task_workflow_created ON workflow_execution_task(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_task_menu_created ON workflow_execution_task(menu_key, created_at DESC);

CREATE TABLE IF NOT EXISTS file (
  id BIGSERIAL PRIMARY KEY,
  biz_key VARCHAR(128) NOT NULL DEFAULT '',
  latest_version_no INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS file_version (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  storage_key TEXT NOT NULL,
  origin_name TEXT NOT NULL,
  mime_type VARCHAR(256) NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  checksum VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploading', 'uploaded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, version_no)
);

CREATE TABLE IF NOT EXISTS upload_session (
  id VARCHAR(64) PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  target_version_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'selected' CHECK (status IN ('selected', 'uploading', 'uploaded', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_file_status ON file(status);
CREATE INDEX IF NOT EXISTS idx_file_version_file_version ON file_version(file_id, version_no);
CREATE INDEX IF NOT EXISTS idx_upload_session_status_expires_at ON upload_session(status, expires_at);

CREATE TABLE IF NOT EXISTS file_parse_job (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  source_scope VARCHAR(64) NOT NULL DEFAULT 'file_management',
  project_id BIGINT NOT NULL DEFAULT 0,
  project_name VARCHAR(256) NOT NULL DEFAULT '',
  case_file_id BIGINT NOT NULL DEFAULT 0,
  manual_category VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  file_type VARCHAR(64) NOT NULL DEFAULT '',
  source_type VARCHAR(64) NOT NULL DEFAULT '',
  parse_strategy VARCHAR(64) NOT NULL DEFAULT '',
  ocr_task_status VARCHAR(32) NOT NULL DEFAULT '',
  ocr_pending BOOLEAN NOT NULL DEFAULT false,
  ocr_error TEXT NOT NULL DEFAULT '',
  result_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  requested_by BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_parse_job_file_version ON file_parse_job(file_id, version_no, id DESC);
CREATE INDEX IF NOT EXISTS idx_file_parse_job_status_updated ON file_parse_job(status, updated_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS ocr_task (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  provider_mode VARCHAR(32) NOT NULL DEFAULT 'auto',
  provider_used VARCHAR(64) NOT NULL DEFAULT '',
  provider_task_id VARCHAR(128) NOT NULL DEFAULT '',
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  page_count INT NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  retry_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_task_file_version_created ON ocr_task(file_id, version_no, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_task_status_created ON ocr_task(status, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_index_job (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, version_no)
);

CREATE TABLE IF NOT EXISTS knowledge_chunk (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  biz_key VARCHAR(128) NOT NULL DEFAULT '',
  chunk_index INT NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  chunk_summary TEXT NOT NULL DEFAULT '',
  source_type VARCHAR(64) NOT NULL DEFAULT '',
  page_start INT NOT NULL DEFAULT 1,
  page_end INT NOT NULL DEFAULT 1,
  source_ref VARCHAR(128) NOT NULL DEFAULT '',
  bbox_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  anchor_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  parse_strategy VARCHAR(64) NOT NULL DEFAULT '',
  content_hash VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, version_no, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_job_status_updated ON knowledge_index_job(status, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_file_version ON knowledge_chunk(file_id, version_no);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_biz_key ON knowledge_chunk(biz_key);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_text_tsv ON knowledge_chunk USING GIN (to_tsvector('simple', coalesce(chunk_text, '')));
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_text_trgm ON knowledge_chunk USING GIN (chunk_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge_embedding (
  chunk_id BIGINT NOT NULL REFERENCES knowledge_chunk(id) ON DELETE CASCADE,
  model_name VARCHAR(128) NOT NULL,
  embedding vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chunk_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_model_name ON knowledge_embedding(model_name);

CREATE TABLE IF NOT EXISTS debug_feedback (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('requirement', 'bug')),
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  submitter_id BIGINT NOT NULL REFERENCES app_user(id),
  completed_at TIMESTAMPTZ,
  completed_by_user_id BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS debug_feedback_attachment (
  id BIGSERIAL PRIMARY KEY,
  feedback_id BIGINT NOT NULL REFERENCES debug_feedback(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  version_no INT NOT NULL CHECK (version_no > 0)
);

CREATE INDEX IF NOT EXISTS idx_debug_feedback_status_created ON debug_feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_feedback_submitter_created ON debug_feedback(submitter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_feedback_attachment_feedback ON debug_feedback_attachment(feedback_id, id ASC);

CREATE TABLE IF NOT EXISTS region (
  id BIGSERIAL PRIMARY KEY,
  admin_code VARCHAR(64) NOT NULL UNIQUE,
  region_code VARCHAR(64),
  region_name VARCHAR(128),
  overview TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS region_economy (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES region(id) ON DELETE CASCADE,
  is_top100_county BOOLEAN NOT NULL DEFAULT false,
  is_top100_city BOOLEAN NOT NULL DEFAULT false,
  gdp NUMERIC(20, 4),
  gdp_growth NUMERIC(12, 6),
  population NUMERIC(20, 4),
  fiscal_self_sufficiency_ratio NUMERIC(12, 6),
  general_budget_revenue NUMERIC(20, 4),
  general_budget_revenue_growth NUMERIC(12, 6),
  general_budget_revenue_total NUMERIC(20, 4),
  general_budget_revenue_tax NUMERIC(20, 4),
  general_budget_revenue_non_tax NUMERIC(20, 4),
  general_budget_revenue_superior_subsidy NUMERIC(20, 4),
  liability_ratio NUMERIC(12, 6),
  liability_ratio_broad NUMERIC(12, 6),
  debt_ratio NUMERIC(12, 6),
  debt_ratio_broad NUMERIC(12, 6),
  year INT NOT NULL CHECK (year >= 1900),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  UNIQUE (region_id, year)
);

CREATE TABLE IF NOT EXISTS region_rank (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES region(id) ON DELETE CASCADE,
  subject VARCHAR(128) NOT NULL DEFAULT '',
  rank INT,
  total INT,
  year INT NOT NULL CHECK (year >= 1900),
  growth_rate NUMERIC(12, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  UNIQUE (region_id, year, subject)
);

CREATE TABLE IF NOT EXISTS enterprise (
  id BIGSERIAL PRIMARY KEY,
  short_name VARCHAR(256) NOT NULL,
  region_id BIGINT NOT NULL REFERENCES region(id),
  in_hidden_debt_list BOOLEAN NOT NULL DEFAULT false,
  in_3899_list BOOLEAN NOT NULL DEFAULT false,
  meets_335_indicator BOOLEAN NOT NULL DEFAULT false,
  meets_224_indicator BOOLEAN NOT NULL DEFAULT false,
  enterprise_level VARCHAR(64) NOT NULL DEFAULT '',
  net_assets NUMERIC(20, 4),
  real_estate_revenue_ratio NUMERIC(12, 6),
  main_business_type TEXT NOT NULL DEFAULT '',
  established_at TIMESTAMPTZ,
  non_standard_financing_ratio NUMERIC(12, 6),
  main_business TEXT NOT NULL DEFAULT '',
  related_party_public_opinion TEXT NOT NULL DEFAULT '',
  admission_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (admission_status IN ('admitted', 'rejected', 'pending')),
  calculated_at TIMESTAMPTZ,
  registered_capital NUMERIC(20, 4),
  paid_in_capital NUMERIC(20, 4),
  industry VARCHAR(128) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  business_scope TEXT NOT NULL DEFAULT '',
  legal_person VARCHAR(128) NOT NULL DEFAULT '',
  company_type VARCHAR(128) NOT NULL DEFAULT '',
  enterprise_nature VARCHAR(128) NOT NULL DEFAULT '',
  actual_controller VARCHAR(128) NOT NULL DEFAULT '',
  actual_controller_control_path TEXT NOT NULL DEFAULT '',
  issuer_rating VARCHAR(64) NOT NULL DEFAULT '',
  issuer_rating_agency VARCHAR(128) NOT NULL DEFAULT '',
  unified_credit_code VARCHAR(64) NOT NULL,
  legal_person_id_card VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enterprise_tag (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  title VARCHAR(256) NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_public_opinion (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  source VARCHAR(256) NOT NULL DEFAULT '',
  issue TEXT NOT NULL DEFAULT '',
  opinion_time TIMESTAMPTZ,
  title VARCHAR(512) NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_bond_tender (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  tender_time TIMESTAMPTZ,
  tender_type VARCHAR(128) NOT NULL DEFAULT '',
  project_type VARCHAR(128) NOT NULL DEFAULT '',
  winner VARCHAR(256) NOT NULL DEFAULT '',
  tender_title VARCHAR(512) NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_bond_detail (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  short_name VARCHAR(256) NOT NULL DEFAULT '',
  bond_code VARCHAR(128) NOT NULL DEFAULT '',
  bond_type VARCHAR(128) NOT NULL DEFAULT '',
  balance NUMERIC(20, 4),
  bond_term VARCHAR(128) NOT NULL DEFAULT '',
  rating VARCHAR(128) NOT NULL DEFAULT '',
  guarantor VARCHAR(256) NOT NULL DEFAULT '',
  guarantor_type VARCHAR(128) NOT NULL DEFAULT '',
  issue_time TIMESTAMPTZ,
  issue_rate NUMERIC(12, 6),
  maturity_date TIMESTAMPTZ,
  usefor TEXT NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_bond_registration (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  project_name VARCHAR(256) NOT NULL DEFAULT '',
  registration_status VARCHAR(128) NOT NULL DEFAULT '',
  status_updated_at TIMESTAMPTZ,
  amount NUMERIC(20, 4),
  process TEXT NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_finance_snapshot (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE UNIQUE,
  liability_asset_ratio NUMERIC(12, 6),
  roa NUMERIC(12, 6),
  roa_industry_median NUMERIC(12, 6),
  roa_industry_1_4 NUMERIC(12, 6),
  roa_industry_3_4 NUMERIC(12, 6),
  roe NUMERIC(12, 6),
  roe_industry_1_4 NUMERIC(12, 6),
  roe_industry_3_4 NUMERIC(12, 6),
  interest_coverage NUMERIC(12, 6),
  ebit_coverage NUMERIC(12, 6),
  ebit_coverage_industry_median NUMERIC(12, 6),
  ebit_coverage_industry_1_4 NUMERIC(12, 6),
  ebit_coverage_industry_3_4 NUMERIC(12, 6),
  ebitda_coverage NUMERIC(12, 6),
  ebitda_coverage_industry_median NUMERIC(12, 6),
  ebitda_coverage_industry_1_4 NUMERIC(12, 6),
  ebitda_coverage_industry_3_4 NUMERIC(12, 6),
  liability_asset_ratio_industry_median NUMERIC(12, 6),
  liability_asset_ratio_industry_1_4 NUMERIC(12, 6),
  liability_asset_ratio_industry_3_4 NUMERIC(12, 6),
  roe_industry_median NUMERIC(12, 6),
  non_standard_financing_ratio_industry_median NUMERIC(12, 6),
  main_business_1 VARCHAR(256) NOT NULL DEFAULT '',
  main_business_2 VARCHAR(256) NOT NULL DEFAULT '',
  main_business_3 VARCHAR(256) NOT NULL DEFAULT '',
  main_business_4 VARCHAR(256) NOT NULL DEFAULT '',
  main_business_5 VARCHAR(256) NOT NULL DEFAULT '',
  main_business_ratio_1 NUMERIC(12, 6),
  main_business_ratio_2 NUMERIC(12, 6),
  main_business_ratio_3 NUMERIC(12, 6),
  main_business_ratio_4 NUMERIC(12, 6),
  main_business_ratio_5 NUMERIC(12, 6)
);

CREATE TABLE IF NOT EXISTS enterprise_finance_subject (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  subject_name VARCHAR(256) NOT NULL DEFAULT '',
  subject_type VARCHAR(128) NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_shareholder (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  shareholder_id VARCHAR(128) NOT NULL DEFAULT '',
  order_no INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enterprise_financial_report (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year >= 1900),
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  level INT NOT NULL DEFAULT 1 CHECK (level >= 1),
  accounting_firm VARCHAR(256) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  UNIQUE (enterprise_id, year, month)
);

CREATE TABLE IF NOT EXISTS enterprise_financial_report_item (
  id BIGSERIAL PRIMARY KEY,
  financial_report_id BIGINT NOT NULL REFERENCES enterprise_financial_report(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES enterprise_finance_subject(id) ON DELETE RESTRICT,
  value NUMERIC(20, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  UNIQUE (financial_report_id, subject_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_credit_code_active
ON enterprise(unified_credit_code)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enterprise_region_id ON enterprise(region_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_admission_status ON enterprise(admission_status);
CREATE INDEX IF NOT EXISTS idx_enterprise_updated_at ON enterprise(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_tag_enterprise_order ON enterprise_tag(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_public_opinion_enterprise_order ON enterprise_public_opinion(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_bond_tender_enterprise_order ON enterprise_bond_tender(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_bond_detail_enterprise_order ON enterprise_bond_detail(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_bond_registration_enterprise_order ON enterprise_bond_registration(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_finance_subject_enterprise_order ON enterprise_finance_subject(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_shareholder_enterprise_order ON enterprise_shareholder(enterprise_id, order_no);
CREATE INDEX IF NOT EXISTS idx_enterprise_financial_report_enterprise_year_month ON enterprise_financial_report(enterprise_id, year, month);
CREATE INDEX IF NOT EXISTS idx_enterprise_financial_report_item_report_id ON enterprise_financial_report_item(financial_report_id);
CREATE INDEX IF NOT EXISTS idx_region_admin_code ON region(admin_code);
CREATE INDEX IF NOT EXISTS idx_region_economy_region_year ON region_economy(region_id, year DESC);
CREATE INDEX IF NOT EXISTS idx_region_rank_region_year ON region_rank(region_id, year DESC);
CREATE INDEX IF NOT EXISTS idx_region_rank_region_subject_year ON region_rank(region_id, subject, year DESC);

CREATE TABLE IF NOT EXISTS admin_division (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  level INT NOT NULL CHECK (level >= 1),
  indent INT NOT NULL DEFAULT 0 CHECK (indent >= 0),
  parent_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admin_division_parent_code ON admin_division(parent_code);
CREATE INDEX IF NOT EXISTS idx_admin_division_level ON admin_division(level);
CREATE INDEX IF NOT EXISTS idx_admin_division_code_name ON admin_division(code, name);

CREATE TABLE IF NOT EXISTS chat_conversation (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini',
  system_prompt TEXT NOT NULL DEFAULT '',
  enable_web_search BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_message (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversation(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversation_user_updated_at ON chat_conversation(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_message_conversation_id_id ON chat_message(conversation_id, id);
`

func Migrate(ctx context.Context, conn *sql.DB) error {
	if _, err := conn.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS pg_trgm;`); err != nil {
		return fmt.Errorf("enable pg_trgm extension: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS vector;`); err != nil {
		return fmt.Errorf("enable vector extension: %w", err)
	}
	if _, err := conn.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
INSERT INTO region (admin_code, overview, created_at, updated_at, created_by, updated_by)
VALUES ('000000', '默认区域', NOW(), NOW(), 1, 1)
ON CONFLICT (admin_code) DO NOTHING;

ALTER TABLE region
ADD COLUMN IF NOT EXISTS region_code VARCHAR(64);
ALTER TABLE region
ADD COLUMN IF NOT EXISTS region_name VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_region_region_code_unique ON region(region_code) WHERE region_code IS NOT NULL;

ALTER TABLE report_template
ADD COLUMN IF NOT EXISTS doc_file_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE report_template
ADD COLUMN IF NOT EXISTS doc_version_no INT NOT NULL DEFAULT 0;

ALTER TABLE region_economy
DROP COLUMN IF EXISTS gdp_rank_province;
ALTER TABLE region_economy
DROP COLUMN IF EXISTS gdp_rank_province_total;

CREATE TABLE IF NOT EXISTS region_rank (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES region(id) ON DELETE CASCADE,
  subject VARCHAR(128) NOT NULL DEFAULT '',
  rank INT,
  total INT,
  year INT NOT NULL CHECK (year >= 1900),
  growth_rate NUMERIC(12, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  UNIQUE (region_id, year, subject)
);
CREATE INDEX IF NOT EXISTS idx_region_rank_region_year ON region_rank(region_id, year DESC);
CREATE INDEX IF NOT EXISTS idx_region_rank_region_subject_year ON region_rank(region_id, subject, year DESC);

ALTER TABLE enterprise
ADD COLUMN IF NOT EXISTS region_id BIGINT;
ALTER TABLE enterprise
ADD COLUMN IF NOT EXISTS issuer_rating VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE enterprise
ADD COLUMN IF NOT EXISTS issuer_rating_agency VARCHAR(128) NOT NULL DEFAULT '';

UPDATE enterprise
SET region_id = (SELECT id FROM region WHERE admin_code = '000000' LIMIT 1)
WHERE region_id IS NULL;

ALTER TABLE enterprise
ALTER COLUMN region_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN ('fk_enterprise_region_id', 'enterprise_region_id_fkey')
  ) THEN
    ALTER TABLE enterprise
    ADD CONSTRAINT fk_enterprise_region_id
    FOREIGN KEY (region_id) REFERENCES region(id);
  END IF;
END $$;

ALTER TABLE enterprise
DROP COLUMN IF EXISTS region;

DO $$
DECLARE admission_status_type TEXT;
BEGIN
  SELECT data_type INTO admission_status_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'enterprise'
    AND column_name = 'admission_status';

  IF admission_status_type = 'boolean' THEN
    ALTER TABLE enterprise
    ALTER COLUMN admission_status DROP DEFAULT;
    ALTER TABLE enterprise
    ALTER COLUMN admission_status TYPE VARCHAR(16)
    USING CASE WHEN admission_status IS TRUE THEN 'admitted' ELSE 'rejected' END;
  ELSIF admission_status_type IS NULL THEN
    ALTER TABLE enterprise
    ADD COLUMN admission_status VARCHAR(16);
  END IF;
END $$;

UPDATE enterprise
SET admission_status = 'pending'
WHERE admission_status IS NULL OR TRIM(admission_status) = '';

ALTER TABLE enterprise
ALTER COLUMN admission_status SET DEFAULT 'pending';
ALTER TABLE enterprise
ALTER COLUMN admission_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'enterprise_admission_status_check'
  ) THEN
    ALTER TABLE enterprise
    ADD CONSTRAINT enterprise_admission_status_check
    CHECK (admission_status IN ('admitted', 'rejected', 'pending'));
  END IF;
END $$;

DROP INDEX IF EXISTS idx_enterprise_region;
DROP INDEX IF EXISTS idx_enterprise_admission_status;
CREATE INDEX IF NOT EXISTS idx_enterprise_region_id ON enterprise(region_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_admission_status ON enterprise(admission_status);

ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS liability_asset_ratio NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS liability_asset_ratio_industry_median NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS liability_asset_ratio_industry_1_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS liability_asset_ratio_industry_3_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roe_industry_median NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roe_industry_1_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roe_industry_3_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS non_standard_financing_ratio_industry_median NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roe NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roa_industry_1_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roa_industry_3_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS roa_industry_median NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebit_coverage NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebit_coverage_industry_median NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebit_coverage_industry_1_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebit_coverage_industry_3_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebitda_coverage NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebitda_coverage_industry_median NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebitda_coverage_industry_1_4 NUMERIC(12, 6);
ALTER TABLE enterprise_finance_snapshot
ADD COLUMN IF NOT EXISTS ebitda_coverage_industry_3_4 NUMERIC(12, 6);
ALTER TABLE enterprise_financial_report
ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1;
ALTER TABLE enterprise_bond_detail
ADD COLUMN IF NOT EXISTS guarantor_type VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE enterprise_bond_detail
ADD COLUMN IF NOT EXISTS issue_time TIMESTAMPTZ;
ALTER TABLE enterprise_bond_detail
ADD COLUMN IF NOT EXISTS issue_rate NUMERIC(12, 6);
ALTER TABLE enterprise_bond_detail
ADD COLUMN IF NOT EXISTS maturity_date TIMESTAMPTZ;
ALTER TABLE enterprise_bond_detail
ADD COLUMN IF NOT EXISTS usefor TEXT NOT NULL DEFAULT '';
ALTER TABLE enterprise
DROP COLUMN IF EXISTS liability_asset_ratio;
ALTER TABLE enterprise
DROP COLUMN IF EXISTS liability_asset_ratio_industry_median;
`); err != nil {
		return fmt.Errorf("migrate enterprise region/finance extension: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
ALTER TABLE workflow
ADD COLUMN IF NOT EXISTS menu_key VARCHAR(32) NOT NULL DEFAULT 'reserve' CHECK (menu_key IN ('', 'reserve', 'review', 'postloan'));
ALTER TABLE workflow ALTER COLUMN menu_key SET DEFAULT 'reserve';
UPDATE workflow SET menu_key = 'reserve' WHERE menu_key = '' OR menu_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_menu_key ON workflow(menu_key);
`); err != nil {
		return fmt.Errorf("migrate workflow menu_key: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
ALTER TABLE workflow
ADD COLUMN IF NOT EXISTS breaker_window_minutes INT NOT NULL DEFAULT 1 CHECK (breaker_window_minutes > 0);
ALTER TABLE workflow
ADD COLUMN IF NOT EXISTS breaker_max_requests INT NOT NULL DEFAULT 5 CHECK (breaker_max_requests > 0);
UPDATE workflow SET breaker_window_minutes = 1 WHERE breaker_window_minutes IS NULL OR breaker_window_minutes <= 0;
UPDATE workflow SET breaker_max_requests = 5 WHERE breaker_max_requests IS NULL OR breaker_max_requests <= 0;
ALTER TABLE workflow ALTER COLUMN breaker_window_minutes SET DEFAULT 1;
ALTER TABLE workflow ALTER COLUMN breaker_max_requests SET DEFAULT 5;
`); err != nil {
		return fmt.Errorf("migrate workflow breaker config: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS code_default_model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini';
UPDATE system_config SET code_default_model = default_model WHERE code_default_model IS NULL OR code_default_model = '';
ALTER TABLE system_config ALTER COLUMN code_default_model SET DEFAULT 'gpt-4o-mini';
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS search_service VARCHAR(64) NOT NULL DEFAULT 'tavily';
UPDATE system_config SET search_service = 'tavily' WHERE search_service IS NULL OR search_service = '';
ALTER TABLE system_config ALTER COLUMN search_service SET DEFAULT 'tavily';
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS local_embedding_base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS local_embedding_api_key TEXT NOT NULL DEFAULT '';
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS local_embedding_model VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE system_config
ADD COLUMN IF NOT EXISTS local_embedding_dimension INT NOT NULL DEFAULT 0;
UPDATE system_config SET local_embedding_base_url = '' WHERE local_embedding_base_url IS NULL;
UPDATE system_config SET local_embedding_api_key = '' WHERE local_embedding_api_key IS NULL;
UPDATE system_config SET local_embedding_model = '' WHERE local_embedding_model IS NULL;
UPDATE system_config SET local_embedding_dimension = 0 WHERE local_embedding_dimension IS NULL OR local_embedding_dimension < 0;
ALTER TABLE system_config ALTER COLUMN local_embedding_base_url SET DEFAULT '';
ALTER TABLE system_config ALTER COLUMN local_embedding_api_key SET DEFAULT '';
ALTER TABLE system_config ALTER COLUMN local_embedding_model SET DEFAULT '';
ALTER TABLE system_config ALTER COLUMN local_embedding_dimension SET DEFAULT 0;
`); err != nil {
		return fmt.Errorf("migrate system_config code_default_model: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
ALTER TABLE chat_conversation
ADD COLUMN IF NOT EXISTS enable_web_search BOOLEAN NOT NULL DEFAULT false;
`); err != nil {
		return fmt.Errorf("migrate chat_conversation enable_web_search: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
DO $$
DECLARE
  row_item RECORD;
BEGIN
  FOR row_item IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c'
      AND n.nspname = current_schema()
      AND t.relname = 'report_parse_job'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE report_parse_job DROP CONSTRAINT %I', row_item.conname);
  END LOOP;
END $$;

ALTER TABLE report_parse_job
ADD CONSTRAINT report_parse_job_status_check
CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'));

DO $$
DECLARE
  row_item RECORD;
BEGIN
  FOR row_item IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c'
      AND n.nspname = current_schema()
      AND t.relname = 'knowledge_index_job'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge_index_job DROP CONSTRAINT %I', row_item.conname);
  END LOOP;
END $$;

ALTER TABLE knowledge_index_job
ADD CONSTRAINT knowledge_index_job_status_check
CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'));
`); err != nil {
		return fmt.Errorf("migrate parse/vector cancelled status: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS search_ai_base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS search_ai_api_key TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_chunk
ADD COLUMN IF NOT EXISTS anchor_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS ocr_task_status VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS ocr_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS ocr_error TEXT NOT NULL DEFAULT '';
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS source_scope VARCHAR(64) NOT NULL DEFAULT 'file_management';
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS project_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS project_name VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS case_file_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE file_parse_job
ADD COLUMN IF NOT EXISTS manual_category VARCHAR(128) NOT NULL DEFAULT '';
`); err != nil {
		return fmt.Errorf("migrate user_config search ai config: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
INSERT INTO system_config (
  id, models_json, default_model, code_default_model, search_service,
  local_embedding_base_url, local_embedding_api_key, local_embedding_model, local_embedding_dimension,
  created_at, updated_at, created_by, updated_by
)
VALUES (
  1,
  '[{"name":"gpt-4o-mini","label":"GPT-4o mini","enabled":true}]'::jsonb,
  'gpt-4o-mini',
  'gpt-4o-mini',
  'tavily',
  '',
  '',
  '',
  0,
  NOW(),
  NOW(),
  1,
  1
)
ON CONFLICT (id) DO NOTHING;
`); err != nil {
		return fmt.Errorf("migrate system_config: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
DO $$
DECLARE
  table_exists BOOLEAN := FALSE;
  constrained_vector BOOLEAN := FALSE;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'knowledge_embedding'
        AND n.nspname = current_schema()
    ) INTO table_exists;

    IF table_exists THEN
      SELECT COALESCE(a.atttypmod > 0, FALSE)
      INTO constrained_vector
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'knowledge_embedding'
        AND n.nspname = current_schema()
        AND a.attname = 'embedding'
        AND a.attnum > 0
        AND NOT a.attisdropped
      LIMIT 1;
    END IF;

	    IF NOT table_exists OR constrained_vector THEN
	      DROP INDEX IF EXISTS idx_knowledge_embedding_vector_cosine;
	      DROP INDEX IF EXISTS idx_knowledge_embedding_model_name;
	      DROP TABLE IF EXISTS knowledge_embedding;
      CREATE TABLE knowledge_embedding (
        chunk_id BIGINT NOT NULL REFERENCES knowledge_chunk(id) ON DELETE CASCADE,
        model_name VARCHAR(128) NOT NULL,
        embedding vector NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chunk_id, model_name)
	      );
	      CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_model_name ON knowledge_embedding(model_name);
	    END IF;
	  END IF;
END $$;
`); err != nil {
		return fmt.Errorf("rebuild knowledge_embedding to dynamic vector: %w", err)
	}
	return nil
}

func Seed(ctx context.Context, conn *sql.DB) error {
	now := time.Now().UTC()

	// users (developer/admin + normal)
	_, err := conn.ExecContext(ctx, `
INSERT INTO app_user (username, name, password, role, created_at, updated_at, created_by, updated_by)
VALUES
  ('developer', '默认管理员', '123456', 'admin', $1, $1, 1, 1),
  ('normal-user', '普通用户', '123456', 'user', $1, $1, 1, 1)
ON CONFLICT (username) DO NOTHING
`, now)
	if err != nil {
		return fmt.Errorf("seed users: %w", err)
	}
	if err := seedAdminDivisions(ctx, conn, now); err != nil {
		return err
	}

	_, err = conn.ExecContext(ctx, `
INSERT INTO report_template (
  template_key, name, description, status,
  doc_file_id, doc_version_no,
  categories_json, processing_config_json,
  content_markdown, outline_json, editor_config_json, annotations_json,
  created_at, updated_at, created_by, updated_by
) VALUES (
  'default_report_pack',
  '默认报告组装模板',
  '包含主体、区域、财务、项目、反担保五大类的最小模板',
  'active',
  0,
  0,
  '[{"key":"subject","name":"主体","required":true},{"key":"region","name":"区域","required":true},{"key":"finance","name":"财务","required":true},{"key":"project","name":"项目","required":false},{"key":"counter_guarantee","name":"反担保","required":false}]'::jsonb,
  '{"classificationMode":"manual_category+rule+ai_fallback","reviewRequired":true,"traceability":true}'::jsonb,
  '## 模板说明

请在此编辑报告模板内容。',
  '[{"id":"heading-1","title":"模板说明","level":2,"line":1}]'::jsonb,
  '{}'::jsonb,
  '[]'::jsonb,
  $1, $1, 1, 1
)
ON CONFLICT (template_key) DO NOTHING
`, now)
	if err != nil {
		return fmt.Errorf("seed report template: %w", err)
	}

	// demo template
	_, err = conn.ExecContext(ctx, `
	INSERT INTO template (template_key, name, description, engine, output_type, status, content, default_context_json, created_at, updated_at, created_by, updated_by)
	VALUES (
  'demo_template',
  '示例模板',
  '用于演示 Jinja2 模板渲染与预览（现代化页面）',
  'jinja2',
  'html',
  'active',
  $$<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{ title }}</title>
    <style>
      :root {
        --bg0: #0b1220;
        --bg1: #0f172a;
        --card: rgba(255,255,255,0.06);
        --card2: rgba(255,255,255,0.09);
        --border: rgba(255,255,255,0.12);
        --text: rgba(255,255,255,0.92);
        --muted: rgba(255,255,255,0.68);
        --muted2: rgba(255,255,255,0.52);
        --ok: #22c55e;
        --warn: #f59e0b;
        --bad: #ef4444;
        --accent: #60a5fa;
        --accent2: #a78bfa;
        --shadow: 0 20px 60px rgba(0,0,0,0.35);
        --radius: 18px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        color: var(--text);
        background:
          radial-gradient(1200px 600px at 20% 10%, rgba(96,165,250,0.28), transparent 55%),
          radial-gradient(900px 500px at 80% 20%, rgba(167,139,250,0.22), transparent 55%),
          linear-gradient(180deg, var(--bg0), var(--bg1));
        min-height: 100vh;
      }
      a { color: inherit; text-decoration: none; }
      .wrap { max-width: 1040px; margin: 0 auto; padding: 28px 16px 40px; }
      .topbar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 16px 18px;
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow); backdrop-filter: blur(10px);
      }
      .brand {
        display: flex; align-items: center; gap: 12px; min-width: 0;
      }
      .logo {
        width: 42px; height: 42px; border-radius: 14px;
        background: linear-gradient(135deg, rgba(96,165,250,0.9), rgba(167,139,250,0.9));
        box-shadow: 0 10px 25px rgba(96,165,250,0.18);
        flex: none;
      }
      .brand h1 { margin: 0; font-size: 14px; letter-spacing: 0.2px; }
      .brand p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
      .pill {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 10px; border-radius: 999px;
        background: rgba(255,255,255,0.05); border: 1px solid var(--border);
        color: var(--muted); font-size: 12px;
      }
      .grid { display: grid; gap: 14px; margin-top: 14px; }
      .kpis { grid-template-columns: repeat(12, 1fr); }
      .card {
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow); padding: 16px; backdrop-filter: blur(10px);
      }
      .kpi { grid-column: span 3; }
      .kpi .label { color: var(--muted); font-size: 12px; }
      .kpi .value { font-size: 22px; margin-top: 8px; font-weight: 700; letter-spacing: 0.2px; }
      .kpi .meta { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .delta {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border);
        background: rgba(255,255,255,0.06);
      }
      .delta.up { color: rgba(34,197,94,0.95); }
      .delta.down { color: rgba(239,68,68,0.95); }
      .main { grid-template-columns: repeat(12, 1fr); }
      .left { grid-column: span 7; }
      .right { grid-column: span 5; }
      .section-title { font-size: 13px; color: var(--muted); margin: 0 0 10px; letter-spacing: 0.2px; }
      .table {
        width: 100%; border-collapse: separate; border-spacing: 0;
        overflow: hidden; border-radius: 14px; border: 1px solid var(--border);
        background: rgba(255,255,255,0.04);
      }
      .table th, .table td {
        text-align: left; padding: 10px 12px; font-size: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
      }
      .table th { color: var(--muted); font-weight: 600; background: rgba(255,255,255,0.04); }
      .table tr:last-child td { border-bottom: none; }
      .status {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 999px; font-size: 12px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.06);
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted2); }
      .status.ok .dot { background: var(--ok); }
      .status.warning .dot { background: var(--warn); }
      .status.blocked .dot { background: var(--bad); }
      .progress {
        height: 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.05); overflow: hidden;
      }
      .bar {
        height: 100%;
        background: linear-gradient(90deg, rgba(96,165,250,0.95), rgba(167,139,250,0.95));
        width: 0%;
      }
      .list { display: grid; gap: 10px; }
      .item {
        padding: 12px; border-radius: 14px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.10);
      }
      .item h3 { margin: 0; font-size: 13px; }
      .item p { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 10px 12px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.06);
        color: var(--text); font-size: 12px;
      }
      .btn.primary {
        background: linear-gradient(135deg, rgba(96,165,250,0.95), rgba(167,139,250,0.95));
        border-color: rgba(255,255,255,0.18);
      }
      .footer { margin-top: 14px; color: var(--muted2); font-size: 12px; text-align: center; }
      @media (max-width: 980px) {
        .kpi { grid-column: span 6; }
        .left, .right { grid-column: span 12; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="topbar">
        <div class="brand">
          <div class="logo" aria-hidden="true"></div>
          <div style="min-width:0">
            <h1>{{ brand }}</h1>
            <p>{{ subtitle }} · {{ period.start }} - {{ period.end }}</p>
          </div>
        </div>
        <div class="pill">
          <span>👤 {{ user.name }}</span>
          <span style="opacity:0.7">|</span>
          <span>{{ user.roleLabel }}</span>
        </div>
      </div>

      <div class="grid kpis">
        {% for kpi in kpis %}
          <div class="card kpi">
            <div class="label">{{ kpi.label }}</div>
            <div class="value">{{ kpi.value }}</div>
            <div class="meta">
              {% if kpi.trend == "up" %}
                <div class="delta up">▲ {{ kpi.delta }}</div>
              {% else %}
                <div class="delta down">▼ {{ kpi.delta }}</div>
              {% endif %}
              <div style="color:var(--muted2); font-size:12px">{{ kpi.note }}</div>
            </div>
          </div>
        {% endfor %}
      </div>

      <div class="grid main">
        <div class="card left">
          <p class="section-title">最近任务</p>
          <table class="table">
            <thead>
              <tr>
                <th style="width:34%">任务</th>
                <th style="width:18%">负责人</th>
                <th style="width:18%">状态</th>
                <th style="width:18%">截止</th>
                <th style="width:12%">进度</th>
              </tr>
            </thead>
            <tbody>
              {% for it in items %}
                <tr>
                  <td>
                    <div style="font-weight:600; color:rgba(255,255,255,0.92)">{{ it.name }}</div>
                    <div style="color:var(--muted2); font-size:12px; margin-top:4px">{{ it.summary }}</div>
                  </td>
                  <td style="color:var(--muted)">{{ it.owner }}</td>
                  <td>
                    {% if it.status == "ok" %}
                      <span class="status ok"><span class="dot"></span>正常</span>
                    {% elif it.status == "warning" %}
                      <span class="status warning"><span class="dot"></span>注意</span>
                    {% else %}
                      <span class="status blocked"><span class="dot"></span>阻塞</span>
                    {% endif %}
                  </td>
                  <td style="color:var(--muted)">{{ it.dueDate }}</td>
                  <td>
                    <div class="progress" title="{{ it.progress }}%">
                      <div class="bar" style="width: {{ it.progress }}%"></div>
                    </div>
                  </td>
                </tr>
              {% endfor %}
            </tbody>
          </table>

          <div class="actions">
            {% for link in links %}
              <a class="btn {% if link.primary %}primary{% endif %}" href="{{ link.url }}" target="_blank" rel="noreferrer">
                {{ link.label }}
              </a>
            {% endfor %}
          </div>
        </div>

        <div class="card right">
          <p class="section-title">重点摘要</p>
          <div class="list">
            {% for h in highlights %}
              <div class="item">
                <h3>{{ h.title }}</h3>
                <p>{{ h.desc }}</p>
              </div>
            {% endfor %}
          </div>

          {% if note %}
            <div class="item" style="margin-top: 12px; background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.20)">
              <h3>提示</h3>
              <p>{{ note }}</p>
            </div>
          {% endif %}
        </div>
      </div>

      <div class="footer">{{ footerNote }}</div>
    </div>
  </body>
</html>$$,
  $${
  "title": "周报概览",
  "brand": "SXFG 运营中心",
  "subtitle": "现代化模板示例（gonja / Jinja2 语法）",
  "period": { "start": "2026-03-24", "end": "2026-03-30" },
  "user": { "name": "默认管理员", "roleLabel": "管理员" },
  "kpis": [
    { "label": "活跃工作流", "value": "18", "delta": "+12%", "trend": "up", "note": "较上周" },
    { "label": "成功执行", "value": "3,482", "delta": "+6%", "trend": "up", "note": "较上周" },
    { "label": "失败率", "value": "0.42%", "delta": "-0.08%", "trend": "down", "note": "较上周" },
    { "label": "平均耗时", "value": "187ms", "delta": "-14ms", "trend": "down", "note": "较上周" }
  ],
  "items": [
    { "name": "工作流发布窗口", "summary": "统一发布策略与回滚流程", "owner": "平台组", "status": "ok", "dueDate": "2026-04-02", "progress": 72 },
    { "name": "通知模版迁移", "summary": "迁移历史模版并补齐预览上下文", "owner": "业务组", "status": "warning", "dueDate": "2026-04-05", "progress": 45 },
    { "name": "运行时告警治理", "summary": "梳理高频告警，降低误报", "owner": "SRE", "status": "blocked", "dueDate": "2026-04-08", "progress": 18 }
  ],
  "highlights": [
    { "title": "本周完成", "desc": "模板管理（CRUD）已上线，支持新增/编辑实时预览与管理员权限控制。" },
    { "title": "风险与阻塞", "desc": "运行态告警有重复噪声，建议按错误码聚合并加阈值策略。" },
    { "title": "下周计划", "desc": "补齐模板变量约定（schema）与常用上下文注入（如用户/工作流信息）。" }
  ],
  "links": [
    { "label": "打开控制台", "url": "http://localhost:325/app", "primary": true },
    { "label": "模板配置", "url": "http://localhost:325/app/templates", "primary": false },
    { "label": "工作流配置", "url": "http://localhost:325/app/workflows", "primary": false }
  ],
  "note": "这是演示模板：通过 {% for %} / {% if %} 组合，呈现现代化布局与数据驱动渲染。",
  "footerNote": "生成时间：2026-03-30 · 仅用于演示"
}$$::jsonb,
  $1,
  $1,
  1,
  1
)
	ON CONFLICT (template_key) DO NOTHING
	`, now)
	if err != nil {
		return fmt.Errorf("seed template: %w", err)
	}

	// admission template (modern + minimal)
	_, err = conn.ExecContext(ctx, `
	INSERT INTO template (template_key, name, description, engine, output_type, status, content, default_context_json, created_at, updated_at, created_by, updated_by)
	VALUES (
	  'admission-template-modern',
	  '准入结果模板（精简）',
	  '准入结果/命中规则展示（精简样式）',
	  'jinja2',
	  'html',
	  'active',
	  $$<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{% if title is defined and title %}{{ title }}{% else %}准入结果{% endif %}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto}
    body{min-height:100vh;display:grid;place-items:center;background:#f8fafc;padding:24px}
    .clean{max-width:680px;width:100%;background:white;border-radius:28px;padding:36px}
    .state{font-size:24px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:10px}
    .allow{color:#059669}
    .deny{color:#dc2626}
    .msg{font-size:16px;color:#475569;margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid #e2e8f0}
    .rule-item{padding:20px;border-radius:18px;background:#fafafa;margin-bottom:14px}
    .rule-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    .rule-no{font-weight:700;color:#1e293b;font-size:16px}
    .rule-level{padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600}
    .level-hard{background:#fef2f2;color:#dc2626}
    .level-guidance{background:#fffbeb;color:#d97706}
    .rule-text{font-size:15px;color:#1e293b;margin-bottom:8px;line-height:1.5}
    .rule-meta{font-size:13px;color:#64748b;display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}
    .meta-label{color:#94a3b8}
  </style>
</head>
<body>
  {% set _passed = false %}
  {% if decision is defined %}
    {% if decision == "approve" or decision == "pass" or decision == "allow" %}
      {% set _passed = true %}
    {% endif %}
  {% endif %}

  {% set _message = "" %}
  {% if msg is defined %}{% set _message = msg %}{% endif %}

  {% set _rules = [] %}
  {% if rule is defined %}{% set _rules = rule %}{% endif %}

  <div class="clean">
    {% if _passed %}
      <div class="state allow">✅ 准入</div>
    {% else %}
      <div class="state deny">❌ 未准入</div>
    {% endif %}

    {% if _message %}
      <div class="msg">{{ _message }}</div>
    {% endif %}

    {% if _rules|length > 0 %}
      <div class="rule-list">
        {% for r in _rules %}
          {% if r.level is defined and r.level == "hard" %}
            {% set _no = loop.index %}
            {% if r.no is defined %}{% set _no = r.no %}{% endif %}

            {% set _level = "" %}
            {% if r.level is defined %}{% set _level = r.level %}{% endif %}

            {% set _levelLabel = "" %}
            {% if r.levelLabel is defined %}{% set _levelLabel = r.levelLabel %}{% endif %}

            {% set _text = "" %}
            {% if r.rule is defined %}{% set _text = r.rule %}{% endif %}

            {% set _group = "" %}
            {% if r.group is defined %}{% set _group = r.group %}{% endif %}

            {% set _category = "" %}
            {% if r.category is defined %}{% set _category = r.category %}{% endif %}

            {% set _remark = "" %}
            {% if r.remark is defined %}{% set _remark = r.remark %}{% endif %}

            <div class="rule-item">
              <div class="rule-header">
                <div class="rule-no">规则 #{{ _no }}</div>

                {% if _levelLabel %}
                  {% set _tag = _levelLabel %}
                {% elif _level == "hard" %}
                  {% set _tag = "硬性规则" %}
                {% elif _level == "guidance" %}
                  {% set _tag = "窗口指导" %}
                {% else %}
                  {% set _tag = "规则" %}
                {% endif %}

                <div class="rule-level {% if _level == 'hard' %}level-hard{% elif _level == 'guidance' %}level-guidance{% endif %}">
                  {{ _tag }}
                </div>
              </div>

              {% if _text %}
                <div class="rule-text">{{ _text }}</div>
              {% endif %}

              {% if _group or _category or _remark %}
                <div class="rule-meta">
                  {% if _group %}<span><span class="meta-label">分组：</span>{{ _group }}</span>{% endif %}
                  {% if _category %}<span><span class="meta-label">分类：</span>{{ _category }}</span>{% endif %}
                  {% if _remark %}<span><span class="meta-label">备注：</span>{{ _remark }}</span>{% endif %}
                </div>
              {% endif %}
            </div>
          {% endif %}
        {% endfor %}

        {% for r in _rules %}
          {% if r.level is defined and r.level == "guidance" %}
            {% set _no = loop.index %}
            {% if r.no is defined %}{% set _no = r.no %}{% endif %}

            {% set _level = "" %}
            {% if r.level is defined %}{% set _level = r.level %}{% endif %}

            {% set _levelLabel = "" %}
            {% if r.levelLabel is defined %}{% set _levelLabel = r.levelLabel %}{% endif %}

            {% set _text = "" %}
            {% if r.rule is defined %}{% set _text = r.rule %}{% endif %}

            {% set _group = "" %}
            {% if r.group is defined %}{% set _group = r.group %}{% endif %}

            {% set _category = "" %}
            {% if r.category is defined %}{% set _category = r.category %}{% endif %}

            {% set _remark = "" %}
            {% if r.remark is defined %}{% set _remark = r.remark %}{% endif %}

            <div class="rule-item">
              <div class="rule-header">
                <div class="rule-no">规则 #{{ _no }}</div>

                {% if _levelLabel %}
                  {% set _tag = _levelLabel %}
                {% elif _level == "hard" %}
                  {% set _tag = "硬性规则" %}
                {% elif _level == "guidance" %}
                  {% set _tag = "窗口指导" %}
                {% else %}
                  {% set _tag = "规则" %}
                {% endif %}

                <div class="rule-level {% if _level == 'hard' %}level-hard{% elif _level == 'guidance' %}level-guidance{% endif %}">
                  {{ _tag }}
                </div>
              </div>

              {% if _text %}
                <div class="rule-text">{{ _text }}</div>
              {% endif %}

              {% if _group or _category or _remark %}
                <div class="rule-meta">
                  {% if _group %}<span><span class="meta-label">分组：</span>{{ _group }}</span>{% endif %}
                  {% if _category %}<span><span class="meta-label">分类：</span>{{ _category }}</span>{% endif %}
                  {% if _remark %}<span><span class="meta-label">备注：</span>{{ _remark }}</span>{% endif %}
                </div>
              {% endif %}
            </div>
          {% endif %}
        {% endfor %}

        {% for r in _rules %}
          {% if r.level is not defined or r.level != "hard" and r.level != "guidance" %}
            {% set _no = loop.index %}
            {% if r.no is defined %}{% set _no = r.no %}{% endif %}

            {% set _level = "" %}
            {% if r.level is defined %}{% set _level = r.level %}{% endif %}

            {% set _levelLabel = "" %}
            {% if r.levelLabel is defined %}{% set _levelLabel = r.levelLabel %}{% endif %}

            {% set _text = "" %}
            {% if r.rule is defined %}{% set _text = r.rule %}{% endif %}

            {% set _group = "" %}
            {% if r.group is defined %}{% set _group = r.group %}{% endif %}

            {% set _category = "" %}
            {% if r.category is defined %}{% set _category = r.category %}{% endif %}

            {% set _remark = "" %}
            {% if r.remark is defined %}{% set _remark = r.remark %}{% endif %}

            <div class="rule-item">
              <div class="rule-header">
                <div class="rule-no">规则 #{{ _no }}</div>

                {% if _levelLabel %}
                  {% set _tag = _levelLabel %}
                {% elif _level == "hard" %}
                  {% set _tag = "硬性规则" %}
                {% elif _level == "guidance" %}
                  {% set _tag = "窗口指导" %}
                {% else %}
                  {% set _tag = "规则" %}
                {% endif %}

                <div class="rule-level {% if _level == 'hard' %}level-hard{% elif _level == 'guidance' %}level-guidance{% endif %}">
                  {{ _tag }}
                </div>
              </div>

              {% if _text %}
                <div class="rule-text">{{ _text }}</div>
              {% endif %}

              {% if _group or _category or _remark %}
                <div class="rule-meta">
                  {% if _group %}<span><span class="meta-label">分组：</span>{{ _group }}</span>{% endif %}
                  {% if _category %}<span><span class="meta-label">分类：</span>{{ _category }}</span>{% endif %}
                  {% if _remark %}<span><span class="meta-label">备注：</span>{{ _remark }}</span>{% endif %}
                </div>
              {% endif %}
            </div>
          {% endif %}
        {% endfor %}
      </div>
    {% endif %}
  </div>
</body>
</html>$$,
	  $${
	  "title": "准入结果",
	  "decision": "reject",
	  "msg": "不通过准入：触发2条硬性规则",
	  "rule": [
	    { "category": "集团制度", "group": "发行主体\\n所在区域", "hit": true, "level": "hard", "no": 1, "ok": false, "remark": "以预警通信息为准", "rule": "地级市一般预算收入低于50亿元" },
	    { "category": "评审部窗口指导", "group": "", "hit": true, "level": "guidance", "no": 2, "ok": false, "remark": "以预警通信息为准", "rule": "区县级一般预算收入低于20亿元" },
	    { "category": "集团制度", "group": "", "hit": true, "level": "hard", "no": 9, "ok": false, "remark": "底层资产符合要求的资产证券化业务不适用", "rule": "申请人持续经营时间未满1年（若申请人核心子公司持续经营超过1年，可予以豁免）" }
	  ]
	}$$::jsonb,
	  $1,
	  $1,
	  1,
	  1
	)
	ON CONFLICT (template_key) DO UPDATE SET
	  name = EXCLUDED.name,
	  description = EXCLUDED.description,
	  engine = EXCLUDED.engine,
	  output_type = EXCLUDED.output_type,
	  status = EXCLUDED.status,
	  content = EXCLUDED.content,
	  default_context_json = EXCLUDED.default_context_json,
	  updated_at = EXCLUDED.updated_at,
	  updated_by = EXCLUDED.updated_by
	`, now)
	if err != nil {
		return fmt.Errorf("seed admission template: %w", err)
	}

	// demo workflow
	defaultDSL := map[string]any{
		"nodes": []any{
			map[string]any{
				"id":       "start",
				"type":     "custom",
				"position": map[string]any{"x": 80, "y": 200},
				"data": map[string]any{
					"title": "开始",
					"type":  "start",
					"config": map[string]any{
						"variables": []any{},
					},
				},
			},
		},
		"edges":    []any{},
		"viewport": map[string]any{"x": 0, "y": 0, "zoom": 1},
	}
	defaultDSLBytes, _ := json.Marshal(defaultDSL)

	var workflowID int64
	err = conn.QueryRowContext(ctx, `
INSERT INTO workflow (
  workflow_key, name, description, menu_key, status,
  current_draft_version_no, current_published_version_no,
  breaker_window_minutes, breaker_max_requests,
  dsl_json, created_at, updated_at, created_by, updated_by
) VALUES (
  'demo_workflow', '示例工作流', '默认初始化工作流', 'reserve', 'active',
  1, 0,
  1, 5,
  $1::jsonb, $2, $2, 0, 0
)
ON CONFLICT (workflow_key) DO UPDATE SET updated_at = EXCLUDED.updated_at
RETURNING id
`, string(defaultDSLBytes), now).Scan(&workflowID)
	if err != nil {
		return fmt.Errorf("seed workflow: %w", err)
	}

	_, err = conn.ExecContext(ctx, `
INSERT INTO workflow_version (workflow_id, version_no, dsl_json, created_at, updated_at)
VALUES ($1, 1, $2::jsonb, $3, $3)
ON CONFLICT (workflow_id, version_no) DO NOTHING
`, workflowID, string(defaultDSLBytes), now)
	if err != nil {
		return fmt.Errorf("seed workflow version: %w", err)
	}

	return nil
}

func seedAdminDivisions(ctx context.Context, conn *sql.DB, now time.Time) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("seed admin divisions begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx, `
INSERT INTO admin_division (code, name, level, indent, parent_code, created_at, updated_at, created_by, updated_by)
VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $6, 1, 1)
ON CONFLICT (code) DO NOTHING
`)
	if err != nil {
		return fmt.Errorf("seed admin divisions prepare: %w", err)
	}
	defer func() { _ = stmt.Close() }()

	for _, row := range admindivisiondata.Rows {
		if _, execErr := stmt.ExecContext(ctx, row.Code, row.Name, row.Level, row.Indent, row.ParentCode, now); execErr != nil {
			return fmt.Errorf("seed admin divisions row %s: %w", row.Code, execErr)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("seed admin divisions commit: %w", err)
	}
	return nil
}
