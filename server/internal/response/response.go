package response

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/model"
)

const (
	CodeSuccess         = "SUCCESS"
	CodeBadRequest      = "BAD_REQUEST"
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeForbidden       = "FORBIDDEN"
	CodeNotFound        = "NOT_FOUND"
	CodeTooManyRequests = "TOO_MANY_REQUESTS"
	CodeInternal        = "INTERNAL_ERROR"
)

func Success(c *fiber.Ctx, httpStatus int, data any, message string) error {
	return c.Status(httpStatus).JSON(model.APIResponse{
		StatusCode: httpStatus,
		Code:       CodeSuccess,
		Message:    message,
		Data:       data,
		RequestID:  requestID(c),
		Timestamp:  time.Now().Format(time.RFC3339),
	})
}

func Error(c *fiber.Ctx, httpStatus int, code, message string) error {
	return c.Status(httpStatus).JSON(model.APIResponse{
		StatusCode: httpStatus,
		Code:       code,
		Message:    message,
		RequestID:  requestID(c),
		Timestamp:  time.Now().Format(time.RFC3339),
	})
}

func requestID(c *fiber.Ctx) string {
	requestID := c.GetRespHeader(fiber.HeaderXRequestID)
	if requestID != "" {
		return requestID
	}
	value := c.Locals("requestid")
	if value == nil {
		return ""
	}
	requestID, ok := value.(string)
	if !ok {
		return ""
	}
	return requestID
}
