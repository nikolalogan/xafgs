package service

import (
	"sync"
	"time"
)

type WorkflowExecutionRateLimiter interface {
	Allow(key string, now time.Time, window time.Duration, maxRequests int) bool
}

type workflowExecutionRateLimiter struct {
	mutex       sync.Mutex
	requestLogs map[string][]time.Time
}

func NewWorkflowExecutionRateLimiter() WorkflowExecutionRateLimiter {
	return &workflowExecutionRateLimiter{
		requestLogs: make(map[string][]time.Time),
	}
}

func (limiter *workflowExecutionRateLimiter) Allow(
	key string,
	now time.Time,
	window time.Duration,
	maxRequests int,
) bool {
	if key == "" || window <= 0 || maxRequests <= 0 {
		return false
	}

	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	startAt := now.Add(-window)
	logs := limiter.requestLogs[key]
	retained := logs[:0]
	for _, loggedAt := range logs {
		if loggedAt.Before(startAt) {
			continue
		}
		retained = append(retained, loggedAt)
	}
	if len(retained) >= maxRequests {
		limiter.requestLogs[key] = retained
		return false
	}

	retained = append(retained, now)
	limiter.requestLogs[key] = retained
	return true
}
