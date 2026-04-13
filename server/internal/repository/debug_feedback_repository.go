package repository

import (
	"sort"
	"sync"
	"time"

	"sxfgssever/server/internal/model"
)

type DebugFeedbackRepository interface {
	CreateFeedback(feedback model.DebugFeedback, attachments []model.DebugFeedbackAttachment) (model.DebugFeedback, []model.DebugFeedbackAttachment, bool)
	ListFeedbacks() []model.DebugFeedback
	FindFeedbackByID(feedbackID int64) (model.DebugFeedback, bool)
	ListAttachmentsByFeedbackID(feedbackID int64) []model.DebugFeedbackAttachment
	FindAttachmentByID(attachmentID int64) (model.DebugFeedbackAttachment, bool)
	CompleteFeedback(feedbackID int64, completedByUserID int64) (model.DebugFeedback, bool)
}

type debugFeedbackRepository struct {
	mu               sync.RWMutex
	feedbacks        map[int64]model.DebugFeedback
	attachments      map[int64]model.DebugFeedbackAttachment
	attachmentByFeed map[int64][]int64
	nextFeedbackID   int64
	nextAttachmentID int64
}

func NewDebugFeedbackRepository() DebugFeedbackRepository {
	return &debugFeedbackRepository{
		feedbacks:        make(map[int64]model.DebugFeedback),
		attachments:      make(map[int64]model.DebugFeedbackAttachment),
		attachmentByFeed: make(map[int64][]int64),
		nextFeedbackID:   1,
		nextAttachmentID: 1,
	}
}

func (repository *debugFeedbackRepository) CreateFeedback(feedback model.DebugFeedback, attachments []model.DebugFeedbackAttachment) (model.DebugFeedback, []model.DebugFeedbackAttachment, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	now := time.Now().UTC()
	feedback.ID = repository.nextFeedbackID
	repository.nextFeedbackID++
	feedback.CreatedAt = now
	feedback.UpdatedAt = now
	repository.feedbacks[feedback.ID] = feedback

	createdAttachments := make([]model.DebugFeedbackAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		attachment.ID = repository.nextAttachmentID
		repository.nextAttachmentID++
		attachment.FeedbackID = feedback.ID
		repository.attachments[attachment.ID] = attachment
		repository.attachmentByFeed[feedback.ID] = append(repository.attachmentByFeed[feedback.ID], attachment.ID)
		createdAttachments = append(createdAttachments, attachment)
	}
	return feedback, createdAttachments, true
}

func (repository *debugFeedbackRepository) ListFeedbacks() []model.DebugFeedback {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	out := make([]model.DebugFeedback, 0, len(repository.feedbacks))
	for _, item := range repository.feedbacks {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}

func (repository *debugFeedbackRepository) FindFeedbackByID(feedbackID int64) (model.DebugFeedback, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	item, ok := repository.feedbacks[feedbackID]
	return item, ok
}

func (repository *debugFeedbackRepository) ListAttachmentsByFeedbackID(feedbackID int64) []model.DebugFeedbackAttachment {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	ids := repository.attachmentByFeed[feedbackID]
	out := make([]model.DebugFeedbackAttachment, 0, len(ids))
	for _, id := range ids {
		if attachment, ok := repository.attachments[id]; ok {
			out = append(out, attachment)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].ID < out[j].ID
	})
	return out
}

func (repository *debugFeedbackRepository) FindAttachmentByID(attachmentID int64) (model.DebugFeedbackAttachment, bool) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()

	item, ok := repository.attachments[attachmentID]
	return item, ok
}

func (repository *debugFeedbackRepository) CompleteFeedback(feedbackID int64, completedByUserID int64) (model.DebugFeedback, bool) {
	repository.mu.Lock()
	defer repository.mu.Unlock()

	item, ok := repository.feedbacks[feedbackID]
	if !ok {
		return model.DebugFeedback{}, false
	}
	if item.Status == model.DebugFeedbackStatusDone {
		return item, true
	}
	now := time.Now().UTC()
	item.Status = model.DebugFeedbackStatusDone
	item.CompletedAt = &now
	item.CompletedByUserID = completedByUserID
	item.UpdatedAt = now
	item.UpdatedBy = completedByUserID
	repository.feedbacks[feedbackID] = item
	return item, true
}
