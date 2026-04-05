package handler

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type enterpriseIDPathRequest struct {
	EnterpriseID int64 `path:"enterpriseId" validate:"required,min=1"`
}

type listEnterprisesRequest struct {
	Page            *int64 `query:"page" validate:"min=1"`
	PageSize        *int64 `query:"pageSize" validate:"min=1,max=100"`
	Keyword         string `query:"keyword"`
	RegionID        *int64 `query:"regionId" validate:"omitempty,min=1"`
	AdmissionStatus *bool  `query:"admissionStatus"`
}

type enterpriseShortNameRequest struct {
	ShortName string `query:"shortName" validate:"required"`
}

type createEnterpriseRequest struct {
	ShortName                         string                          `json:"shortName" validate:"required"`
	RegionID                          int64                           `json:"regionId" validate:"required,min=1"`
	InHiddenDebtList                  bool                            `json:"inHiddenDebtList"`
	In3899List                        bool                            `json:"in3899List"`
	Meets335Indicator                 bool                            `json:"meets335Indicator"`
	Meets224Indicator                 bool                            `json:"meets224Indicator"`
	EnterpriseLevel                   string                          `json:"enterpriseLevel"`
	NetAssets                         *float64                        `json:"netAssets"`
	RealEstateRevenueRatio            *float64                        `json:"realEstateRevenueRatio"`
	MainBusinessType                  string                          `json:"mainBusinessType"`
	EstablishedAt                     *string                         `json:"establishedAt"`
	LiabilityAssetRatio               *float64                        `json:"liabilityAssetRatio"`
	LiabilityAssetRatioIndustryMedian *float64                        `json:"liabilityAssetRatioIndustryMedian"`
	NonStandardFinancingRatio         *float64                        `json:"nonStandardFinancingRatio"`
	MainBusiness                      string                          `json:"mainBusiness"`
	RelatedPartyPublicOpinion         string                          `json:"relatedPartyPublicOpinion"`
	AdmissionStatus                   bool                            `json:"admissionStatus"`
	CalculatedAt                      *string                         `json:"calculatedAt"`
	RegisteredCapital                 *float64                        `json:"registeredCapital"`
	PaidInCapital                     *float64                        `json:"paidInCapital"`
	Industry                          string                          `json:"industry"`
	Address                           string                          `json:"address"`
	BusinessScope                     string                          `json:"businessScope"`
	LegalPerson                       string                          `json:"legalPerson"`
	CompanyType                       string                          `json:"companyType"`
	EnterpriseNature                  string                          `json:"enterpriseNature"`
	ActualController                  string                          `json:"actualController"`
	ActualControllerControlPath       string                          `json:"actualControllerControlPath"`
	IssuerRating                      string                          `json:"issuerRating"`
	IssuerRatingAgency                string                          `json:"issuerRatingAgency"`
	UnifiedCreditCode                 string                          `json:"unifiedCreditCode" validate:"required"`
	LegalPersonIDCard                 string                          `json:"legalPersonIdCard"`
	Tags                              []model.EnterpriseTag           `json:"tags"`
	PublicOpinions                    []model.EnterprisePublicOpinion `json:"publicOpinions"`
	BondTenders                       []model.EnterpriseBondTender    `json:"bondTenders"`
	BondDetails                       []model.EnterpriseBondDetail    `json:"bondDetails"`
	BondRegistrations                 []model.EnterpriseBondRegistration `json:"bondRegistrations"`
	FinanceSnapshot                   *model.EnterpriseFinanceSnapshot `json:"financeSnapshot"`
	FinanceSubjects                   []model.EnterpriseFinanceSubject `json:"financeSubjects"`
	Shareholders                      []model.EnterpriseShareholder    `json:"shareholders"`
}

