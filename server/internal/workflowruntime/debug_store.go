package workflowruntime

import (
	"errors"
	"sync"
)

type DebugSessionStorePort interface {
	Save(session WorkflowDebugSession) error
	Get(sessionID string) (*WorkflowDebugSession, error)
}

type InMemoryDebugSessionStore struct {
	mu      sync.RWMutex
	records map[string]WorkflowDebugSession
}

func NewInMemoryDebugSessionStore() *InMemoryDebugSessionStore {
	return &InMemoryDebugSessionStore{
		records: map[string]WorkflowDebugSession{},
	}
}

func (store *InMemoryDebugSessionStore) Save(session WorkflowDebugSession) error {
	if session.ID == "" {
		return errors.New("debug session id 不能为空")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.records[session.ID] = cloneDebugSessionSnapshot(session)
	return nil
}

func (store *InMemoryDebugSessionStore) Get(sessionID string) (*WorkflowDebugSession, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	value, ok := store.records[sessionID]
	if !ok {
		return nil, nil
	}
	cloned := cloneDebugSessionSnapshot(value)
	return &cloned, nil
}

func cloneDebugSessionSnapshot(source WorkflowDebugSession) WorkflowDebugSession {
	cloned := source
	cloned.NodeStates = cloneNodeStates(source.NodeStates)
	cloned.WorkflowParametersSnapshot = append([]WorkflowParameter{}, source.WorkflowParametersSnapshot...)
	if variables, cycle := cloneMapForRuntimeJSON(source.Variables, map[uintptr]struct{}{}, map[uintptr]struct{}{}); !cycle && variables != nil {
		cloned.Variables = variables
	} else {
		cloned.Variables = cloneMap(source.Variables)
	}
	if lastInput, cycle := cloneMapForRuntimeJSON(source.LastTargetInput, map[uintptr]struct{}{}, map[uintptr]struct{}{}); !cycle && lastInput != nil {
		cloned.LastTargetInput = lastInput
	} else {
		cloned.LastTargetInput = cloneMap(source.LastTargetInput)
	}
	if lastOutput, cycle := cloneMapForRuntimeJSON(source.LastTargetOutput, map[uintptr]struct{}{}, map[uintptr]struct{}{}); !cycle && lastOutput != nil {
		cloned.LastTargetOutput = lastOutput
	} else {
		cloned.LastTargetOutput = cloneMap(source.LastTargetOutput)
	}
	if len(source.LastWritebacks) > 0 {
		cloned.LastWritebacks = append([]Writeback{}, source.LastWritebacks...)
	}
	if source.WaitingInput != nil {
		waitingCopy := *source.WaitingInput
		waitingCopy.Schema = cloneMap(source.WaitingInput.Schema)
		cloned.WaitingInput = &waitingCopy
	}
	return cloned
}
