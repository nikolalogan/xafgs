package model

import (
	"strings"
	"time"
)

const (
	EnterpriseStatusActive  = "active"
	EnterpriseStatusDeleted = "deleted"
)

const (
	EnterpriseAdmissionStatusAdmitted = "admitted"
	EnterpriseAdmissionStatusRejected = "rejected"
	EnterpriseAdmissionStatusPending  = "pending"
)

func NormalizeEnterpriseAdmissionStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case EnterpriseAdmissionStatusAdmitted, EnterpriseAdmissionStatusRejected, EnterpriseAdmissionStatusPending:
		return strings.ToLower(strings.TrimSpace(status))
	case "true", "1", "yes", "y":
		return EnterpriseAdmissionStatusAdmitted
	case "false", "0", "no", "n":
		return EnterpriseAdmissionStatusRejected
	default:
		return EnterpriseAdmissionStatusPending
	}
}

type Enterprise struct {
	BaseEntity
	ShortName                         string     `json:"shortName"`
	RegionID                          int64      `json:"regionId"`
	InHiddenDebtList                  bool       `json:"inHiddenDebtList"`
	In3899List                        bool       `json:"in3899List"`
	Meets335Indicator                 bool       `json:"meets335Indicator"`
	Meets224Indicator                 bool       `json:"meets224Indicator"`
	EnterpriseLevel                   string     `json:"enterpriseLevel"`
	NetAssets                         *float64   `json:"netAssets,omitempty"`
	RealEstateRevenueRatio            *float64   `json:"realEstateRevenueRatio,omitempty"`
	MainBusinessType                  string     `json:"mainBusinessType"`
	EstablishedAt                     *time.Time `json:"establishedAt,omitempty"`
	NonStandardFinancingRatio         *float64   `json:"nonStandardFinancingRatio,omitempty"`
	MainBusiness                      string     `json:"mainBusiness"`
	RelatedPartyPublicOpinion         string     `json:"relatedPartyPublicOpinion"`
	AdmissionStatus                   string     `json:"admissionStatus"`
	CalculatedAt                      *time.Time `json:"calculatedAt,omitempty"`
	RegisteredCapital                 *float64   `json:"registeredCapital,omitempty"`
	PaidInCapital                     *float64   `json:"paidInCapital,omitempty"`
	Industry                          string     `json:"industry"`
	Address                           string     `json:"address"`
	BusinessScope                     string     `json:"businessScope"`
	LegalPerson                       string     `json:"legalPerson"`
	CompanyType                       string     `json:"companyType"`
	EnterpriseNature                  string     `json:"enterpriseNature"`
	ActualController                  string     `json:"actualController"`
	ActualControllerControlPath       string     `json:"actualControllerControlPath"`
	IssuerRating                      string     `json:"issuerRating"`
	IssuerRatingAgency                string     `json:"issuerRatingAgency"`
	UnifiedCreditCode                 string     `json:"unifiedCreditCode"`
	LegalPersonIDCard                 string     `json:"legalPersonIdCard"`
	Status                            string     `json:"status"`
	DeletedAt                         *time.Time `json:"deletedAt,omitempty"`
	DeletedBy                         *int64     `json:"deletedBy,omitempty"`
}

type EnterpriseTag struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

type EnterprisePublicOpinion struct {
	ID      int64      `json:"id"`
	Source  string     `json:"source"`
	Issue   string     `json:"issue"`
	Time    *time.Time `json:"time,omitempty"`
	Title   string     `json:"title"`
	OrderNo int        `json:"orderNo"`
}

type EnterpriseBondTender struct {
	ID          int64      `json:"id"`
	Time        *time.Time `json:"time,omitempty"`
	Type        string     `json:"type"`
	ProjectType string     `json:"projectType"`
	Winner      string     `json:"winner"`
	TenderTitle string     `json:"tenderTitle"`
	OrderNo     int        `json:"orderNo"`
}

