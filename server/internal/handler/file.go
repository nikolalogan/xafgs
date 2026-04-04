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

type createUploadSessionRequest struct {
	BizKey string `json:"bizKey"`
	FileID int64  `json:"fileId"`
}

type uploadSessionIDPathRequest struct {
	SessionID string `path:"sessionId" validate:"required"`
}

type fileIDPathRequest struct {
	FileID int64 `path:"fileId" validate:"required,min=1"`
}

type fileVersionResolveRequest struct {
	FileID     int64 `path:"fileId" validate:"required,min=1"`
	VersionNo  int   `query:"versionNo"`
}

type FileHandler struct {
	fileService service.FileService
	registry    *apimeta.Registry
}

func NewFileHandler(fileService service.FileService, registry *apimeta.Registry) *FileHandler {
	return &FileHandler{
		fileService: fileService,
		registry:    registry,
	}
}

func (handler *FileHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:  fiber.MethodGet,
		Path:    "/files",
		Summary: "获取文件列表",
		Auth:    "auth",
	}, handler.ListFiles)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createUploadSessionRequest]{
		Method:  fiber.MethodPost,
		Path:    "/files/sessions",
		Summary: "创建上传会话（选中文件但未上传）",
		Auth:    "auth",
	}, handler.CreateSession)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[uploadSessionIDPathRequest]{
		Method:  fiber.MethodPost,
		Path:    "/files/sessions/:sessionId/content",
		Summary: "按会话上传文件内容",
		Auth:    "auth",
	}, handler.UploadSessionContent)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[uploadSessionIDPathRequest]{
		Method:  fiber.MethodDelete,
		Path:    "/files/sessions/:sessionId",
		Summary: "取消上传会话",
		Auth:    "auth",
	}, handler.CancelSession)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:  fiber.MethodPost,
		Path:    "/files/:fileId/versions",
		Summary: "上传文件新版本",
		Auth:    "auth",
	}, handler.UploadVersion)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:  fiber.MethodGet,
		Path:    "/files/:fileId",
		Summary: "获取文件详情",
		Auth:    "auth",
	}, handler.GetFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:  fiber.MethodGet,
		Path:    "/files/:fileId/versions",
		Summary: "获取文件版本列表",
		Auth:    "auth",
	}, handler.ListVersions)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:  fiber.MethodGet,
		Path:    "/files/:fileId/resolve",
		Summary: "按 fileId/versionNo 解析已上传文件版本",
		Auth:    "auth",
	}, handler.ResolveReference)
}

func (handler *FileHandler) ListFiles(c *fiber.Ctx, _ *struct{}) error {
	files, apiError := handler.fileService.ListFiles(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, files, "获取文件列表成功")
}

func (handler *FileHandler) CreateSession(c *fiber.Ctx, request *createUploadSessionRequest) error {
	operatorID := authUserID(c)
	request.BizKey = strings.TrimSpace(request.BizKey)

	session, apiError := handler.fileService.CreateSession(c.UserContext(), operatorID, model.CreateUploadSessionRequest{
		BizKey: request.BizKey,
		FileID: request.FileID,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, session, "创建上传会话成功")
}

func (handler *FileHandler) UploadSessionContent(c *fiber.Ctx, request *uploadSessionIDPathRequest) error {
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少上传文件，请使用 file 字段")
	}
	operatorID := authUserID(c)
	result, apiError := handler.fileService.UploadBySession(c.UserContext(), operatorID, request.SessionID, fileHeader)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "上传文件成功")
}

func (handler *FileHandler) CancelSession(c *fiber.Ctx, request *uploadSessionIDPathRequest) error {
	operatorID := authUserID(c)
	apiError := handler.fileService.CancelSession(c.UserContext(), operatorID, request.SessionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "取消上传会话成功")
}

func (handler *FileHandler) UploadVersion(c *fiber.Ctx, request *fileIDPathRequest) error {
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少上传文件，请使用 file 字段")
	}
	operatorID := authUserID(c)
	result, apiError := handler.fileService.UploadVersion(c.UserContext(), operatorID, request.FileID, fileHeader)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "上传版本成功")
}

func (handler *FileHandler) GetFile(c *fiber.Ctx, request *fileIDPathRequest) error {
	fileDTO, apiError := handler.fileService.GetFile(c.UserContext(), request.FileID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, fileDTO, "获取文件成功")
}

func (handler *FileHandler) ListVersions(c *fiber.Ctx, request *fileIDPathRequest) error {
	versions, apiError := handler.fileService.ListVersions(c.UserContext(), request.FileID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, versions, "获取文件版本成功")
}

func (handler *FileHandler) ResolveReference(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	version, apiError := handler.fileService.ResolveReference(c.UserContext(), request.FileID, request.VersionNo)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, version, "解析文件引用成功")
}

func authUserID(c *fiber.Ctx) int64 {
	value := c.Locals(middleware.LocalAuthUserID)
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case uint:
		return int64(typed)
	case uint64:
		return int64(typed)
	default:
		return 0
	}
}
