package service

import (
	"context"
	"sort"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type RegionService interface {
	GetByID(ctx context.Context, regionID int64) (model.RegionDetailDTO, *model.APIError)
	GetByAdminCode(ctx context.Context, adminCode string) (*model.RegionDetailDTO, *model.APIError)
	List(ctx context.Context, query model.RegionListQuery) (model.RegionPageResult, *model.APIError)
	Create(ctx context.Context, request model.CreateRegionRequest, operatorID int64) (model.RegionDetailDTO, *model.APIError)
	Update(ctx context.Context, regionID int64, request model.UpdateRegionRequest, operatorID int64) (model.RegionDetailDTO, *model.APIError)
	ValidateConflict(ctx context.Context, request model.CreateRegionRequest, excludeRegionID *int64) (model.ConflictResponse, *model.APIError)
	Delete(ctx context.Context, regionID int64) *model.APIError
	ListEconomies(ctx context.Context, regionID int64) ([]model.RegionEconomy, *model.APIError)
	CreateEconomy(ctx context.Context, regionID int64, economy model.RegionEconomy, operatorID int64) (model.RegionEconomy, *model.APIError)
	UpdateEconomy(ctx context.Context, regionID int64, economyID int64, economy model.RegionEconomy, operatorID int64) (model.RegionEconomy, *model.APIError)
	DeleteEconomy(ctx context.Context, regionID int64, economyID int64) *model.APIError
	ListRanks(ctx context.Context, regionID int64) ([]model.RegionRank, *model.APIError)
	CreateRank(ctx context.Context, regionID int64, rank model.RegionRank, operatorID int64) (model.RegionRank, *model.APIError)
	UpdateRank(ctx context.Context, regionID int64, rankID int64, rank model.RegionRank, operatorID int64) (model.RegionRank, *model.APIError)
	DeleteRank(ctx context.Context, regionID int64, rankID int64) *model.APIError
}

type regionService struct {
	repository repository.RegionRepository
}

func NewRegionService(repository repository.RegionRepository) RegionService {
	return &regionService{repository: repository}
}

func (service *regionService) GetByID(_ context.Context, regionID int64) (model.RegionDetailDTO, *model.APIError) {
	detail, ok := service.repository.FindByID(regionID)
	if !ok {
		return model.RegionDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "区域不存在")
	}
	return detail, nil
}

func (service *regionService) GetByAdminCode(_ context.Context, adminCode string) (*model.RegionDetailDTO, *model.APIError) {
	detail, ok := service.repository.FindByAdminCode(strings.TrimSpace(adminCode))
	if !ok {
		return nil, nil
	}
	return &detail, nil
}

func (service *regionService) List(_ context.Context, query model.RegionListQuery) (model.RegionPageResult, *model.APIError) {
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
	return service.repository.FindPage(query), nil
}

func (service *regionService) Create(_ context.Context, request model.CreateRegionRequest, operatorID int64) (model.RegionDetailDTO, *model.APIError) {
	request = normalizeRegionRequest(request)
	if request.AdminCode == "" {
		return model.RegionDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "行政登记编码不能为空")
	}
	if existing, exists := service.repository.FindByAdminCode(request.AdminCode); exists {
		updated, ok := service.repository.Update(existing.ID, model.Region{
			BaseEntity: model.BaseEntity{
				UpdatedBy: operatorID,
			},
			AdminCode:  request.AdminCode,
			RegionCode: request.RegionCode,
			RegionName: request.RegionName,
			Overview:   request.Overview,
		}, request.Economies, request.Ranks)
		if !ok {
			return model.RegionDetailDTO{}, model.NewAPIError(500, response.CodeInternal, "更新区域失败")
		}
		return updated, nil
	}
	created := service.repository.Create(model.Region{
		BaseEntity: model.BaseEntity{
			CreatedBy: operatorID,
			UpdatedBy: operatorID,
		},
		AdminCode:  request.AdminCode,
		RegionCode: request.RegionCode,
		RegionName: request.RegionName,
		Overview:   request.Overview,
	}, request.Economies, request.Ranks)
	if created.ID <= 0 {
		return model.RegionDetailDTO{}, model.NewAPIError(500, response.CodeInternal, "创建区域失败")
	}
	return created, nil
}

