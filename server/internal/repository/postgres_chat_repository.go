package repository

import (
	"context"
	"database/sql"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresChatRepository struct {
	db *sql.DB
}

func NewPostgresChatRepository(db *sql.DB) ChatRepository {
	return &PostgresChatRepository{db: db}
}

func (repository *PostgresChatRepository) CreateConversation(conversation model.ChatConversation) model.ChatConversationDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	conversation.CreatedAt = now
	conversation.UpdatedAt = now

	var id int64
	err := repository.db.QueryRowContext(ctx, `
INSERT INTO chat_conversation (user_id, title, model, system_prompt, created_at, updated_at, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $5, $6, $6)
RETURNING id
`, conversation.UserID, conversation.Title, conversation.Model, conversation.SystemPrompt, now, conversation.CreatedBy).Scan(&id)
	if err != nil {
		return model.ChatConversationDTO{}
	}

	entity, ok := repository.FindConversationByIDForUser(id, conversation.UserID)
	if !ok {
		return model.ChatConversationDTO{}
	}
	return entity.ToDTO()
}

func (repository *PostgresChatRepository) FindConversationByIDForUser(conversationID, userID int64) (model.ChatConversation, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var entity model.ChatConversation
	err := repository.db.QueryRowContext(ctx, `
SELECT id, user_id, title, model, system_prompt, created_at, updated_at, created_by, updated_by
FROM chat_conversation
WHERE id = $1 AND user_id = $2
`, conversationID, userID).Scan(
		&entity.ID,
		&entity.UserID,
		&entity.Title,
		&entity.Model,
		&entity.SystemPrompt,
		&entity.CreatedAt,
		&entity.UpdatedAt,
		&entity.CreatedBy,
		&entity.UpdatedBy,
	)
	if err != nil {
		return model.ChatConversation{}, false
	}
	return entity, true
}

func (repository *PostgresChatRepository) ListConversationsByUser(userID int64) []model.ChatConversationDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, user_id, title, model, system_prompt, created_at, updated_at, created_by, updated_by
FROM chat_conversation
WHERE user_id = $1
ORDER BY updated_at DESC, id DESC
`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]model.ChatConversationDTO, 0)
	for rows.Next() {
		var entity model.ChatConversation
		if err := rows.Scan(
			&entity.ID,
			&entity.UserID,
			&entity.Title,
			&entity.Model,
			&entity.SystemPrompt,
			&entity.CreatedAt,
			&entity.UpdatedAt,
			&entity.CreatedBy,
			&entity.UpdatedBy,
		); err != nil {
			continue
		}
		out = append(out, entity.ToDTO())
	}
	return out
}

func (repository *PostgresChatRepository) TouchConversation(conversationID int64, updatedBy int64) (model.ChatConversationDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE chat_conversation
SET updated_at = $2, updated_by = $3
WHERE id = $1
`, conversationID, now, updatedBy)
	if err != nil {
		return model.ChatConversationDTO{}, false
	}

	var userID int64
	err = repository.db.QueryRowContext(ctx, `SELECT user_id FROM chat_conversation WHERE id = $1`, conversationID).Scan(&userID)
	if err != nil {
		return model.ChatConversationDTO{}, false
	}
	entity, ok := repository.FindConversationByIDForUser(conversationID, userID)
	if !ok {
		return model.ChatConversationDTO{}, false
	}
	return entity.ToDTO(), true
}

func (repository *PostgresChatRepository) DeleteConversation(conversationID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	result, err := repository.db.ExecContext(ctx, `DELETE FROM chat_conversation WHERE id = $1`, conversationID)
	if err != nil {
		return false
	}
	affected, _ := result.RowsAffected()
	return affected > 0
}

func (repository *PostgresChatRepository) CreateMessage(message model.ChatMessage) model.ChatMessageDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	message.CreatedAt = now

	var id int64
	err := repository.db.QueryRowContext(ctx, `
INSERT INTO chat_message (conversation_id, role, content, created_at)
VALUES ($1, $2, $3, $4)
RETURNING id
`, message.ConversationID, message.Role, message.Content, now).Scan(&id)
	if err != nil {
		return model.ChatMessageDTO{}
	}

	return model.ChatMessage{
		ID:             id,
		ConversationID: message.ConversationID,
		Role:           message.Role,
		Content:        message.Content,
		CreatedAt:      now,
	}.ToDTO()
}

func (repository *PostgresChatRepository) ListRecentMessages(conversationID int64, limit int) []model.ChatMessageDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if limit <= 0 {
		limit = 200
	}
	rows, err := repository.db.QueryContext(ctx, `
SELECT id, conversation_id, role, content, created_at
FROM chat_message
WHERE conversation_id = $1
ORDER BY id DESC
LIMIT $2
`, conversationID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()

	reversed := make([]model.ChatMessageDTO, 0)
	for rows.Next() {
		var entity model.ChatMessage
		if err := rows.Scan(&entity.ID, &entity.ConversationID, &entity.Role, &entity.Content, &entity.CreatedAt); err != nil {
			continue
		}
		reversed = append(reversed, entity.ToDTO())
	}

	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	return reversed
}

