package apimeta

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/response"
)

type RouteSpec[T any] struct {
	Method    string
	Path      string
	Summary   string
	Auth      string
	Responses []APIResponseSchema
}

func Register[T any](router fiber.Router, registry *Registry, spec RouteSpec[T], handler func(c *fiber.Ctx, request *T) error) {
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	path := strings.TrimSpace(spec.Path)
	if method == "" || path == "" {
		return
	}

	var request T
	docPath := path
	if registry != nil {
		docPath = withPrefix(registry.Prefix, path)
	}
	doc := APIRouteDoc{
		Method:    method,
		Path:      docPath,
		Summary:   strings.TrimSpace(spec.Summary),
		Auth:      strings.TrimSpace(spec.Auth),
		Params:    BuildParamsFromRequest(&request),
		Responses: spec.Responses,
	}
	if len(doc.Responses) == 0 {
		doc.Responses = []APIResponseSchema{
			{
				HTTPStatus:  fiber.StatusOK,
				Code:        response.CodeSuccess,
				ContentType: "application/json",
				Description: "统一响应包装（成功）",
				DataShape:   "model.APIResponse{data:any}",
				Example: map[string]any{
					"statusCode": fiber.StatusOK,
					"code":       response.CodeSuccess,
					"message":    "成功",
					"requestId":  "xxxx-xxxx",
					"timestamp":  "2026-03-31T00:00:00Z",
					"data":       map[string]any{},
				},
			},
			{
				HTTPStatus:  fiber.StatusBadRequest,
				Code:        response.CodeBadRequest,
				ContentType: "application/json",
				Description: "参数校验/业务校验失败",
				Example: map[string]any{
					"statusCode": fiber.StatusBadRequest,
					"code":       response.CodeBadRequest,
					"message":    "请求参数错误",
					"requestId":  "xxxx-xxxx",
					"timestamp":  "2026-03-31T00:00:00Z",
				},
			},
			{
				HTTPStatus:  fiber.StatusUnauthorized,
				Code:        response.CodeUnauthorized,
				ContentType: "application/json",
				Description: "未登录/令牌无效",
				Example: map[string]any{
					"statusCode": fiber.StatusUnauthorized,
					"code":       response.CodeUnauthorized,
					"message":    "未登录或登录已过期",
					"requestId":  "xxxx-xxxx",
					"timestamp":  "2026-03-31T00:00:00Z",
				},
			},
			{
				HTTPStatus:  fiber.StatusForbidden,
				Code:        response.CodeForbidden,
				ContentType: "application/json",
				Description: "无权限访问",
				Example: map[string]any{
					"statusCode": fiber.StatusForbidden,
					"code":       response.CodeForbidden,
					"message":    "无权限访问",
					"requestId":  "xxxx-xxxx",
					"timestamp":  "2026-03-31T00:00:00Z",
				},
			},
			{
				HTTPStatus:  fiber.StatusNotFound,
				Code:        response.CodeNotFound,
				ContentType: "application/json",
				Description: "资源不存在/路由不存在",
				Example: map[string]any{
					"statusCode": fiber.StatusNotFound,
					"code":       response.CodeNotFound,
					"message":    "不存在",
					"requestId":  "xxxx-xxxx",
					"timestamp":  "2026-03-31T00:00:00Z",
				},
			},
			{
				HTTPStatus:  fiber.StatusInternalServerError,
				Code:        response.CodeInternal,
				ContentType: "application/json",
				Description: "服务器内部错误",
				Example: map[string]any{
					"statusCode": fiber.StatusInternalServerError,
					"code":       response.CodeInternal,
					"message":    "服务器内部错误",
					"requestId":  "xxxx-xxxx",
					"timestamp":  "2026-03-31T00:00:00Z",
				},
			},
		}
	}
	if registry != nil {
		registry.Upsert(doc)
	}

	router.Add(method, path, func(c *fiber.Ctx) error {
		var request T
		if err := BindAndValidate(c, &request); err != nil {
			return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, toClientMessage(err))
		}
		return handler(c, &request)
	})
}

func withPrefix(prefix, path string) string {
	normalizedPrefix := strings.TrimRight(strings.TrimSpace(prefix), "/")
	normalizedPath := strings.TrimSpace(path)
	if normalizedPrefix == "" {
		return normalizedPath
	}
	if normalizedPath == "" {
		return normalizedPrefix
	}
	if strings.HasPrefix(normalizedPath, normalizedPrefix+"/") || normalizedPath == normalizedPrefix {
		return normalizedPath
	}
	if !strings.HasPrefix(normalizedPath, "/") {
		normalizedPath = "/" + normalizedPath
	}
	return normalizedPrefix + normalizedPath
}

func toClientMessage(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if errors.Is(err, errValidation) {
		message = strings.TrimPrefix(message, errValidation.Error()+":")
		message = strings.TrimPrefix(message, errValidation.Error()+": ")
		message = strings.TrimSpace(message)
	}
	if message == "" {
		return "请求参数错误"
	}
	return message
}
