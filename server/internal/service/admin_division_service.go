package service

import (
	"context"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type AdminDivisionService interface {
	List(ctx context.Context, query model.AdminDivisionListQuery) (model.AdminDivisionPageResult, *model.APIError)
	GetByCode(ctx context.Context, code string) (model.AdminDivisionByCodeResult, *model.APIError)
	GetParentChain(ctx context.Context, code string) ([]model.AdminDivisionChainNode, *model.APIError)
}

type adminDivisionService struct {
	repository repository.AdminDivisionRepository
}

func NewAdminDivisionService(repository repository.AdminDivisionRepository) AdminDivisionService {
	return &adminDivisionService{repository: repository}
}

func (service *adminDivisionService) List(_ context.Context, query model.AdminDivisionListQuery) (model.AdminDivisionPageResult, *model.APIError) {
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.PageSize <= 0 {
		query.PageSize = 10
	}
	if query.PageSize > 100 {
		query.PageSize = 100
	}
	query.Keyword = strings.TrimSpace(query.Keyword)
	query.ParentCode = strings.TrimSpace(query.ParentCode)
	return service.repository.FindPage(query), nil
}

func (service *adminDivisionService) GetByCode(_ context.Context, code string) (model.AdminDivisionByCodeResult, *model.APIError) {
	current, ok := service.repository.FindByCode(strings.TrimSpace(code))
	if !ok {
		return model.AdminDivisionByCodeResult{}, model.NewAPIError(404, response.CodeNotFound, "行政区划不存在")
	}
	parentChain, _ := service.repository.FindParentChainByCode(current.Code)
	return model.AdminDivisionByCodeResult{
		Current:     current,
		ParentChain: parentChain,
	}, nil
}

func (service *adminDivisionService) GetParentChain(_ context.Context, code string) ([]model.AdminDivisionChainNode, *model.APIError) {
	parentChain, ok := service.repository.FindParentChainByCode(strings.TrimSpace(code))
	if !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "行政区划不存在")
	}
	return parentChain, nil
}