type enterpriseValidateConflictRequest struct {
	ExcludeEnterpriseID               *int64                          `json:"excludeEnterpriseId" validate:"omitempty,min=1"`
	ShortName                         string                          `json:"shortName" validate:"required"`
	RegionID                          int64                           `json:"regionId" validate:"required,min=1"`
	InHiddenDebtList                  bool                            `json:"inHiddenDebtList"`
	In3899List                        bool                            `json:"in3899List"`
	Meets335Indicator                 bool                            `json:"meets335Indicator"`
	Meets224Indicator                 bool                            `json:"meets224Indicator"`
	EnterpriseLevel                   string                          `json:"enterpriseLevel"`
	NetAssets                         *float64                        `json:"netAssets"`
	RealEstateRevenueRatio            *float64                        `json:"realEstateRevenueRatio"`
	MainBusinessType                  string                          `json:"mainBusinessType"`
	EstablishedAt                     *string                         `json:"establishedAt"`
	LiabilityAssetRatio               *float64                        `json:"liabilityAssetRatio"`
	LiabilityAssetRatioIndustryMedian *float64                        `json:"liabilityAssetRatioIndustryMedian"`
	NonStandardFinancingRatio         *float64                        `json:"nonStandardFinancingRatio"`
	MainBusiness                      string                          `json:"mainBusiness"`
	RelatedPartyPublicOpinion         string                          `json:"relatedPartyPublicOpinion"`
	AdmissionStatus                   bool                            `json:"admissionStatus"`
	CalculatedAt                      *string                         `json:"calculatedAt"`
	RegisteredCapital                 *float64                        `json:"registeredCapital"`
	PaidInCapital                     *float64                        `json:"paidInCapital"`
	Industry                          string                          `json:"industry"`
	Address                           string                          `json:"address"`
	BusinessScope                     string                          `json:"businessScope"`
	LegalPerson                       string                          `json:"legalPerson"`
	CompanyType                       string                          `json:"companyType"`
	EnterpriseNature                  string                          `json:"enterpriseNature"`
	ActualController                  string                          `json:"actualController"`
	ActualControllerControlPath       string                          `json:"actualControllerControlPath"`
	IssuerRating                      string                          `json:"issuerRating"`
	IssuerRatingAgency                string                          `json:"issuerRatingAgency"`
	UnifiedCreditCode                 string                          `json:"unifiedCreditCode" validate:"required"`
	LegalPersonIDCard                 string                          `json:"legalPersonIdCard"`
	Tags                              []model.EnterpriseTag           `json:"tags"`
	PublicOpinions                    []model.EnterprisePublicOpinion `json:"publicOpinions"`
	BondTenders                       []model.EnterpriseBondTender    `json:"bondTenders"`
	BondDetails                       []model.EnterpriseBondDetail    `json:"bondDetails"`
	BondRegistrations                 []model.EnterpriseBondRegistration `json:"bondRegistrations"`
	FinanceSnapshot                   *model.EnterpriseFinanceSnapshot `json:"financeSnapshot"`
	FinanceSubjects                   []model.EnterpriseFinanceSubject `json:"financeSubjects"`
	Shareholders                      []model.EnterpriseShareholder    `json:"shareholders"`
}

