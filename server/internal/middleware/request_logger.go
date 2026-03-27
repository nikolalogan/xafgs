package middleware

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

func RequestLogger() fiber.Handler {
	return func(c *fiber.Ctx) error {
		startTime := time.Now()
		err := c.Next()

		logData := map[string]any{
			"type":       "request_log",
			"timestamp":  time.Now().Format(time.RFC3339),
			"requestId":  c.GetRespHeader(fiber.HeaderXRequestID),
			"method":     c.Method(),
			"path":       c.Path(),
			"statusCode": c.Response().StatusCode(),
			"durationMs": time.Since(startTime).Milliseconds(),
			"ip":         c.IP(),
			"userAgent":  c.Get(fiber.HeaderUserAgent),
		}

		if userID := c.Locals(LocalAuthUserID); userID != nil {
			logData["userId"] = userID
		}

		logBytes, marshalError := json.Marshal(logData)
		if marshalError != nil {
			log.Printf("{\"type\":\"request_log\",\"marshalError\":\"%s\"}", marshalError.Error())
		} else {
			log.Println(string(logBytes))
		}

		return err
	}
}
