package model

import "time"

type CreateEnterpriseRequest struct {
	ShortName                         string                         `json:"shortName"`
	RegionID                          int64                          `json:"regionId"`
	InHiddenDebtList                  bool                           `json:"inHiddenDebtList"`
	In3899List                        bool                           `json:"in3899List"`
	Meets335Indicator                 bool                           `json:"meets335Indicator"`
	Meets224Indicator                 bool                           `json:"meets224Indicator"`
	EnterpriseLevel                   string                         `json:"enterpriseLevel"`
	NetAssets                         *float64                       `json:"netAssets"`
	RealEstateRevenueRatio            *float64                       `json:"realEstateRevenueRatio"`
	MainBusinessType                  string                         `json:"mainBusinessType"`
	EstablishedAt                     *time.Time                     `json:"establishedAt"`
	LiabilityAssetRatio               *float64                       `json:"liabilityAssetRatio"`
	LiabilityAssetRatioIndustryMedian *float64                       `json:"liabilityAssetRatioIndustryMedian"`
	NonStandardFinancingRatio         *float64                       `json:"nonStandardFinancingRatio"`
	MainBusiness                      string                         `json:"mainBusiness"`
	RelatedPartyPublicOpinion         string                         `json:"relatedPartyPublicOpinion"`
	AdmissionStatus                   bool                           `json:"admissionStatus"`
	CalculatedAt                      *time.Time                     `json:"calculatedAt"`
	RegisteredCapital                 *float64                       `json:"registeredCapital"`
	PaidInCapital                     *float64                       `json:"paidInCapital"`
	Industry                          string                         `json:"industry"`
	Address                           string                         `json:"address"`
	BusinessScope                     string                         `json:"businessScope"`
	LegalPerson                       string                         `json:"legalPerson"`
	CompanyType                       string                         `json:"companyType"`
	EnterpriseNature                  string                         `json:"enterpriseNature"`
	ActualController                  string                         `json:"actualController"`
	ActualControllerControlPath       string                         `json:"actualControllerControlPath"`
	IssuerRating                      string                         `json:"issuerRating"`
	IssuerRatingAgency                string                         `json:"issuerRatingAgency"`
	UnifiedCreditCode                 string                         `json:"unifiedCreditCode"`
	LegalPersonIDCard                 string                         `json:"legalPersonIdCard"`
	Tags                              []EnterpriseTag                `json:"tags"`
	PublicOpinions                    []EnterprisePublicOpinion      `json:"publicOpinions"`
	BondTenders                       []EnterpriseBondTender         `json:"bondTenders"`
	BondDetails                       []EnterpriseBondDetail         `json:"bondDetails"`
	BondRegistrations                 []EnterpriseBondRegistration   `json:"bondRegistrations"`
	FinanceSnapshot                   *EnterpriseFinanceSnapshot     `json:"financeSnapshot"`
	FinanceSubjects                   []EnterpriseFinanceSubject     `json:"financeSubjects"`
	Shareholders                      []EnterpriseShareholder        `json:"shareholders"`
}

type UpdateEnterpriseRequest = CreateEnterpriseRequest
