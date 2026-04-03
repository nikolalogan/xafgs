package repository

import (
	"sort"
	"strings"
	"sync"
	"time"

	"sxfgssever/server/internal/model"
)

type ChatRepository interface {
	CreateConversation(conversation model.ChatConversation) model.ChatConversationDTO
	FindConversationByIDForUser(conversationID, userID int64) (model.ChatConversation, bool)
	ListConversationsByUser(userID int64) []model.ChatConversationDTO
	TouchConversation(conversationID int64, updatedBy int64) (model.ChatConversationDTO, bool)
	DeleteConversation(conversationID int64) bool

	CreateMessage(message model.ChatMessage) model.ChatMessageDTO
	ListRecentMessages(conversationID int64, limit int) []model.ChatMessageDTO
}

type chatRepository struct {
	mu sync.Mutex

	conversations     map[int64]model.ChatConversation
	messagesByConvID  map[int64][]model.ChatMessage
	nextConversationID int64
	nextMessageID      int64
}

func NewChatRepository() ChatRepository {
	return &chatRepository{
		conversations:      make(map[int64]model.ChatConversation),
		messagesByConvID:   make(map[int64][]model.ChatMessage),
		nextConversationID: 1,
		nextMessageID:      1,
	}
}

func (repository *chatRepository) CreateConversation(conversation model.ChatConversation) model.ChatConversationDTO {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	now := time.Now().UTC()
	conversation.ID = repository.nextConversationID
	repository.nextConversationID++
	conversation.CreatedAt = now
	conversation.UpdatedAt = now
	repository.conversations[conversation.ID] = conversation
	return conversation.ToDTO()
}

func (repository *chatRepository) FindConversationByIDForUser(conversationID, userID int64) (model.ChatConversation, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	entity, ok := repository.conversations[conversationID]
	if !ok {
		return model.ChatConversation{}, false
	}
	if entity.UserID != userID {
		return model.ChatConversation{}, false
	}
	return entity, true
}

func (repository *chatRepository) ListConversationsByUser(userID int64) []model.ChatConversationDTO {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	out := make([]model.ChatConversationDTO, 0)
	for _, conversation := range repository.conversations {
		if conversation.UserID != userID {
			continue
		}
		out = append(out, conversation.ToDTO())
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func (repository *chatRepository) TouchConversation(conversationID int64, updatedBy int64) (model.ChatConversationDTO, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	entity, ok := repository.conversations[conversationID]
	if !ok {
		return model.ChatConversationDTO{}, false
	}
	entity.UpdatedAt = time.Now().UTC()
	entity.UpdatedBy = updatedBy
	repository.conversations[conversationID] = entity
	return entity.ToDTO(), true
}

func (repository *chatRepository) DeleteConversation(conversationID int64) bool {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	if _, ok := repository.conversations[conversationID]; !ok {
		return false
	}
	delete(repository.conversations, conversationID)
	delete(repository.messagesByConvID, conversationID)
	return true
}

func (repository *chatRepository) CreateMessage(message model.ChatMessage) model.ChatMessageDTO {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	now := time.Now().UTC()
	message.ID = repository.nextMessageID
	repository.nextMessageID++
	message.CreatedAt = now
	message.Content = strings.TrimSpace(message.Content)
	repository.messagesByConvID[message.ConversationID] = append(repository.messagesByConvID[message.ConversationID], message)
	return message.ToDTO()
}

func (repository *chatRepository) ListRecentMessages(conversationID int64, limit int) []model.ChatMessageDTO {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	list := repository.messagesByConvID[conversationID]
	if limit <= 0 || limit >= len(list) {
		out := make([]model.ChatMessageDTO, 0, len(list))
		for _, item := range list {
			out = append(out, item.ToDTO())
		}
		return out
	}

	start := len(list) - limit
	out := make([]model.ChatMessageDTO, 0, limit)
	for _, item := range list[start:] {
		out = append(out, item.ToDTO())
	}
	return out
}