func (service *regionService) Update(_ context.Context, regionID int64, request model.UpdateRegionRequest, operatorID int64) (model.RegionDetailDTO, *model.APIError) {
	request = normalizeRegionRequest(request)
	if request.AdminCode == "" {
		return model.RegionDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "行政登记编码不能为空")
	}
	if existingByCode, exists := service.repository.FindByAdminCode(request.AdminCode); exists && existingByCode.ID != regionID {
		return model.RegionDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "行政登记编码已存在")
	}
	updated, ok := service.repository.Update(regionID, model.Region{
		BaseEntity: model.BaseEntity{
			UpdatedBy: operatorID,
		},
		AdminCode:  request.AdminCode,
		RegionCode: request.RegionCode,
		RegionName: request.RegionName,
		Overview:   request.Overview,
	}, request.Economies, request.Ranks)
	if !ok {
		return model.RegionDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "区域不存在")
	}
	return updated, nil
}

func (service *regionService) ValidateConflict(_ context.Context, request model.CreateRegionRequest, excludeRegionID *int64) (model.ConflictResponse, *model.APIError) {
	request = normalizeRegionRequest(request)
	result := model.ConflictResponse{
		Conflict:    false,
		EntityType:  "region",
		Identity:    request.AdminCode,
		Differences: []model.ConflictDifference{},
	}
	if request.AdminCode == "" {
		return result, model.NewAPIError(400, response.CodeBadRequest, "行政登记编码不能为空")
	}

	existing, exists := service.repository.FindByAdminCode(request.AdminCode)
	if !exists {
		return result, nil
	}
	if excludeRegionID != nil && *excludeRegionID > 0 && existing.ID == *excludeRegionID {
		// 对同一实体也需要做完整比对，继续执行
	}

	incomingComparable := toComparableRegionRequest(request)
	existingComparable := toComparableRegionRequest(regionDetailToCreateRequest(existing))
	differences := buildDifferences(existingComparable, incomingComparable)
	if len(differences) > 0 {
		result.Conflict = true
		result.Differences = differences
	}
	return result, nil
}

func (service *regionService) Delete(_ context.Context, regionID int64) *model.APIError {
	if !service.repository.Delete(regionID) {
		return model.NewAPIError(404, response.CodeNotFound, "区域不存在")
	}
	return nil
}

func (service *regionService) ListEconomies(_ context.Context, regionID int64) ([]model.RegionEconomy, *model.APIError) {
	economies, ok := service.repository.ListEconomies(regionID)
	if !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "区域不存在")
	}
	return economies, nil
}

func (service *regionService) CreateEconomy(_ context.Context, regionID int64, economy model.RegionEconomy, operatorID int64) (model.RegionEconomy, *model.APIError) {
	normalized, apiErr := normalizeEconomyRequest(economy)
	if apiErr != nil {
		return model.RegionEconomy{}, apiErr
	}
	normalized.CreatedBy = operatorID
	normalized.UpdatedBy = operatorID
	created, ok := service.repository.CreateEconomy(regionID, normalized)
	if !ok {
		return model.RegionEconomy{}, model.NewAPIError(400, response.CodeBadRequest, "区域不存在或年份重复")
	}
	return created, nil
}

func (service *regionService) UpdateEconomy(_ context.Context, regionID int64, economyID int64, economy model.RegionEconomy, operatorID int64) (model.RegionEconomy, *model.APIError) {
	normalized, apiErr := normalizeEconomyRequest(economy)
	if apiErr != nil {
		return model.RegionEconomy{}, apiErr
	}
	normalized.UpdatedBy = operatorID
	updated, ok := service.repository.UpdateEconomy(regionID, economyID, normalized)
	if !ok {
		return model.RegionEconomy{}, model.NewAPIError(400, response.CodeBadRequest, "区域经济不存在或年份重复")
	}
	return updated, nil
}

func (service *regionService) DeleteEconomy(_ context.Context, regionID int64, economyID int64) *model.APIError {
	if !service.repository.DeleteEconomy(regionID, economyID) {
		return model.NewAPIError(404, response.CodeNotFound, "区域经济不存在")
	}
	return nil
}

func (service *regionService) ListRanks(_ context.Context, regionID int64) ([]model.RegionRank, *model.APIError) {
	ranks, ok := service.repository.ListRanks(regionID)
	if !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "区域不存在")
	}
	return ranks, nil
}

