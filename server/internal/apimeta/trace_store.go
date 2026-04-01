package apimeta

import (
	"strings"
	"sync"
	"time"
)

type Trace struct {
	Timestamp  string            `json:"timestamp"`
	RequestID  string            `json:"requestId,omitempty"`
	UserID     any               `json:"userId,omitempty"`
	Method     string            `json:"method"`
	RoutePath  string            `json:"routePath"`
	Path       string            `json:"path"`
	Query      map[string]string `json:"query,omitempty"`
	StatusCode int               `json:"statusCode"`
	DurationMs int64             `json:"durationMs"`
	Request    any               `json:"request,omitempty"`
	Response   any               `json:"response,omitempty"`
}

type TraceStore struct {
	mu     sync.RWMutex
	limit  int
	traces []Trace
	cursor int
	size   int
}

func NewTraceStore(limit int) *TraceStore {
	if limit <= 0 {
		limit = 200
	}
	return &TraceStore{
		limit:  limit,
		traces: make([]Trace, limit),
	}
}

func (store *TraceStore) Add(trace Trace) {
	store.mu.Lock()
	defer store.mu.Unlock()
	trace.Timestamp = strings.TrimSpace(trace.Timestamp)
	if trace.Timestamp == "" {
		trace.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	store.traces[store.cursor] = trace
	store.cursor = (store.cursor + 1) % store.limit
	if store.size < store.limit {
		store.size++
	}
}

func (store *TraceStore) List(routeMethod, routePath string, limit int) []Trace {
	store.mu.RLock()
	defer store.mu.RUnlock()

	if limit <= 0 || limit > 50 {
		limit = 10
	}

	normalizedMethod := strings.ToUpper(strings.TrimSpace(routeMethod))
	normalizedPath := strings.TrimSpace(routePath)

	out := make([]Trace, 0, limit)
	if store.size == 0 {
		return out
	}

	for i := 0; i < store.size && len(out) < limit; i++ {
		index := store.cursor - 1 - i
		if index < 0 {
			index += store.limit
		}
		trace := store.traces[index]
		if normalizedMethod != "" && strings.ToUpper(trace.Method) != normalizedMethod {
			continue
		}
		if normalizedPath != "" && trace.RoutePath != normalizedPath {
			continue
		}
		out = append(out, trace)
	}
	return out
}