type EnterpriseBondDetail struct {
	ID            int64      `json:"id"`
	ShortName     string     `json:"shortName"`
	Code          string     `json:"code"`
	Type          string     `json:"type"`
	Balance       *float64   `json:"balance,omitempty"`
	Term          string     `json:"term"`
	Rating        string     `json:"rating"`
	Guarantor     string     `json:"guarantor"`
	GuarantorType string     `json:"guarantorType"`
	Time          *time.Time `json:"time,omitempty"`
	Rate          *float64   `json:"rate,omitempty"`
	MaturityDate  *time.Time `json:"maturityDate,omitempty"`
	Usefor        string     `json:"usefor"`
	OrderNo       int        `json:"orderNo"`
}

type EnterpriseBondRegistration struct {
	ID          int64      `json:"id"`
	ProjectName string     `json:"projectName"`
	Status      string     `json:"status"`
	UpdatedAt   *time.Time `json:"updatedAt,omitempty"`
	Amount      *float64   `json:"amount,omitempty"`
	Process     string     `json:"process"`
	OrderNo     int        `json:"orderNo"`
}

type EnterpriseFinanceSnapshot struct {
	ID                 int64    `json:"id"`
	LiabilityAssetRatio *float64 `json:"liabilityAssetRatio,omitempty"`
	ROA                *float64 `json:"roa,omitempty"`
	ROAIndustryMedian  *float64 `json:"roaIndustryMedian,omitempty"`
	ROE                *float64 `json:"roe,omitempty"`
	InterestCoverage   *float64 `json:"interestCoverage,omitempty"`
	EBITCoverage       *float64 `json:"ebitCoverage,omitempty"`
	EBITCoverageIndustryMedian *float64 `json:"ebitCoverageIndustryMedian,omitempty"`
	EBITCoverageIndustry1_4    *float64 `json:"ebitCoverageIndustry1_4,omitempty"`
	EBITCoverageIndustry3_4    *float64 `json:"ebitCoverageIndustry3_4,omitempty"`
	EBITDACoverage             *float64 `json:"ebitdaCoverage,omitempty"`
	EBITDACoverageIndustryMedian *float64 `json:"ebitdaCoverageIndustryMedian,omitempty"`
	EBITDACoverageIndustry1_4    *float64 `json:"ebitdaCoverageIndustry1_4,omitempty"`
	EBITDACoverageIndustry3_4    *float64 `json:"ebitdaCoverageIndustry3_4,omitempty"`
	LiabilityAssetRatioIndustryMedian *float64 `json:"liabilityAssetRatioIndustryMedian,omitempty"`
	LiabilityAssetRatioIndustry1_4    *float64 `json:"liabilityAssetRatioIndustry1_4,omitempty"`
	LiabilityAssetRatioIndustry3_4    *float64 `json:"liabilityAssetRatioIndustry3_4,omitempty"`
	ROEIndustryMedian                 *float64 `json:"roeIndustryMedian,omitempty"`
	ROEIndustry1_4                    *float64 `json:"roeIndustry1_4,omitempty"`
	ROEIndustry3_4                    *float64 `json:"roeIndustry3_4,omitempty"`
	ROAIndustry1_4                    *float64 `json:"roaIndustry1_4,omitempty"`
	ROAIndustry3_4                    *float64 `json:"roaIndustry3_4,omitempty"`
	NonStandardFinancingRatioIndustryMedian *float64 `json:"nonStandardFinancingRatioIndustryMedian,omitempty"`
	MainBusiness1      string   `json:"mainBusiness1"`
	MainBusiness2      string   `json:"mainBusiness2"`
	MainBusiness3      string   `json:"mainBusiness3"`
	MainBusiness4      string   `json:"mainBusiness4"`
	MainBusiness5      string   `json:"mainBusiness5"`
	MainBusinessRatio1 *float64 `json:"mainBusinessRatio1,omitempty"`
	MainBusinessRatio2 *float64 `json:"mainBusinessRatio2,omitempty"`
	MainBusinessRatio3 *float64 `json:"mainBusinessRatio3,omitempty"`
	MainBusinessRatio4 *float64 `json:"mainBusinessRatio4,omitempty"`
	MainBusinessRatio5 *float64 `json:"mainBusinessRatio5,omitempty"`
}

