package service

import (
	"context"
	"strings"
	"time"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

const DefaultChatModel = "gpt-4o-mini"

type ChatService interface {
	CreateConversation(ctx context.Context, userID int64, title, modelName, systemPrompt string) (model.ChatConversationDTO, *model.APIError)
	ListConversations(ctx context.Context, userID int64) ([]model.ChatConversationDTO, *model.APIError)
	ListMessages(ctx context.Context, userID, conversationID int64, limit int) ([]model.ChatMessageDTO, *model.APIError)
	SendMessage(ctx context.Context, userID, conversationID int64, content string, maxContextMessages int) (model.ChatSendResultDTO, *model.APIError)
	DeleteConversation(ctx context.Context, userID, conversationID int64) (bool, *model.APIError)
}

type chatService struct {
	repository        repository.ChatRepository
	userConfigService UserConfigService
	aiClient          ai.ChatCompletionClient
}

func NewChatService(repository repository.ChatRepository, userConfigService UserConfigService, aiClient ai.ChatCompletionClient) ChatService {
	return &chatService{
		repository:        repository,
		userConfigService: userConfigService,
		aiClient:          aiClient,
	}
}

func (service *chatService) CreateConversation(_ context.Context, userID int64, title, modelName, systemPrompt string) (model.ChatConversationDTO, *model.APIError) {
	if userID <= 0 {
		return model.ChatConversationDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	title = strings.TrimSpace(title)
	systemPrompt = strings.TrimSpace(systemPrompt)
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = DefaultChatModel
	}

	created := service.repository.CreateConversation(model.ChatConversation{
		BaseEntity: model.BaseEntity{
			CreatedBy: userID,
			UpdatedBy: userID,
		},
		UserID:       userID,
		Title:        title,
		Model:        modelName,
		SystemPrompt: systemPrompt,
	})
	if created.ID <= 0 {
		return model.ChatConversationDTO{}, model.NewAPIError(500, response.CodeInternal, "创建会话失败")
	}
	return created, nil
}

func (service *chatService) ListConversations(_ context.Context, userID int64) ([]model.ChatConversationDTO, *model.APIError) {
	if userID <= 0 {
		return nil, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	return service.repository.ListConversationsByUser(userID), nil
}

func (service *chatService) ListMessages(_ context.Context, userID, conversationID int64, limit int) ([]model.ChatMessageDTO, *model.APIError) {
	if userID <= 0 {
		return nil, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if conversationID <= 0 {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "会话 id 不合法")
	}
	if _, ok := service.repository.FindConversationByIDForUser(conversationID, userID); !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "会话不存在")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	return service.repository.ListRecentMessages(conversationID, limit), nil
}

func (service *chatService) SendMessage(ctx context.Context, userID, conversationID int64, content string, maxContextMessages int) (model.ChatSendResultDTO, *model.APIError) {
	if userID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if conversationID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "会话 id 不合法")
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "content 不能为空")
	}

	conversation, ok := service.repository.FindConversationByIDForUser(conversationID, userID)
	if !ok {
		return model.ChatSendResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "会话不存在")
	}

	config, apiError := service.userConfigService.GetByUserID(ctx, userID)
	if apiError != nil {
		return model.ChatSendResultDTO{}, apiError
	}
	baseURL := strings.TrimSpace(config.AIBaseURL)
	apiKey := strings.TrimSpace(config.AIApiKey)
	if baseURL == "" || apiKey == "" {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：AI 服务商地址、AI APIKey")
	}

	if maxContextMessages <= 0 {
		maxContextMessages = 20
	}
	if maxContextMessages > 100 {
		maxContextMessages = 100
	}

	userMessage := service.repository.CreateMessage(model.ChatMessage{
		ConversationID: conversationID,
		Role:           model.ChatMessageRoleUser,
		Content:        content,
	})
	if userMessage.ID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(500, response.CodeInternal, "写入消息失败")
	}

	history := service.repository.ListRecentMessages(conversationID, maxContextMessages)
	messages := make([]ai.ChatMessage, 0, len(history)+1)
	if strings.TrimSpace(conversation.SystemPrompt) != "" {
		messages = append(messages, ai.ChatMessage{Role: model.ChatMessageRoleSystem, Content: conversation.SystemPrompt})
	}
	for _, item := range history {
		messages = append(messages, ai.ChatMessage{Role: item.Role, Content: item.Content})
	}

	temperature := 0.2
	assistantText, err := service.aiClient.CreateChatCompletion(ctx, ai.ChatCompletionRequest{
		BaseURL:     baseURL,
		APIKey:      apiKey,
		Model:       conversation.Model,
		Messages:    messages,
		Temperature: temperature,
		Timeout:     60 * time.Second,
	})
	if err != nil {
		return model.ChatSendResultDTO{}, model.NewAPIError(502, response.CodeInternal, "AI 调用失败："+err.Error())
	}

	assistantMessage := service.repository.CreateMessage(model.ChatMessage{
		ConversationID: conversationID,
		Role:           model.ChatMessageRoleAssistant,
		Content:        assistantText,
	})
	if assistantMessage.ID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(500, response.CodeInternal, "写入回复失败")
	}

	touched, ok := service.repository.TouchConversation(conversationID, userID)
	if !ok {
		touched = conversation.ToDTO()
	}

	return model.ChatSendResultDTO{
		Conversation:     touched,
		UserMessage:      userMessage,
		AssistantMessage: assistantMessage,
	}, nil
}

func (service *chatService) DeleteConversation(_ context.Context, userID, conversationID int64) (bool, *model.APIError) {
	if userID <= 0 {
		return false, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if conversationID <= 0 {
		return false, model.NewAPIError(400, response.CodeBadRequest, "会话 id 不合法")
	}
	if _, ok := service.repository.FindConversationByIDForUser(conversationID, userID); !ok {
		return false, model.NewAPIError(404, response.CodeNotFound, "会话不存在")
	}
	if !service.repository.DeleteConversation(conversationID) {
		return false, model.NewAPIError(500, response.CodeInternal, "删除会话失败")
	}
	return true, nil
}

