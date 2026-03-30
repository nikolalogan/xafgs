CREATE TABLE workflow (
  id BIGINT PRIMARY KEY,
  workflow_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  current_draft_version_id BIGINT NULL,
  current_published_version_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_version (
  id BIGINT PRIMARY KEY,
  workflow_id BIGINT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
  dsl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version_no),
  CHECK (jsonb_typeof(dsl_json) = 'object'),
  CHECK (jsonb_typeof(dsl_json->'nodes') = 'array'),
  CHECK (jsonb_array_length(dsl_json->'nodes') > 0),
  CHECK ((NOT (dsl_json ? 'edges')) OR jsonb_typeof(dsl_json->'edges') = 'array'),
  CHECK ((NOT (dsl_json ? 'globalVariables')) OR jsonb_typeof(dsl_json->'globalVariables') = 'array'),
  CHECK ((NOT (dsl_json ? 'workflowParameters')) OR jsonb_typeof(dsl_json->'workflowParameters') = 'array'),
  CHECK ((NOT (dsl_json ? 'workflowVariableScopes')) OR jsonb_typeof(dsl_json->'workflowVariableScopes') = 'object'),
  CHECK ((NOT (dsl_json ? 'viewport')) OR jsonb_typeof(dsl_json->'viewport') = 'object')
);

ALTER TABLE workflow
  ADD CONSTRAINT fk_workflow_current_draft_version
  FOREIGN KEY (current_draft_version_id) REFERENCES workflow_version(id);

ALTER TABLE workflow
  ADD CONSTRAINT fk_workflow_current_published_version
  FOREIGN KEY (current_published_version_id) REFERENCES workflow_version(id);

CREATE INDEX idx_workflow_status ON workflow(status);
CREATE INDEX idx_workflow_version_workflow_state ON workflow_version(workflow_id, state);
CREATE INDEX idx_workflow_version_dsl_gin ON workflow_version USING GIN (dsl_json jsonb_path_ops);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflow_set_updated_at ON workflow;
CREATE TRIGGER trg_workflow_set_updated_at
BEFORE UPDATE ON workflow
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_version_set_updated_at ON workflow_version;
CREATE TRIGGER trg_workflow_version_set_updated_at
BEFORE UPDATE ON workflow_version
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