type updateEnterpriseRequest struct {
	EnterpriseID                      int64                           `path:"enterpriseId" validate:"required,min=1"`
	ShortName                         string                          `json:"shortName" validate:"required"`
	RegionID                          int64                           `json:"regionId" validate:"required,min=1"`
	InHiddenDebtList                  bool                            `json:"inHiddenDebtList"`
	In3899List                        bool                            `json:"in3899List"`
	Meets335Indicator                 bool                            `json:"meets335Indicator"`
	Meets224Indicator                 bool                            `json:"meets224Indicator"`
	EnterpriseLevel                   string                          `json:"enterpriseLevel"`
	NetAssets                         *float64                        `json:"netAssets"`
	RealEstateRevenueRatio            *float64                        `json:"realEstateRevenueRatio"`
	MainBusinessType                  string                          `json:"mainBusinessType"`
	EstablishedAt                     *string                         `json:"establishedAt"`
	LiabilityAssetRatio               *float64                        `json:"liabilityAssetRatio"`
	LiabilityAssetRatioIndustryMedian *float64                        `json:"liabilityAssetRatioIndustryMedian"`
	NonStandardFinancingRatio         *float64                        `json:"nonStandardFinancingRatio"`
	MainBusiness                      string                          `json:"mainBusiness"`
	RelatedPartyPublicOpinion         string                          `json:"relatedPartyPublicOpinion"`
	AdmissionStatus                   bool                            `json:"admissionStatus"`
	CalculatedAt                      *string                         `json:"calculatedAt"`
	RegisteredCapital                 *float64                        `json:"registeredCapital"`
	PaidInCapital                     *float64                        `json:"paidInCapital"`
	Industry                          string                          `json:"industry"`
	Address                           string                          `json:"address"`
	BusinessScope                     string                          `json:"businessScope"`
	LegalPerson                       string                          `json:"legalPerson"`
	CompanyType                       string                          `json:"companyType"`
	EnterpriseNature                  string                          `json:"enterpriseNature"`
	ActualController                  string                          `json:"actualController"`
	ActualControllerControlPath       string                          `json:"actualControllerControlPath"`
	IssuerRating                      string                          `json:"issuerRating"`
	IssuerRatingAgency                string                          `json:"issuerRatingAgency"`
	UnifiedCreditCode                 string                          `json:"unifiedCreditCode" validate:"required"`
	LegalPersonIDCard                 string                          `json:"legalPersonIdCard"`
	Tags                              []model.EnterpriseTag           `json:"tags"`
	PublicOpinions                    []model.EnterprisePublicOpinion `json:"publicOpinions"`
	BondTenders                       []model.EnterpriseBondTender    `json:"bondTenders"`
	BondDetails                       []model.EnterpriseBondDetail    `json:"bondDetails"`
	BondRegistrations                 []model.EnterpriseBondRegistration `json:"bondRegistrations"`
	FinanceSnapshot                   *model.EnterpriseFinanceSnapshot `json:"financeSnapshot"`
	FinanceSubjects                   []model.EnterpriseFinanceSubject `json:"financeSubjects"`
	Shareholders                      []model.EnterpriseShareholder    `json:"shareholders"`
}

type EnterpriseHandler struct {
	service  service.EnterpriseService
	registry *apimeta.Registry
}

func NewEnterpriseHandler(service service.EnterpriseService, registry *apimeta.Registry) *EnterpriseHandler {
	return &EnterpriseHandler{service: service, registry: registry}
}

func (handler *EnterpriseHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[listEnterprisesRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprises",
		Summary:            "分页查询企业",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterprisePageResult](),
	}, handler.List)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseShortNameRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprises/by-short-name",
		Summary:            "按企业简称查询企业",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[*model.EnterpriseDetailDTO](),
	}, handler.GetByShortName)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseValidateConflictRequest]{
		Method:             fiber.MethodPost,
		Path:               "/enterprises/validate-conflict",
		Summary:            "校验企业更新冲突",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ConflictResponse](),
	}, handler.ValidateConflict)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprises/:enterpriseId",
		Summary:            "查询企业详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseDetailDTO](),
	}, handler.GetByID)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createEnterpriseRequest]{
		Method:             fiber.MethodPost,
		Path:               "/enterprises",
		Summary:            "创建企业",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseDetailDTO](),
	}, handler.Create)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateEnterpriseRequest]{
		Method:             fiber.MethodPut,
		Path:               "/enterprises/:enterpriseId",
		Summary:            "更新企业",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseDetailDTO](),
	}, handler.Update)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/enterprises/:enterpriseId",
		Summary:            "删除企业（软删除）",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.Delete)
}

func (handler *EnterpriseHandler) GetByShortName(c *fiber.Ctx, request *enterpriseShortNameRequest) error {
	detail, apiError := handler.service.GetByShortName(c.UserContext(), request.ShortName)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, detail, "获取企业信息成功")
}

