package workflowruntime

import (
	"context"
	"encoding/json"
	"log"
	"time"
)

type contextKey string

const (
	contextKeyRequestID contextKey = "requestId"
	contextKeyAuthHeader contextKey = "authHeader"
)

func WithRequestID(ctx context.Context, requestID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if requestID == "" {
		return ctx
	}
	return context.WithValue(ctx, contextKeyRequestID, requestID)
}

func requestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value := ctx.Value(contextKeyRequestID)
	if value == nil {
		return ""
	}
	requestID, ok := value.(string)
	if !ok {
		return ""
	}
	return requestID
}

func WithAuthHeader(ctx context.Context, authorizationHeader string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	trimmed := authorizationHeader
	if trimmed == "" {
		return ctx
	}
	return context.WithValue(ctx, contextKeyAuthHeader, trimmed)
}

func authHeaderFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value := ctx.Value(contextKeyAuthHeader)
	if value == nil {
		return ""
	}
	auth, ok := value.(string)
	if !ok {
		return ""
	}
	return auth
}

func writeWorkflowLog(payload map[string]any) {
	if payload == nil {
		return
	}
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	payload["type"] = "workflow_log"

	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("{\"type\":\"workflow_log\",\"marshalError\":\"%s\"}", err.Error())
		return
	}
	log.Println(string(raw))
}
