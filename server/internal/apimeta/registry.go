package apimeta

import (
	"sort"
	"strings"
	"sync"
)

type Registry struct {
	mu     sync.RWMutex
	routes map[string]APIRouteDoc
	Prefix string
}

func NewRegistry(prefix string) *Registry {
	return &Registry{
		routes: make(map[string]APIRouteDoc),
		Prefix: strings.TrimRight(strings.TrimSpace(prefix), "/"),
	}
}

func routeKey(method, path string) string {
	return strings.ToUpper(strings.TrimSpace(method)) + " " + strings.TrimSpace(path)
}

func (registry *Registry) Upsert(doc APIRouteDoc) {
	if registry == nil {
		return
	}
	key := routeKey(doc.Method, doc.Path)
	if strings.TrimSpace(key) == "" {
		return
	}

	registry.mu.Lock()
	defer registry.mu.Unlock()
	registry.routes[key] = doc
}

func (registry *Registry) List() []APIRouteDoc {
	if registry == nil {
		return nil
	}
	registry.mu.RLock()
	defer registry.mu.RUnlock()

	out := make([]APIRouteDoc, 0, len(registry.routes))
	for _, route := range registry.routes {
		out = append(out, route)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path == out[j].Path {
			return out[i].Method < out[j].Method
		}
		return out[i].Path < out[j].Path
	})
	return out
}
