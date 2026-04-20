package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type knowledgeSearchRequest struct {
	Query     string  `json:"query" validate:"required"`
	TopK      int     `json:"topK" validate:"min=1,max=50"`
	MinScore  float64 `json:"minScore" validate:"min=0,max=1"`
	FileIDs   []int64 `json:"fileIds" validate:"max=50,dive,min=1"`
	BizKey    string  `json:"bizKey"`
	SubjectID int64   `json:"subjectId" validate:"min=0"`
	ProjectID int64   `json:"projectId" validate:"min=0"`
}

type knowledgeFilePathRequest struct {
	FileID int64 `path:"fileId" validate:"required,min=1"`
}

type knowledgeFileVersionRequest struct {
	FileID    int64 `path:"fileId" validate:"required,min=1"`
	VersionNo int   `query:"versionNo"`
}

type knowledgeQueueListRequest struct {
	Limit int `query:"limit" validate:"min=1,max=500"`
}

type KnowledgeHandler struct {
	service  service.KnowledgeService
	registry *apimeta.Registry
}

func NewKnowledgeHandler(service service.KnowledgeService, registry *apimeta.Registry) *KnowledgeHandler {
	return &KnowledgeHandler{service: service, registry: registry}
}

func (handler *KnowledgeHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[knowledgeSearchRequest]{
		Method:             fiber.MethodPost,
		Path:               "/knowledge/search",
		Summary:            "知识库向量检索",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.KnowledgeSearchResultDTO](),
	}, handler.Search)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[knowledgeFileVersionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/:fileId/reindex",
		Summary:            "重建文件向量索引",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.KnowledgeIndexStatusDTO](),
	}, handler.Reindex)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[knowledgeFileVersionRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/index-status",
		Summary:            "查询文件索引状态",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.KnowledgeIndexStatusDTO](),
	}, handler.Status)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[knowledgeQueueListRequest]{
		Method:             fiber.MethodGet,
		Path:               "/knowledge/jobs",
		Summary:            "查询向量任务队列",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.KnowledgeIndexQueueItemDTO](),
	}, handler.ListJobs)
}

func (handler *KnowledgeHandler) Search(c *fiber.Ctx, request *knowledgeSearchRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.service.Search(c.UserContext(), userID, service.KnowledgeSearchRequest{
		Query:     strings.TrimSpace(request.Query),
		TopK:      request.TopK,
		MinScore:  request.MinScore,
		FileIDs:   request.FileIDs,
		BizKey:    strings.TrimSpace(request.BizKey),
		SubjectID: request.SubjectID,
		ProjectID: request.ProjectID,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "检索成功")
}

func (handler *KnowledgeHandler) Reindex(c *fiber.Ctx, request *knowledgeFileVersionRequest) error {
	result, apiError := handler.service.Reindex(c.UserContext(), request.FileID, request.VersionNo)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "已触发重建")
}

func (handler *KnowledgeHandler) Status(c *fiber.Ctx, request *knowledgeFileVersionRequest) error {
	result, apiError := handler.service.GetStatus(c.UserContext(), request.FileID, request.VersionNo)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取索引状态成功")
}

func (handler *KnowledgeHandler) ListJobs(c *fiber.Ctx, request *knowledgeQueueListRequest) error {
	result, apiError := handler.service.ListJobs(c.UserContext(), request.Limit)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取向量队列成功")
}