func (handler *EnterpriseHandler) List(c *fiber.Ctx, request *listEnterprisesRequest) error {
	page := 1
	if request.Page != nil {
		page = int(*request.Page)
	}
	pageSize := 10
	if request.PageSize != nil {
		pageSize = int(*request.PageSize)
	}

	regionID := int64(0)
	if request.RegionID != nil {
		regionID = *request.RegionID
	}
	result, apiError := handler.service.List(c.UserContext(), model.EnterpriseListQuery{
		Page:            page,
		PageSize:        pageSize,
		Keyword:         strings.TrimSpace(request.Keyword),
		RegionID:        regionID,
		AdmissionStatus: request.AdmissionStatus,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取企业列表成功")
}

func (handler *EnterpriseHandler) GetByID(c *fiber.Ctx, request *enterpriseIDPathRequest) error {
	detail, apiError := handler.service.GetByID(c.UserContext(), request.EnterpriseID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, detail, "获取企业详情成功")
}

func (handler *EnterpriseHandler) Create(c *fiber.Ctx, request *createEnterpriseRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	created, apiError := handler.service.Create(c.UserContext(), enterpriseRequestToModel(request), operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, created, "保存企业成功")
}

func (handler *EnterpriseHandler) Update(c *fiber.Ctx, request *updateEnterpriseRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	updated, apiError := handler.service.Update(c.UserContext(), request.EnterpriseID, model.UpdateEnterpriseRequest{
		ShortName:                         request.ShortName,
		RegionID:                          request.RegionID,
		InHiddenDebtList:                  request.InHiddenDebtList,
		In3899List:                        request.In3899List,
		Meets335Indicator:                 request.Meets335Indicator,
		Meets224Indicator:                 request.Meets224Indicator,
		EnterpriseLevel:                   request.EnterpriseLevel,
		NetAssets:                         request.NetAssets,
		RealEstateRevenueRatio:            request.RealEstateRevenueRatio,
		MainBusinessType:                  request.MainBusinessType,
		EstablishedAt:                     parseRFC3339(request.EstablishedAt),
		LiabilityAssetRatio:               request.LiabilityAssetRatio,
		LiabilityAssetRatioIndustryMedian: request.LiabilityAssetRatioIndustryMedian,
		NonStandardFinancingRatio:         request.NonStandardFinancingRatio,
		MainBusiness:                      request.MainBusiness,
		RelatedPartyPublicOpinion:         request.RelatedPartyPublicOpinion,
		AdmissionStatus:                   request.AdmissionStatus,
		CalculatedAt:                      parseRFC3339(request.CalculatedAt),
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
		IssuerRating:                      request.IssuerRating,
		IssuerRatingAgency:                request.IssuerRatingAgency,
		UnifiedCreditCode:                 request.UnifiedCreditCode,
		LegalPersonIDCard:                 request.LegalPersonIDCard,
		Tags:                              request.Tags,
		PublicOpinions:                    request.PublicOpinions,
		BondTenders:                       request.BondTenders,
		BondDetails:                       request.BondDetails,
		BondRegistrations:                 request.BondRegistrations,
		FinanceSnapshot:                   request.FinanceSnapshot,
		FinanceSubjects:                   request.FinanceSubjects,
		Shareholders:                      request.Shareholders,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, updated, "更新企业成功")
}

func (handler *EnterpriseHandler) ValidateConflict(c *fiber.Ctx, request *enterpriseValidateConflictRequest) error {
	result, apiError := handler.service.ValidateConflict(c.UserContext(), model.CreateEnterpriseRequest{
		ShortName:                         request.ShortName,
		RegionID:                          request.RegionID,
		InHiddenDebtList:                  request.InHiddenDebtList,
		In3899List:                        request.In3899List,
		Meets335Indicator:                 request.Meets335Indicator,
		Meets224Indicator:                 request.Meets224Indicator,
		EnterpriseLevel:                   request.EnterpriseLevel,
		NetAssets:                         request.NetAssets,
		RealEstateRevenueRatio:            request.RealEstateRevenueRatio,
		MainBusinessType:                  request.MainBusinessType,
		EstablishedAt:                     parseRFC3339(request.EstablishedAt),
		LiabilityAssetRatio:               request.LiabilityAssetRatio,
		LiabilityAssetRatioIndustryMedian: request.LiabilityAssetRatioIndustryMedian,
		NonStandardFinancingRatio:         request.NonStandardFinancingRatio,
		MainBusiness:                      request.MainBusiness,
		RelatedPartyPublicOpinion:         request.RelatedPartyPublicOpinion,
		AdmissionStatus:                   request.AdmissionStatus,
		CalculatedAt:                      parseRFC3339(request.CalculatedAt),
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
		IssuerRating:                      request.IssuerRating,
		IssuerRatingAgency:                request.IssuerRatingAgency,
		UnifiedCreditCode:                 request.UnifiedCreditCode,
		LegalPersonIDCard:                 request.LegalPersonIDCard,
		Tags:                              request.Tags,
		PublicOpinions:                    request.PublicOpinions,
		BondTenders:                       request.BondTenders,
		BondDetails:                       request.BondDetails,
		BondRegistrations:                 request.BondRegistrations,
		FinanceSnapshot:                   request.FinanceSnapshot,
		FinanceSubjects:                   request.FinanceSubjects,
		Shareholders:                      request.Shareholders,
	}, request.ExcludeEnterpriseID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "企业冲突校验完成")
}

func enterpriseRequestToModel(request *createEnterpriseRequest) model.CreateEnterpriseRequest {
	return model.CreateEnterpriseRequest{
		ShortName:                         request.ShortName,
		RegionID:                          request.RegionID,
		InHiddenDebtList:                  request.InHiddenDebtList,
		In3899List:                        request.In3899List,
		Meets335Indicator:                 request.Meets335Indicator,
		Meets224Indicator:                 request.Meets224Indicator,
		EnterpriseLevel:                   request.EnterpriseLevel,
		NetAssets:                         request.NetAssets,
		RealEstateRevenueRatio:            request.RealEstateRevenueRatio,
		MainBusinessType:                  request.MainBusinessType,
		EstablishedAt:                     parseRFC3339(request.EstablishedAt),
		LiabilityAssetRatio:               request.LiabilityAssetRatio,
		LiabilityAssetRatioIndustryMedian: request.LiabilityAssetRatioIndustryMedian,
		NonStandardFinancingRatio:         request.NonStandardFinancingRatio,
		MainBusiness:                      request.MainBusiness,
		RelatedPartyPublicOpinion:         request.RelatedPartyPublicOpinion,
		AdmissionStatus:                   request.AdmissionStatus,
		CalculatedAt:                      parseRFC3339(request.CalculatedAt),
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
		IssuerRating:                      request.IssuerRating,
		IssuerRatingAgency:                request.IssuerRatingAgency,
		UnifiedCreditCode:                 request.UnifiedCreditCode,
		LegalPersonIDCard:                 request.LegalPersonIDCard,
		Tags:                              request.Tags,
		PublicOpinions:                    request.PublicOpinions,
		BondTenders:                       request.BondTenders,
		BondDetails:                       request.BondDetails,
		BondRegistrations:                 request.BondRegistrations,
		FinanceSnapshot:                   request.FinanceSnapshot,
		FinanceSubjects:                   request.FinanceSubjects,
		Shareholders:                      request.Shareholders,
	}
}

func (handler *EnterpriseHandler) Delete(c *fiber.Ctx, request *enterpriseIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	apiError := handler.service.Delete(c.UserContext(), request.EnterpriseID, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "删除企业成功")
}

func parseRFC3339(raw *string) *time.Time {
	if raw == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil
	}
	value, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return nil
	}
	return &value
}
