package workflowruntime

import "sync"

type ExecutionStorePort interface {
	Save(execution WorkflowExecution) error
	Get(executionID string) (*WorkflowExecution, error)
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

