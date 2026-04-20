package handler

import (
	"fmt"
	"net/url"
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
	FileID    int64 `path:"fileId" validate:"required,min=1"`
	VersionNo int   `query:"versionNo"`
}

type fileParseJobIDPathRequest struct {
	JobID int64 `path:"jobId" validate:"required,min=1"`
}

type fileParseJobsListRequest struct {
	Limit int `query:"limit" validate:"min=1,max=500"`
}

type FileHandler struct {
	fileService          service.FileService
	fileParseQueue       service.FileParseQueueService
	ocrTaskService       service.OCRTaskService
	registry             *apimeta.Registry
}

func NewFileHandler(
	fileService service.FileService,
	fileParseQueue service.FileParseQueueService,
	ocrTaskService service.OCRTaskService,
	registry *apimeta.Registry,
) *FileHandler {
	return &FileHandler{
		fileService:    fileService,
		fileParseQueue: fileParseQueue,
		ocrTaskService: ocrTaskService,
		registry:       registry,
	}
}

func (handler *FileHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/files",
		Summary:            "获取文件列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.FileDTO](),
	}, handler.ListFiles)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createUploadSessionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/sessions",
		Summary:            "创建上传会话（选中文件但未上传）",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.UploadSessionDTO](),
	}, handler.CreateSession)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[uploadSessionIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/sessions/:sessionId/content",
		Summary:            "按会话上传文件内容",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileUploadResultDTO](),
	}, handler.UploadSessionContent)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[uploadSessionIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/files/sessions/:sessionId",
		Summary:            "取消上传会话",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.CancelSession)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileParseJobsListRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/parse-jobs",
		Summary:            "查询文件解析队列",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.FileParseQueueItemDTO](),
	}, handler.ListParseJobs)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileParseJobIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/parse-jobs/:jobId",
		Summary:            "查询单个解析任务详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileParseJobDTO](),
	}, handler.GetParseJobByID)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/:fileId/versions",
		Summary:            "上传文件新版本",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileUploadResultDTO](),
	}, handler.UploadVersion)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId",
		Summary:            "获取文件详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileDTO](),
	}, handler.GetFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/files/:fileId",
		Summary:            "物理删除文件及其全部版本",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.DeleteFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/versions",
		Summary:            "获取文件版本列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.FileVersionDTO](),
	}, handler.ListVersions)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/resolve",
		Summary:            "按 fileId/versionNo 解析已上传文件版本",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileVersionDTO](),
	}, handler.ResolveReference)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/:fileId/parse",
		Summary:            "按 fileId/versionNo 提交解析任务",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileParseJobDTO](),
	}, handler.ParseFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/parse",
		Summary:            "按 fileId/versionNo 查询解析任务",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileParseJobDTO](),
	}, handler.GetParseJob)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/ocr-status",
		Summary:            "查询单文件 OCR 任务状态",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.OCRTaskDTO](),
	}, handler.GetOCRStatus)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:  fiber.MethodGet,
		Path:    "/files/:fileId/download",
		Summary: "按 fileId/versionNo 下载已上传文件版本",
		Auth:    "auth",
	}, handler.DownloadReference)
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

func (handler *FileHandler) DeleteFile(c *fiber.Ctx, request *fileIDPathRequest) error {
	apiError := handler.fileService.DeleteFile(c.UserContext(), request.FileID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除文件成功")
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

func (handler *FileHandler) ParseFile(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	result, apiError := handler.fileParseQueue.Enqueue(c.UserContext(), request.FileID, request.VersionNo, authUserID(c))
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "解析任务已提交")
}

func (handler *FileHandler) GetParseJob(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	result, apiError := handler.fileParseQueue.GetLatest(c.UserContext(), request.FileID, request.VersionNo)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取解析任务成功")
}

func (handler *FileHandler) ListParseJobs(c *fiber.Ctx, request *fileParseJobsListRequest) error {
	result, apiError := handler.fileParseQueue.List(c.UserContext(), request.Limit)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取解析队列成功")
}

func (handler *FileHandler) GetParseJobByID(c *fiber.Ctx, request *fileParseJobIDPathRequest) error {
	result, apiError := handler.fileParseQueue.GetByID(c.UserContext(), request.JobID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取解析任务成功")
}

func (handler *FileHandler) GetOCRStatus(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	task, apiError := handler.ocrTaskService.GetTaskStatus(c.UserContext(), request.FileID, request.VersionNo)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, task, "获取 OCR 状态成功")
}

func (handler *FileHandler) DownloadReference(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	version, raw, apiError := handler.fileService.ReadReferenceContent(c.UserContext(), request.FileID, request.VersionNo, 0)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	c.Set(fiber.HeaderContentType, version.MimeType)
	c.Set(fiber.HeaderContentDisposition, buildContentDisposition(version.OriginName))
	return c.Status(fiber.StatusOK).Send(raw)
}

func buildContentDisposition(name string) string {
	utf8Name := sanitizeDownloadFileName(name)
	asciiName := sanitizeDownloadASCIIFallback(utf8Name)
	encodedName := strings.ReplaceAll(url.QueryEscape(utf8Name), "+", "%20")
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, asciiName, encodedName)
}

func sanitizeDownloadFileName(name string) string {
	cleaned := strings.NewReplacer("\r", "_", "\n", "_", `"`, "_").Replace(strings.TrimSpace(name))
	if cleaned == "" {
		return "attachment.bin"
	}
	return cleaned
}

func sanitizeDownloadASCIIFallback(name string) string {
	builder := strings.Builder{}
	for _, char := range name {
		if char >= 0x20 && char <= 0x7E && char != '"' && char != '\\' {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('_')
		}
	}
	fallback := strings.TrimSpace(builder.String())
	if fallback == "" {
		return "attachment.bin"
	}
	return fallback
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
