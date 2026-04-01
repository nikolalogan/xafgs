package middleware

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
)

type TraceMiddleware struct {
	store              *apimeta.TraceStore
	maxCaptureBodySize int
}

func NewTraceMiddleware(store *apimeta.TraceStore) *TraceMiddleware {
	return &TraceMiddleware{
		store:              store,
		maxCaptureBodySize: 64 * 1024,
	}
}

func (middleware *TraceMiddleware) Handler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		startTime := time.Now()
		err := c.Next()

		if middleware.store == nil {
			return err
		}

		contentType := strings.ToLower(strings.TrimSpace(string(c.Response().Header.ContentType())))
		if !strings.Contains(contentType, "application/json") {
			return err
		}

		routePath := c.Path()
		if route := c.Route(); route != nil && strings.TrimSpace(route.Path) != "" {
			routePath = route.Path
		}

		trace := apimeta.Trace{
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
			RequestID:  c.GetRespHeader(fiber.HeaderXRequestID),
			Method:     c.Method(),
			RoutePath:  routePath,
			Path:       c.OriginalURL(),
			StatusCode: c.Response().StatusCode(),
			DurationMs: time.Since(startTime).Milliseconds(),
			Query:      make(map[string]string),
		}
		if userID := c.Locals(LocalAuthUserID); userID != nil {
			trace.UserID = userID
		}

		c.Context().QueryArgs().VisitAll(func(key, value []byte) {
			trace.Query[string(key)] = string(value)
		})
		if len(trace.Query) == 0 {
			trace.Query = nil
		}

		if requestBody := c.Body(); len(requestBody) > 0 && len(requestBody) <= middleware.maxCaptureBodySize {
			var requestJSON any
			if json.Unmarshal(requestBody, &requestJSON) == nil {
				trace.Request = requestJSON
			}
		}

		responseBody := c.Response().Body()
		if len(responseBody) > 0 && len(responseBody) <= middleware.maxCaptureBodySize {
			var responseJSON any
			if json.Unmarshal(responseBody, &responseJSON) == nil {
				trace.Response = responseJSON
			}
		}

		middleware.store.Add(trace)
		return err
	}
}

