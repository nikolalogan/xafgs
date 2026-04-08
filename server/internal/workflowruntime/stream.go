package workflowruntime

import "sync"

type executionStreamHub struct {
	mu          sync.RWMutex
	nextID      int
	subscribers map[string]map[int]chan WorkflowExecution
}

func newExecutionStreamHub() *executionStreamHub {
	return &executionStreamHub{
		subscribers: map[string]map[int]chan WorkflowExecution{},
	}
}

func (hub *executionStreamHub) Subscribe(executionID string) (<-chan WorkflowExecution, func()) {
	hub.mu.Lock()
	defer hub.mu.Unlock()

	hub.nextID++
	subscriberID := hub.nextID
	ch := make(chan WorkflowExecution, 1)
	if hub.subscribers[executionID] == nil {
		hub.subscribers[executionID] = map[int]chan WorkflowExecution{}
	}
	hub.subscribers[executionID][subscriberID] = ch

	unsubscribe := func() {
		hub.mu.Lock()
		defer hub.mu.Unlock()

		group := hub.subscribers[executionID]
		if group == nil {
			return
		}
		subscriber, ok := group[subscriberID]
		if !ok {
			return
		}
		delete(group, subscriberID)
		close(subscriber)
		if len(group) == 0 {
			delete(hub.subscribers, executionID)
		}
	}

	return ch, unsubscribe
}

func (hub *executionStreamHub) Publish(execution WorkflowExecution) {
	hub.mu.RLock()
	group := hub.subscribers[execution.ID]
	if len(group) == 0 {
		hub.mu.RUnlock()
		return
	}

	targets := make([]chan WorkflowExecution, 0, len(group))
	for _, subscriber := range group {
		targets = append(targets, subscriber)
	}
	hub.mu.RUnlock()

	for _, subscriber := range targets {
		select {
		case subscriber <- execution:
		default:
			select {
			case <-subscriber:
			default:
			}
			select {
			case subscriber <- execution:
			default:
			}
		}
	}
}
