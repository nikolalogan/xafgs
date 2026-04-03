package model

import "time"

const (
	ChatMessageRoleSystem    = "system"
	ChatMessageRoleUser      = "user"
	ChatMessageRoleAssistant = "assistant"
)

type ChatConversation struct {
	BaseEntity
	UserID       int64  `json:"userId"`
	Title        string `json:"title"`
	Model        string `json:"model"`
	SystemPrompt string `json:"systemPrompt"`
}

type ChatConversationDTO struct {
	ID           int64     `json:"id"`
	UserID       int64     `json:"userId"`
	Title        string    `json:"title"`
	Model        string    `json:"model"`
	SystemPrompt string    `json:"systemPrompt"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (conversation ChatConversation) ToDTO() ChatConversationDTO {
	return ChatConversationDTO{
		ID:           conversation.ID,
		UserID:       conversation.UserID,
		Title:        conversation.Title,
		Model:        conversation.Model,
		SystemPrompt: conversation.SystemPrompt,
		CreatedAt:    conversation.CreatedAt,
		UpdatedAt:    conversation.UpdatedAt,
	}
}

type ChatMessage struct {
	ID             int64     `json:"id"`
	ConversationID int64     `json:"conversationId"`
	Role           string    `json:"role"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"createdAt"`
}

type ChatMessageDTO struct {
	ID             int64     `json:"id"`
	ConversationID int64     `json:"conversationId"`
	Role           string    `json:"role"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (message ChatMessage) ToDTO() ChatMessageDTO {
	return ChatMessageDTO{
		ID:             message.ID,
		ConversationID: message.ConversationID,
		Role:           message.Role,
		Content:        message.Content,
		CreatedAt:      message.CreatedAt,
	}
}

type ChatSendResultDTO struct {
	Conversation     ChatConversationDTO `json:"conversation"`
	UserMessage      ChatMessageDTO      `json:"userMessage"`
	AssistantMessage ChatMessageDTO      `json:"assistantMessage"`
}

