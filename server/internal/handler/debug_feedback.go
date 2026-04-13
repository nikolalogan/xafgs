package handler

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type debugFeedbackIDPathRequest struct {
	ID int64 `path:"id" validate:"required,min=1"`
}

type createDebugFeedbackRequest struct {
	Title       string `json:"title" validate:"required"`
	Type        string `json:"type" validate:"required,oneof=requirement bug"`
	Description string `json:"description"`
	Attachments []struct {
		FileID    int64 `json:"fileId" validate:"required,min=1"`
		VersionNo int   `json:"versionNo" validate:"required,min=1"`
	} `json:"attachments"`
}

type DebugFeedbackHandler struct {
	debugFeedbackService service.DebugFeedbackService
	registry             *apimeta.Registry
}

func NewDebugFeedbackHandler(debugFeedbackService service.DebugFeedbackService, registry *apimeta.Registry) *DebugFeedbackHandler {
	return &DebugFeedbackHandler{
		debugFeedbackService: debugFeedbackService,
		registry:             registry,
	}
}

func (handler *DebugFeedbackHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	adminMiddlewares := []fiber.Handler{adminMiddleware}
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/debug-feedback",
		Summary:            "获取 Debug 反馈列表",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.DebugFeedbackSummaryDTO](),
	}, handler.List)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createDebugFeedbackRequest]{
		Method:             fiber.MethodPost,
		Path:               "/debug-feedback",
		Summary:            "创建 Debug 反馈",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.DebugFeedbackItemDTO](),
	}, handler.Create)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[debugFeedbackIDPathRequest]{
		Method:             fiber.MethodPatch,
		Path:               "/debug-feedback/:id",
		Summary:            "完成 Debug 反馈",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.DebugFeedbackItemDTO](),
	}, handler.Complete)

	router.Get("/debug-feedback/attachments/:attachmentId", adminMiddleware, handler.DownloadAttachment)
}

func (handler *DebugFeedbackHandler) List(c *fiber.Ctx, _ *struct{}) error {
	user, ok := authUser(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.debugFeedbackService.GetSummary(c.UserContext(), user)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取 Debug 反馈列表成功")
}

func (handler *DebugFeedbackHandler) Create(c *fiber.Ctx, request *createDebugFeedbackRequest) error {
	user, ok := authUser(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	attachments := make([]model.DebugFeedbackCreateAttachmentRequest, 0, len(request.Attachments))
	for _, attachment := range request.Attachments {
		attachments = append(attachments, model.DebugFeedbackCreateAttachmentRequest{
			FileID:    attachment.FileID,
			VersionNo: attachment.VersionNo,
		})
	}
	result, apiError := handler.debugFeedbackService.Create(c.UserContext(), user, model.CreateDebugFeedbackRequest{
		Title:       strings.TrimSpace(request.Title),
		Type:        strings.TrimSpace(request.Type),
		Description: strings.TrimSpace(request.Description),
		Attachments: attachments,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "创建 Debug 反馈成功")
}

func (handler *DebugFeedbackHandler) Complete(c *fiber.Ctx, request *debugFeedbackIDPathRequest) error {
	user, ok := authUser(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.debugFeedbackService.Complete(c.UserContext(), user, request.ID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "完成 Debug 反馈成功")
}

func (handler *DebugFeedbackHandler) DownloadAttachment(c *fiber.Ctx) error {
	user, ok := authUser(c)
	if !ok {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	attachmentID, _ := strconv.ParseInt(strings.TrimSpace(c.Params("attachmentId")), 10, 64)
	if attachmentID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "附件 id 不合法")
	}
	attachment, content, apiError := handler.debugFeedbackService.ReadAttachment(c.UserContext(), user, attachmentID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	c.Set(fiber.HeaderContentType, attachment.MimeType)
	c.Set(fiber.HeaderContentDisposition, `inline; filename="`+attachment.Name+`"`)
	return c.Status(fiber.StatusOK).Send(content)
}

func authUser(c *fiber.Ctx) (model.UserDTO, bool) {
	value := c.Locals(middleware.LocalAuthUser)
	user, ok := value.(model.UserDTO)
	return user, ok
}
