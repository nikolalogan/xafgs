package workflowruntime

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

type PostgresExecutionStore struct {
	db *sql.DB
}

func NewPostgresExecutionStore(db *sql.DB) *PostgresExecutionStore {
	return &PostgresExecutionStore{db: db}
}

func (store *PostgresExecutionStore) Save(execution WorkflowExecution) error {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	payload, err := json.Marshal(execution)
	if err != nil {
		return err
	}

	waitingNodeID := ""
	waitingNodeTitle := ""
	waitingSchema := []byte("{}")
	if execution.WaitingInput != nil {
		waitingNodeID = execution.WaitingInput.NodeID
		waitingNodeTitle = execution.WaitingInput.NodeTitle
		if raw, marshalErr := json.Marshal(execution.WaitingInput.Schema); marshalErr == nil {
			waitingSchema = raw
		}
	}

	_, err = store.db.ExecContext(ctx, `
INSERT INTO workflow_execution_task (
  execution_id, workflow_id, workflow_name, menu_key, starter_user_id,
  status, waiting_node_id, waiting_node_title, waiting_schema_json,
  error, payload_json, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::timestamptz, $13::timestamptz)
ON CONFLICT (execution_id)
DO UPDATE SET
  workflow_id = EXCLUDED.workflow_id,
  workflow_name = EXCLUDED.workflow_name,
  menu_key = EXCLUDED.menu_key,
  starter_user_id = EXCLUDED.starter_user_id,
  status = EXCLUDED.status,
  waiting_node_id = EXCLUDED.waiting_node_id,
  waiting_node_title = EXCLUDED.waiting_node_title,
  waiting_schema_json = EXCLUDED.waiting_schema_json,
  error = EXCLUDED.error,
  payload_json = EXCLUDED.payload_json,
  updated_at = EXCLUDED.updated_at
`, execution.ID, execution.WorkflowID, execution.WorkflowName, execution.MenuKey, execution.StarterUserID, string(execution.Status), waitingNodeID, waitingNodeTitle, string(waitingSchema), execution.Error, string(payload), parseISOOrNow(execution.CreatedAt), parseISOOrNow(execution.UpdatedAt))
	return err
}

func (store *PostgresExecutionStore) Get(executionID string) (*WorkflowExecution, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var payload string
	err := store.db.QueryRowContext(ctx, `
SELECT payload_json::text
FROM workflow_execution_task
WHERE execution_id = $1
LIMIT 1
`, strings.TrimSpace(executionID)).Scan(&payload)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	var execution WorkflowExecution
	if err := json.Unmarshal([]byte(payload), &execution); err != nil {
		return nil, err
	}
	return &execution, nil
}

func (store *PostgresExecutionStore) List(filter ExecutionListFilter) (ExecutionListResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	page := filter.Page
	pageSize := filter.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		pageSize = 200
	}

	conditions := []string{"1=1"}
	args := make([]any, 0, 6)
	argIndex := 1

	status := strings.TrimSpace(filter.Status)
	if status != "" {
		conditions = append(conditions, "status = $"+strconv.Itoa(argIndex))
		args = append(args, status)
		argIndex++
	}
	if filter.WorkflowID > 0 {
		conditions = append(conditions, "workflow_id = $"+strconv.Itoa(argIndex))
		args = append(args, filter.WorkflowID)
		argIndex++
	}
	menuKey := strings.TrimSpace(filter.MenuKey)
	if menuKey != "" {
		conditions = append(conditions, "menu_key = $"+strconv.Itoa(argIndex))
		args = append(args, menuKey)
		argIndex++
	}
	if filter.StarterUserID > 0 {
		conditions = append(conditions, "starter_user_id = $"+strconv.Itoa(argIndex))
		args = append(args, filter.StarterUserID)
		argIndex++
	}
	keyword := strings.TrimSpace(filter.Keyword)
	if keyword != "" {
		conditions = append(conditions, "(workflow_name ILIKE $"+strconv.Itoa(argIndex)+" OR execution_id ILIKE $"+strconv.Itoa(argIndex)+")")
		args = append(args, "%"+keyword+"%")
		argIndex++
	}

	whereClause := strings.Join(conditions, " AND ")
	var total int64
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(1) FROM workflow_execution_task WHERE "+whereClause, args...).Scan(&total); err != nil {
		return ExecutionListResult{}, err
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, pageSize, (page-1)*pageSize)
	rows, err := store.db.QueryContext(ctx, `
SELECT execution_id, workflow_id, workflow_name, menu_key, starter_user_id,
       status, waiting_node_id, waiting_node_title, error, created_at, updated_at
FROM workflow_execution_task
WHERE `+whereClause+`
ORDER BY created_at DESC
LIMIT $`+strconv.Itoa(argIndex)+` OFFSET $`+strconv.Itoa(argIndex+1), listArgs...)
	if err != nil {
		return ExecutionListResult{}, err
	}
	defer rows.Close()

	items := make([]WorkflowExecutionSummary, 0)
	for rows.Next() {
		var summary WorkflowExecutionSummary
		var statusText string
		var createdAt time.Time
		var updatedAt time.Time
		if err := rows.Scan(
			&summary.ID,
			&summary.WorkflowID,
			&summary.WorkflowName,
			&summary.MenuKey,
			&summary.StarterUserID,
			&statusText,
			&summary.WaitingNodeID,
			&summary.WaitingTitle,
			&summary.Error,
			&createdAt,
			&updatedAt,
		); err != nil {
			continue
		}
		summary.Status = ExecutionStatus(statusText)
		summary.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		summary.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		items = append(items, summary)
	}

	return ExecutionListResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

func parseISOOrNow(raw string) time.Time {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return time.Now().UTC()
	}
	return parsed.UTC()
}
