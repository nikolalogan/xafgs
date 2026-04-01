package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/response"
)

type listRoutesRequest struct {
	IncludeTraces *int `query:"includeTraces" validate:"oneof=0 1"`
	TraceLimit    *int `query:"traceLimit" validate:"min=1,max=50"`
}

type listTracesRequest struct {
	Method string `query:"method"`
	Path   string `query:"path"`
	Limit  *int   `query:"limit" validate:"min=1,max=50"`
}

type APIMetaHandler struct {
	registry   *apimeta.Registry
	traceStore *apimeta.TraceStore
}

func NewAPIMetaHandler(registry *apimeta.Registry, traceStore *apimeta.TraceStore) *APIMetaHandler {
	return &APIMetaHandler{
		registry:   registry,
		traceStore: traceStore,
	}
}

func (handler *APIMetaHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	group := router.Group("", adminMiddleware)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[listRoutesRequest]{
		Method:  fiber.MethodGet,
		Path:    "/meta/routes",
		Summary: "查询 API 列表与参数校验",
		Auth:    "admin",
	}, handler.ListRoutes)
	apimeta.Register(group, handler.registry, apimeta.RouteSpec[listTracesRequest]{
		Method:  fiber.MethodGet,
		Path:    "/meta/traces",
		Summary: "查询最近请求/响应样例",
		Auth:    "admin",
	}, handler.ListTraces)
}

func (handler *APIMetaHandler) ListRoutes(c *fiber.Ctx, request *listRoutesRequest) error {
	includeTraces := request.IncludeTraces != nil && *request.IncludeTraces == 1
	traceLimit := 3
	if request.TraceLimit != nil && *request.TraceLimit > 0 {
		traceLimit = *request.TraceLimit
	}

	out := []apimeta.APIRouteDoc{}
	if handler.registry != nil {
		out = handler.registry.List()
	}
	if includeTraces && handler.traceStore != nil {
		for index := range out {
			out[index].LastTraces = handler.traceStore.List(out[index].Method, out[index].Path, traceLimit)
		}
	}

	return response.Success(c, fiber.StatusOK, map[string]any{
		"count":  len(out),
		"routes": out,
	}, "获取 API 元数据成功")
}

func (handler *APIMetaHandler) ListTraces(c *fiber.Ctx, request *listTracesRequest) error {
	if handler.traceStore == nil {
		return response.Success(c, fiber.StatusOK, map[string]any{
			"count":  0,
			"traces": []apimeta.Trace{},
		}, "追踪存储未启用")
	}
	method := strings.TrimSpace(request.Method)
	path := strings.TrimSpace(request.Path)
	limit := 10
	if request.Limit != nil && *request.Limit > 0 {
		limit = *request.Limit
	}
	traces := handler.traceStore.List(method, path, limit)
	return response.Success(c, fiber.StatusOK, map[string]any{
		"count":  len(traces),
		"traces": traces,
	}, "获取最近请求追踪成功")
}