type EnterpriseFinanceSubject struct {
	ID          int64  `json:"id"`
	SubjectName string `json:"subjectName"`
	SubjectType string `json:"subjectType"`
	OrderNo     int    `json:"orderNo"`
}

type EnterpriseShareholder struct {
	ID            int64  `json:"id"`
	ShareholderID string `json:"shareholderId"`
	OrderNo       int    `json:"orderNo"`
}

type EnterpriseAggregate struct {
	Enterprise        Enterprise                   `json:"enterprise"`
	Tags              []EnterpriseTag              `json:"tags"`
	PublicOpinions    []EnterprisePublicOpinion    `json:"publicOpinions"`
	BondTenders       []EnterpriseBondTender       `json:"bondTenders"`
	BondDetails       []EnterpriseBondDetail       `json:"bondDetails"`
	BondRegistrations []EnterpriseBondRegistration `json:"bondRegistrations"`
	FinanceSnapshot   *EnterpriseFinanceSnapshot   `json:"financeSnapshot,omitempty"`
	FinanceSubjects   []EnterpriseFinanceSubject   `json:"financeSubjects"`
	Shareholders      []EnterpriseShareholder      `json:"shareholders"`
}

type EnterpriseDTO struct {
	ID                int64     `json:"id"`
	ShortName         string    `json:"shortName"`
	UnifiedCreditCode string    `json:"unifiedCreditCode"`
	RegionID          int64     `json:"regionId"`
	RegionAdminCode   string    `json:"regionAdminCode"`
	RegionCode        string    `json:"regionCode"`
	RegionName        string    `json:"regionName"`
	AdmissionStatus   string    `json:"admissionStatus"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type EnterpriseDetailDTO struct {
	EnterpriseDTO
	InHiddenDebtList                  bool                         `json:"inHiddenDebtList"`
	In3899List                        bool                         `json:"in3899List"`
	Meets335Indicator                 bool                         `json:"meets335Indicator"`
	Meets224Indicator                 bool                         `json:"meets224Indicator"`
	EnterpriseLevel                   string                       `json:"enterpriseLevel"`
	NetAssets                         *float64                     `json:"netAssets,omitempty"`
	RealEstateRevenueRatio            *float64                     `json:"realEstateRevenueRatio,omitempty"`
	MainBusinessType                  string                       `json:"mainBusinessType"`
	EstablishedAt                     *time.Time                   `json:"establishedAt,omitempty"`
	NonStandardFinancingRatio         *float64                     `json:"nonStandardFinancingRatio,omitempty"`
	MainBusiness                      string                       `json:"mainBusiness"`
	RelatedPartyPublicOpinion         string                       `json:"relatedPartyPublicOpinion"`
	CalculatedAt                      *time.Time                   `json:"calculatedAt,omitempty"`
	RegisteredCapital                 *float64                     `json:"registeredCapital,omitempty"`
	PaidInCapital                     *float64                     `json:"paidInCapital,omitempty"`
	Industry                          string                       `json:"industry"`
	Address                           string                       `json:"address"`
	BusinessScope                     string                       `json:"businessScope"`
	LegalPerson                       string                       `json:"legalPerson"`
	CompanyType                       string                       `json:"companyType"`
	EnterpriseNature                  string                       `json:"enterpriseNature"`
	ActualController                  string                       `json:"actualController"`
	ActualControllerControlPath       string                       `json:"actualControllerControlPath"`
	IssuerRating                      string                       `json:"issuerRating"`
	IssuerRatingAgency                string                       `json:"issuerRatingAgency"`
	LegalPersonIDCard                 string                       `json:"legalPersonIdCard"`
	Tags                              []EnterpriseTag              `json:"tags"`
	PublicOpinions                    []EnterprisePublicOpinion    `json:"publicOpinions"`
	BondTenders                       []EnterpriseBondTender       `json:"bondTenders"`
	BondDetails                       []EnterpriseBondDetail       `json:"bondDetails"`
	BondRegistrations                 []EnterpriseBondRegistration `json:"bondRegistrations"`
	FinanceSnapshot                   *EnterpriseFinanceSnapshot   `json:"financeSnapshot,omitempty"`
	FinanceSubjects                   []EnterpriseFinanceSubject   `json:"financeSubjects"`
	Shareholders                      []EnterpriseShareholder      `json:"shareholders"`
}

type EnterpriseListQuery struct {
	Page            int    `json:"page"`
	PageSize        int    `json:"pageSize"`
	Keyword         string `json:"keyword"`
	RegionID        int64  `json:"regionId"`
	AdmissionStatus string `json:"admissionStatus,omitempty"`
}

type EnterprisePageResult struct {
	Items    []EnterpriseDTO `json:"items"`
	Page     int             `json:"page"`
	PageSize int             `json:"pageSize"`
	Total    int64           `json:"total"`
}

func (enterprise Enterprise) ToDTO() EnterpriseDTO {
	return EnterpriseDTO{
		ID:                enterprise.ID,
		ShortName:         enterprise.ShortName,
		UnifiedCreditCode: enterprise.UnifiedCreditCode,
		RegionID:          enterprise.RegionID,
		AdmissionStatus:   NormalizeEnterpriseAdmissionStatus(enterprise.AdmissionStatus),
		CreatedAt:         enterprise.CreatedAt,
		UpdatedAt:         enterprise.UpdatedAt,
	}
}

func (aggregate EnterpriseAggregate) ToDetailDTO() EnterpriseDetailDTO {
	enterprise := aggregate.Enterprise
	return EnterpriseDetailDTO{
		EnterpriseDTO:                     enterprise.ToDTO(),
		InHiddenDebtList:                  enterprise.InHiddenDebtList,
		In3899List:                        enterprise.In3899List,
		Meets335Indicator:                 enterprise.Meets335Indicator,
		Meets224Indicator:                 enterprise.Meets224Indicator,
		EnterpriseLevel:                   enterprise.EnterpriseLevel,
		NetAssets:                         enterprise.NetAssets,
		RealEstateRevenueRatio:            enterprise.RealEstateRevenueRatio,
		MainBusinessType:                  enterprise.MainBusinessType,
		EstablishedAt:                     enterprise.EstablishedAt,
		NonStandardFinancingRatio:         enterprise.NonStandardFinancingRatio,
		MainBusiness:                      enterprise.MainBusiness,
		RelatedPartyPublicOpinion:         enterprise.RelatedPartyPublicOpinion,
		CalculatedAt:                      enterprise.CalculatedAt,
		RegisteredCapital:                 enterprise.RegisteredCapital,
		PaidInCapital:                     enterprise.PaidInCapital,
		Industry:                          enterprise.Industry,
		Address:                           enterprise.Address,
		BusinessScope:                     enterprise.BusinessScope,
		LegalPerson:                       enterprise.LegalPerson,
		CompanyType:                       enterprise.CompanyType,
		EnterpriseNature:                  enterprise.EnterpriseNature,
		ActualController:                  enterprise.ActualController,
		ActualControllerControlPath:       enterprise.ActualControllerControlPath,
		IssuerRating:                      enterprise.IssuerRating,
		IssuerRatingAgency:                enterprise.IssuerRatingAgency,
		LegalPersonIDCard:                 enterprise.LegalPersonIDCard,
		Tags:                              aggregate.Tags,
		PublicOpinions:                    aggregate.PublicOpinions,
		BondTenders:                       aggregate.BondTenders,
		BondDetails:                       aggregate.BondDetails,
		BondRegistrations:                 aggregate.BondRegistrations,
		FinanceSnapshot:                   aggregate.FinanceSnapshot,
		FinanceSubjects:                   aggregate.FinanceSubjects,
		Shareholders:                      aggregate.Shareholders,
	}
}
