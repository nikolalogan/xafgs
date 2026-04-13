package service

import (
	"context"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type DebugFeedbackService interface {
	GetSummary(ctx context.Context, user model.UserDTO) (model.DebugFeedbackSummaryDTO, *model.APIError)
	Create(ctx context.Context, user model.UserDTO, request model.CreateDebugFeedbackRequest) (model.DebugFeedbackItemDTO, *model.APIError)
	Complete(ctx context.Context, user model.UserDTO, feedbackID int64) (model.DebugFeedbackItemDTO, *model.APIError)
	ReadAttachment(ctx context.Context, user model.UserDTO, attachmentID int64) (model.DebugFeedbackAttachmentDTO, []byte, *model.APIError)
}

type debugFeedbackService struct {
	repository     repository.DebugFeedbackRepository
	userRepository repository.UserRepository
	fileRepository repository.FileRepository
	fileService    FileService
}

func NewDebugFeedbackService(
	repository repository.DebugFeedbackRepository,
	userRepository repository.UserRepository,
	fileRepository repository.FileRepository,
	fileService FileService,
) DebugFeedbackService {
	return &debugFeedbackService{
		repository:     repository,
		userRepository: userRepository,
		fileRepository: fileRepository,
		fileService:    fileService,
	}
}

func (service *debugFeedbackService) GetSummary(_ context.Context, user model.UserDTO) (model.DebugFeedbackSummaryDTO, *model.APIError) {
	if user.Role != model.UserRoleAdmin {
		return model.DebugFeedbackSummaryDTO{}, model.NewAPIError(403, response.CodeForbidden, "仅管理员可访问")
	}
	items := service.repository.ListFeedbacks()
	result := make([]model.DebugFeedbackItemDTO, 0, len(items))
	openCount := 0
	for _, item := range items {
		dto := service.buildItemDTO(item)
		if dto.Status == model.DebugFeedbackStatusOpen {
			openCount++
		}
		result = append(result, dto)
	}
	return model.DebugFeedbackSummaryDTO{
		Items:     result,
		OpenCount: openCount,
	}, nil
}

func (service *debugFeedbackService) Create(_ context.Context, user model.UserDTO, request model.CreateDebugFeedbackRequest) (model.DebugFeedbackItemDTO, *model.APIError) {
	title := strings.TrimSpace(request.Title)
	description := strings.TrimSpace(request.Description)
	requestType := strings.TrimSpace(request.Type)

	if user.ID <= 0 {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if title == "" {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(400, response.CodeBadRequest, "请输入标题")
	}
	if !model.IsValidDebugFeedbackType(requestType) {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(400, response.CodeBadRequest, "反馈类型不合法")
	}

	attachments := make([]model.DebugFeedbackAttachment, 0, len(request.Attachments))
	for _, item := range request.Attachments {
		if item.FileID <= 0 || item.VersionNo <= 0 {
			return model.DebugFeedbackItemDTO{}, model.NewAPIError(400, response.CodeBadRequest, "附件参数不合法")
		}
		version, ok := service.fileRepository.FindVersion(item.FileID, item.VersionNo)
		if !ok || version.Status != model.FileVersionStatusUploaded {
			return model.DebugFeedbackItemDTO{}, model.NewAPIError(404, response.CodeNotFound, "附件不存在")
		}
		attachments = append(attachments, model.DebugFeedbackAttachment{
			FileID:    item.FileID,
			VersionNo: item.VersionNo,
		})
	}

	created, _, ok := service.repository.CreateFeedback(model.DebugFeedback{
		BaseEntity: model.BaseEntity{
			CreatedBy: user.ID,
			UpdatedBy: user.ID,
		},
		Title:       title,
		Type:        requestType,
		Description: description,
		Status:      model.DebugFeedbackStatusOpen,
		SubmitterID: user.ID,
	}, attachments)
	if !ok {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(500, response.CodeInternal, "创建反馈失败")
	}
	return service.buildItemDTO(created), nil
}

func (service *debugFeedbackService) Complete(_ context.Context, user model.UserDTO, feedbackID int64) (model.DebugFeedbackItemDTO, *model.APIError) {
	if user.Role != model.UserRoleAdmin {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(403, response.CodeForbidden, "仅管理员可访问")
	}
	if feedbackID <= 0 {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(400, response.CodeBadRequest, "反馈 id 不合法")
	}
	item, ok := service.repository.CompleteFeedback(feedbackID, user.ID)
	if !ok {
		return model.DebugFeedbackItemDTO{}, model.NewAPIError(404, response.CodeNotFound, "反馈不存在")
	}
	return service.buildItemDTO(item), nil
}

func (service *debugFeedbackService) ReadAttachment(ctx context.Context, user model.UserDTO, attachmentID int64) (model.DebugFeedbackAttachmentDTO, []byte, *model.APIError) {
	if user.Role != model.UserRoleAdmin {
		return model.DebugFeedbackAttachmentDTO{}, nil, model.NewAPIError(403, response.CodeForbidden, "仅管理员可访问")
	}
	if user.ID <= 0 {
		return model.DebugFeedbackAttachmentDTO{}, nil, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	attachment, ok := service.repository.FindAttachmentByID(attachmentID)
	if !ok {
		return model.DebugFeedbackAttachmentDTO{}, nil, model.NewAPIError(404, response.CodeNotFound, "附件不存在")
	}
	if _, ok := service.repository.FindFeedbackByID(attachment.FeedbackID); !ok {
		return model.DebugFeedbackAttachmentDTO{}, nil, model.NewAPIError(404, response.CodeNotFound, "反馈不存在")
	}
	version, content, apiError := service.fileService.ReadReferenceContent(ctx, attachment.FileID, attachment.VersionNo, 0)
	if apiError != nil {
		return model.DebugFeedbackAttachmentDTO{}, nil, apiError
	}
	return model.DebugFeedbackAttachmentDTO{
		ID:        attachment.ID,
		FileID:    attachment.FileID,
		VersionNo: attachment.VersionNo,
		Name:      version.OriginName,
		MimeType:  version.MimeType,
		Size:      version.SizeBytes,
	}, content, nil
}

func (service *debugFeedbackService) buildItemDTO(item model.DebugFeedback) model.DebugFeedbackItemDTO {
	submitter, submitterOK := service.userRepository.FindByID(item.SubmitterID)
	completedBy := ""
	if item.CompletedByUserID > 0 {
		if user, ok := service.userRepository.FindByID(item.CompletedByUserID); ok {
			completedBy = strings.TrimSpace(user.Name)
			if completedBy == "" {
				completedBy = user.Username
			}
		}
	}

	attachments := service.repository.ListAttachmentsByFeedbackID(item.ID)
	attachmentDTOs := make([]model.DebugFeedbackAttachmentDTO, 0, len(attachments))
	for _, attachment := range attachments {
		version, ok := service.fileRepository.FindVersion(attachment.FileID, attachment.VersionNo)
		if !ok {
			continue
		}
		attachmentDTOs = append(attachmentDTOs, model.DebugFeedbackAttachmentDTO{
			ID:        attachment.ID,
			FileID:    attachment.FileID,
			VersionNo: attachment.VersionNo,
			Name:      version.OriginName,
			MimeType:  version.MimeType,
			Size:      version.SizeBytes,
		})
	}

	submitterName := ""
	submitterUsername := ""
	submitterRole := ""
	if submitterOK {
		submitterName = submitter.Name
		submitterUsername = submitter.Username
		submitterRole = submitter.Role
	}

	return model.DebugFeedbackItemDTO{
		ID:                item.ID,
		Title:             item.Title,
		Type:              item.Type,
		Description:       item.Description,
		Status:            item.Status,
		Attachments:       attachmentDTOs,
		SubmitterID:       item.SubmitterID,
		SubmitterUsername: submitterUsername,
		SubmitterName:     submitterName,
		SubmitterRole:     submitterRole,
		CreatedAt:         item.CreatedAt,
		CompletedAt:       item.CompletedAt,
		CompletedBy:       completedBy,
	}
}
