package service

import (
	"context"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type EnterpriseService interface {
	GetByID(ctx context.Context, enterpriseID int64) (model.EnterpriseDetailDTO, *model.APIError)
	List(ctx context.Context, query model.EnterpriseListQuery) (model.EnterprisePageResult, *model.APIError)
	Create(ctx context.Context, request model.CreateEnterpriseRequest, operatorID int64) (model.EnterpriseDetailDTO, *model.APIError)
	Update(ctx context.Context, enterpriseID int64, request model.UpdateEnterpriseRequest, operatorID int64) (model.EnterpriseDetailDTO, *model.APIError)
	Delete(ctx context.Context, enterpriseID int64, operatorID int64) *model.APIError
}

type enterpriseService struct {
	repository repository.EnterpriseRepository
}

func NewEnterpriseService(repository repository.EnterpriseRepository) EnterpriseService {
	return &enterpriseService{repository: repository}
}

func (service *enterpriseService) GetByID(_ context.Context, enterpriseID int64) (model.EnterpriseDetailDTO, *model.APIError) {
	detail, ok := service.repository.FindByID(enterpriseID)
	if !ok {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "企业不存在")
	}
	return detail, nil
}

func (service *enterpriseService) List(_ context.Context, query model.EnterpriseListQuery) (model.EnterprisePageResult, *model.APIError) {
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
	query.Region = strings.TrimSpace(query.Region)
	return service.repository.FindPage(query), nil
}

func (service *enterpriseService) Create(_ context.Context, request model.CreateEnterpriseRequest, operatorID int64) (model.EnterpriseDetailDTO, *model.APIError) {
	normalized := normalizeEnterpriseRequest(request)
	if normalized.ShortName == "" || normalized.UnifiedCreditCode == "" {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "企业简称、统一信用代码不能为空")
	}
	if _, exists := service.repository.FindByUnifiedCreditCode(normalized.UnifiedCreditCode); exists {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "统一信用代码已存在")
	}

	aggregate := toAggregate(normalized, operatorID)
	created := service.repository.Create(aggregate)
	if created.ID <= 0 {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(500, response.CodeInternal, "创建企业失败")
	}
	return created, nil
}

func (service *enterpriseService) Update(_ context.Context, enterpriseID int64, request model.UpdateEnterpriseRequest, operatorID int64) (model.EnterpriseDetailDTO, *model.APIError) {
	normalized := normalizeEnterpriseRequest(request)
	if normalized.ShortName == "" || normalized.UnifiedCreditCode == "" {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "企业简称、统一信用代码不能为空")
	}

	existing, ok := service.repository.FindByID(enterpriseID)
	if !ok {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "企业不存在")
	}
	if existing.UnifiedCreditCode != normalized.UnifiedCreditCode {
		if duplicated, exists := service.repository.FindByUnifiedCreditCode(normalized.UnifiedCreditCode); exists && duplicated.ID != enterpriseID {
			return model.EnterpriseDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "统一信用代码已存在")
		}
	}

	aggregate := toAggregate(normalized, operatorID)
	updated, updatedOK := service.repository.Update(enterpriseID, aggregate)
	if !updatedOK {
		return model.EnterpriseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "企业不存在")
	}
	return updated, nil
}

func (service *enterpriseService) Delete(_ context.Context, enterpriseID int64, operatorID int64) *model.APIError {
	if !service.repository.Delete(enterpriseID, operatorID) {
		return model.NewAPIError(404, response.CodeNotFound, "企业不存在")
	}
	return nil
}

