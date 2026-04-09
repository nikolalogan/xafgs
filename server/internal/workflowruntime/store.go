package workflowruntime

import (
	"sort"
	"strings"
	"sync"
)

type ExecutionStorePort interface {
	Save(execution WorkflowExecution) error
	Get(executionID string) (*WorkflowExecution, error)
	List(filter ExecutionListFilter) (ExecutionListResult, error)
}

type InMemoryExecutionStore struct {
	mu      sync.RWMutex
	records map[string]WorkflowExecution
}

func NewInMemoryExecutionStore() *InMemoryExecutionStore {
	return &InMemoryExecutionStore{
		records: map[string]WorkflowExecution{},
	}
}

func (store *InMemoryExecutionStore) Save(execution WorkflowExecution) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.records[execution.ID] = execution
	return nil
}

func (store *InMemoryExecutionStore) Get(executionID string) (*WorkflowExecution, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	value, ok := store.records[executionID]
	if !ok {
		return nil, nil
	}
	copied := value
	return &copied, nil
}

func (store *InMemoryExecutionStore) List(filter ExecutionListFilter) (ExecutionListResult, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()

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

	status := strings.TrimSpace(filter.Status)
	menuKey := strings.TrimSpace(filter.MenuKey)
	keyword := strings.ToLower(strings.TrimSpace(filter.Keyword))

	items := make([]WorkflowExecutionSummary, 0, len(store.records))
	for _, execution := range store.records {
		if status != "" && string(execution.Status) != status {
			continue
		}
		if filter.WorkflowID > 0 && execution.WorkflowID != filter.WorkflowID {
			continue
		}
		if menuKey != "" && execution.MenuKey != menuKey {
			continue
		}
		if filter.StarterUserID > 0 && execution.StarterUserID != filter.StarterUserID {
			continue
		}
		if keyword != "" {
			target := strings.ToLower(execution.ID + " " + execution.WorkflowName)
			if !strings.Contains(target, keyword) {
				continue
			}
		}

		summary := WorkflowExecutionSummary{
			ID:            execution.ID,
			WorkflowID:    execution.WorkflowID,
			WorkflowName:  execution.WorkflowName,
			MenuKey:       execution.MenuKey,
			StarterUserID: execution.StarterUserID,
			Status:        execution.Status,
			Error:         execution.Error,
			CreatedAt:     execution.CreatedAt,
			UpdatedAt:     execution.UpdatedAt,
		}
		if execution.WaitingInput != nil {
			summary.WaitingNodeID = execution.WaitingInput.NodeID
			summary.WaitingTitle = execution.WaitingInput.NodeTitle
		}
		items = append(items, summary)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})
	total := int64(len(items))
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}

	paged := make([]WorkflowExecutionSummary, 0, end-start)
	if start < end {
		paged = append(paged, items[start:end]...)
	}
	return ExecutionListResult{
		Items:    paged,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}
