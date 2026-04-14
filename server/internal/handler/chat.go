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

type createChatConversationRequest struct {
	Title        string `json:"title"`
	Model        string `json:"model"`
	SystemPrompt string `json:"systemPrompt"`
}

type chatConversationIDPathRequest struct {
	ID int64 `path:"id" validate:"required,min=1"`
}

type listChatMessagesRequest struct {
	ID    int64  `path:"id" validate:"required,min=1"`
	Limit *int64 `query:"limit" validate:"min=1,max=500"`
}

type sendChatMessageRequest struct {
	ID                 int64                     `path:"id" validate:"required,min=1"`
	Content            string                    `json:"content"`
	EnableWebSearch    bool                      `json:"enableWebSearch"`
	Attachments        []model.ChatAttachmentRef `json:"attachments" validate:"max=5,dive"`
	MaxContextMessages *int64                    `json:"maxContextMessages" validate:"min=1,max=100"`
	SubjectID          int64                     `json:"subjectId" validate:"min=0"`
	ProjectID          int64                     `json:"projectId" validate:"min=0"`
}

type ChatHandler struct {
	service  service.ChatService
	registry *apimeta.Registry
}

func NewChatHandler(service service.ChatService, registry *apimeta.Registry) *ChatHandler {
	return &ChatHandler{
		service:  service,
		registry: registry,
	}
}

func (handler *ChatHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createChatConversationRequest]{
		Method:             fiber.MethodPost,
		Path:               "/chat/conversations",
		Summary:            "创建聊天会话",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ChatConversationDTO](),
	}, handler.CreateConversation)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/chat/conversations",
		Summary:            "查询聊天会话列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.ChatConversationDTO](),
	}, handler.ListConversations)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[listChatMessagesRequest]{
		Method:             fiber.MethodGet,
		Path:               "/chat/conversations/:id/messages",
		Summary:            "查询会话消息",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.ChatMessageDTO](),
	}, handler.ListMessages)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[sendChatMessageRequest]{
		Method:             fiber.MethodPost,
		Path:               "/chat/conversations/:id/messages",
		Summary:            "发送消息并获得回复",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ChatSendResultDTO](),
	}, handler.SendMessage)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[chatConversationIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/chat/conversations/:id",
		Summary:            "删除聊天会话",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.DeleteConversation)
}

func (handler *ChatHandler) CreateConversation(c *fiber.Ctx, request *createChatConversationRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	created, apiError := handler.service.CreateConversation(
		c.UserContext(),
		userID,
		strings.TrimSpace(request.Title),
		strings.TrimSpace(request.Model),
		strings.TrimSpace(request.SystemPrompt),
	)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, created, "创建会话成功")
}

func (handler *ChatHandler) ListConversations(c *fiber.Ctx, _ *struct{}) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	list, apiError := handler.service.ListConversations(c.UserContext(), userID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, list, "获取会话列表成功")
}

func (handler *ChatHandler) ListMessages(c *fiber.Ctx, request *listChatMessagesRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	limit := 200
	if request.Limit != nil {
		limit = int(*request.Limit)
	}
	list, apiError := handler.service.ListMessages(c.UserContext(), userID, request.ID, limit)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, list, "获取消息成功")
}

func (handler *ChatHandler) SendMessage(c *fiber.Ctx, request *sendChatMessageRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	maxContext := 20
	if request.MaxContextMessages != nil {
		maxContext = int(*request.MaxContextMessages)
	}
	data, apiError := handler.service.SendMessage(
		c.UserContext(),
		userID,
		request.ID,
		strings.TrimSpace(request.Content),
		request.EnableWebSearch,
		request.Attachments,
		maxContext,
		request.SubjectID,
		request.ProjectID,
	)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, data, "发送成功")
}

func (handler *ChatHandler) DeleteConversation(c *fiber.Ctx, request *chatConversationIDPathRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	okResult, apiError := handler.service.DeleteConversation(c.UserContext(), userID, request.ID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, okResult, "删除成功")
}