func normalizeEnterpriseRequest(request model.CreateEnterpriseRequest) model.CreateEnterpriseRequest {
	request.ShortName = strings.TrimSpace(request.ShortName)
	request.Region = strings.TrimSpace(request.Region)
	request.EnterpriseLevel = strings.TrimSpace(request.EnterpriseLevel)
	request.MainBusinessType = strings.TrimSpace(request.MainBusinessType)
	request.MainBusiness = strings.TrimSpace(request.MainBusiness)
	request.RelatedPartyPublicOpinion = strings.TrimSpace(request.RelatedPartyPublicOpinion)
	request.Industry = strings.TrimSpace(request.Industry)
	request.Address = strings.TrimSpace(request.Address)
	request.BusinessScope = strings.TrimSpace(request.BusinessScope)
	request.LegalPerson = strings.TrimSpace(request.LegalPerson)
	request.CompanyType = strings.TrimSpace(request.CompanyType)
	request.EnterpriseNature = strings.TrimSpace(request.EnterpriseNature)
	request.ActualController = strings.TrimSpace(request.ActualController)
	request.ActualControllerControlPath = strings.TrimSpace(request.ActualControllerControlPath)
	request.UnifiedCreditCode = strings.TrimSpace(request.UnifiedCreditCode)
	request.LegalPersonIDCard = strings.TrimSpace(request.LegalPersonIDCard)

	for i := range request.Tags {
		request.Tags[i].Title = strings.TrimSpace(request.Tags[i].Title)
	}
	for i := range request.PublicOpinions {
		request.PublicOpinions[i].Source = strings.TrimSpace(request.PublicOpinions[i].Source)
		request.PublicOpinions[i].Issue = strings.TrimSpace(request.PublicOpinions[i].Issue)
		request.PublicOpinions[i].Title = strings.TrimSpace(request.PublicOpinions[i].Title)
	}
	for i := range request.BondTenders {
		request.BondTenders[i].Type = strings.TrimSpace(request.BondTenders[i].Type)
		request.BondTenders[i].ProjectType = strings.TrimSpace(request.BondTenders[i].ProjectType)
		request.BondTenders[i].Winner = strings.TrimSpace(request.BondTenders[i].Winner)
		request.BondTenders[i].TenderTitle = strings.TrimSpace(request.BondTenders[i].TenderTitle)
	}
	for i := range request.BondDetails {
		request.BondDetails[i].ShortName = strings.TrimSpace(request.BondDetails[i].ShortName)
		request.BondDetails[i].Code = strings.TrimSpace(request.BondDetails[i].Code)
		request.BondDetails[i].Type = strings.TrimSpace(request.BondDetails[i].Type)
		request.BondDetails[i].Term = strings.TrimSpace(request.BondDetails[i].Term)
		request.BondDetails[i].Rating = strings.TrimSpace(request.BondDetails[i].Rating)
		request.BondDetails[i].Guarantor = strings.TrimSpace(request.BondDetails[i].Guarantor)
	}
	for i := range request.BondRegistrations {
		request.BondRegistrations[i].ProjectName = strings.TrimSpace(request.BondRegistrations[i].ProjectName)
		request.BondRegistrations[i].Status = strings.TrimSpace(request.BondRegistrations[i].Status)
		request.BondRegistrations[i].Process = strings.TrimSpace(request.BondRegistrations[i].Process)
	}
	for i := range request.FinanceSubjects {
		request.FinanceSubjects[i].SubjectName = strings.TrimSpace(request.FinanceSubjects[i].SubjectName)
		request.FinanceSubjects[i].SubjectType = strings.TrimSpace(request.FinanceSubjects[i].SubjectType)
	}
	for i := range request.Shareholders {
		request.Shareholders[i].ShareholderID = strings.TrimSpace(request.Shareholders[i].ShareholderID)
	}
	if request.FinanceSnapshot != nil {
		request.FinanceSnapshot.MainBusiness1 = strings.TrimSpace(request.FinanceSnapshot.MainBusiness1)
		request.FinanceSnapshot.MainBusiness2 = strings.TrimSpace(request.FinanceSnapshot.MainBusiness2)
		request.FinanceSnapshot.MainBusiness3 = strings.TrimSpace(request.FinanceSnapshot.MainBusiness3)
		request.FinanceSnapshot.MainBusiness4 = strings.TrimSpace(request.FinanceSnapshot.MainBusiness4)
		request.FinanceSnapshot.MainBusiness5 = strings.TrimSpace(request.FinanceSnapshot.MainBusiness5)
	}
	return request
}

func toAggregate(request model.CreateEnterpriseRequest, operatorID int64) model.EnterpriseAggregate {
	return model.EnterpriseAggregate{
		Enterprise: model.Enterprise{
			BaseEntity: model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
			ShortName:                         request.ShortName,
			Region:                            request.Region,
			InHiddenDebtList:                  request.InHiddenDebtList,
			In3899List:                        request.In3899List,
			Meets335Indicator:                 request.Meets335Indicator,
			Meets224Indicator:                 request.Meets224Indicator,
			EnterpriseLevel:                   request.EnterpriseLevel,
			NetAssets:                         request.NetAssets,
			RealEstateRevenueRatio:            request.RealEstateRevenueRatio,
			MainBusinessType:                  request.MainBusinessType,
			EstablishedAt:                     request.EstablishedAt,
			LiabilityAssetRatio:               request.LiabilityAssetRatio,
			LiabilityAssetRatioIndustryMedian: request.LiabilityAssetRatioIndustryMedian,
			NonStandardFinancingRatio:         request.NonStandardFinancingRatio,
			MainBusiness:                      request.MainBusiness,
			RelatedPartyPublicOpinion:         request.RelatedPartyPublicOpinion,
			AdmissionStatus:                   request.AdmissionStatus,
			CalculatedAt:                      request.CalculatedAt,
			RegisteredCapital:                 request.RegisteredCapital,
			PaidInCapital:                     request.PaidInCapital,
			Industry:                          request.Industry,
			Address:                           request.Address,
			BusinessScope:                     request.BusinessScope,
			LegalPerson:                       request.LegalPerson,
			CompanyType:                       request.CompanyType,
			EnterpriseNature:                  request.EnterpriseNature,
			ActualController:                  request.ActualController,
			ActualControllerControlPath:       request.ActualControllerControlPath,
			UnifiedCreditCode:                 request.UnifiedCreditCode,
			LegalPersonIDCard:                 request.LegalPersonIDCard,
			Status:                            model.EnterpriseStatusActive,
		},
		Tags:              request.Tags,
		PublicOpinions:    request.PublicOpinions,
		BondTenders:       request.BondTenders,
		BondDetails:       request.BondDetails,
		BondRegistrations: request.BondRegistrations,
		FinanceSnapshot:   request.FinanceSnapshot,
		FinanceSubjects:   request.FinanceSubjects,
		Shareholders:      request.Shareholders,
	}
}