func (service *regionService) CreateRank(_ context.Context, regionID int64, rank model.RegionRank, operatorID int64) (model.RegionRank, *model.APIError) {
	normalized, apiErr := normalizeRankRequest(rank)
	if apiErr != nil {
		return model.RegionRank{}, apiErr
	}
	normalized.CreatedBy = operatorID
	normalized.UpdatedBy = operatorID
	created, ok := service.repository.CreateRank(regionID, normalized)
	if !ok {
		return model.RegionRank{}, model.NewAPIError(400, response.CodeBadRequest, "区域不存在或科目年份重复")
	}
	return created, nil
}

func (service *regionService) UpdateRank(_ context.Context, regionID int64, rankID int64, rank model.RegionRank, operatorID int64) (model.RegionRank, *model.APIError) {
	normalized, apiErr := normalizeRankRequest(rank)
	if apiErr != nil {
		return model.RegionRank{}, apiErr
	}
	normalized.UpdatedBy = operatorID
	updated, ok := service.repository.UpdateRank(regionID, rankID, normalized)
	if !ok {
		return model.RegionRank{}, model.NewAPIError(400, response.CodeBadRequest, "区域排名不存在或科目年份重复")
	}
	return updated, nil
}

func (service *regionService) DeleteRank(_ context.Context, regionID int64, rankID int64) *model.APIError {
	if !service.repository.DeleteRank(regionID, rankID) {
		return model.NewAPIError(404, response.CodeNotFound, "区域排名不存在")
	}
	return nil
}

func normalizeRegionRequest(request model.CreateRegionRequest) model.CreateRegionRequest {
	request.AdminCode = strings.TrimSpace(request.AdminCode)
	request.RegionCode = strings.TrimSpace(request.RegionCode)
	request.RegionName = strings.TrimSpace(request.RegionName)
	request.Overview = strings.TrimSpace(request.Overview)
	sort.Slice(request.Economies, func(i, j int) bool {
		return request.Economies[i].Year < request.Economies[j].Year
	})
	for index := range request.Ranks {
		request.Ranks[index].Subject = strings.TrimSpace(request.Ranks[index].Subject)
	}
	sort.Slice(request.Ranks, func(i, j int) bool {
		if request.Ranks[i].Year == request.Ranks[j].Year {
			return request.Ranks[i].Subject < request.Ranks[j].Subject
		}
		return request.Ranks[i].Year < request.Ranks[j].Year
	})
	return request
}

func normalizeEconomyRequest(request model.RegionEconomy) (model.RegionEconomy, *model.APIError) {
	if request.Year < 1900 {
		return model.RegionEconomy{}, model.NewAPIError(400, response.CodeBadRequest, "年份不合法")
	}
	return request, nil
}

func normalizeRankRequest(request model.RegionRank) (model.RegionRank, *model.APIError) {
	request.Subject = strings.TrimSpace(request.Subject)
	if request.Subject == "" {
		return model.RegionRank{}, model.NewAPIError(400, response.CodeBadRequest, "科目不能为空")
	}
	if request.Year < 1900 {
		return model.RegionRank{}, model.NewAPIError(400, response.CodeBadRequest, "年份不合法")
	}
	return request, nil
}

func regionDetailToCreateRequest(detail model.RegionDetailDTO) model.CreateRegionRequest {
	return model.CreateRegionRequest{
		AdminCode:  detail.AdminCode,
		RegionCode: detail.RegionCode,
		RegionName: detail.RegionName,
		Overview:   detail.Overview,
		Economies:  detail.Economies,
		Ranks:      detail.Ranks,
	}
}

func toComparableRegionRequest(request model.CreateRegionRequest) model.CreateRegionRequest {
	comparable := normalizeRegionRequest(request)
	sort.Slice(comparable.Economies, func(i, j int) bool {
		return comparable.Economies[i].Year < comparable.Economies[j].Year
	})
	sort.Slice(comparable.Ranks, func(i, j int) bool {
		if comparable.Ranks[i].Year == comparable.Ranks[j].Year {
			return comparable.Ranks[i].Subject < comparable.Ranks[j].Subject
		}
		return comparable.Ranks[i].Year < comparable.Ranks[j].Year
	})
	return comparable
}
