package model

type Region struct {
	BaseEntity
	AdminCode string `json:"adminCode"`
	Overview  string `json:"overview"`
}

type RegionEconomy struct {
	BaseEntity
	RegionID                            int64    `json:"regionId"`
	Year                                int      `json:"year"`
	GDPRankProvince                     *int     `json:"gdpRankProvince,omitempty"`
	GDPRankProvinceTotal                *int     `json:"gdpRankProvinceTotal,omitempty"`
	IsTop100County                      bool     `json:"isTop100County"`
	IsTop100City                        bool     `json:"isTop100City"`
	GDP                                 *float64 `json:"gdp,omitempty"`
	GDPGrowth                           *float64 `json:"gdpGrowth,omitempty"`
	Population                          *float64 `json:"population,omitempty"`
	FiscalSelfSufficiencyRatio          *float64 `json:"fiscalSelfSufficiencyRatio,omitempty"`
	GeneralBudgetRevenue                *float64 `json:"generalBudgetRevenue,omitempty"`
	GeneralBudgetRevenueGrowth          *float64 `json:"generalBudgetRevenueGrowth,omitempty"`
	GeneralBudgetRevenueTotal           *float64 `json:"generalBudgetRevenueTotal,omitempty"`
	GeneralBudgetRevenueTax             *float64 `json:"generalBudgetRevenueTax,omitempty"`
	GeneralBudgetRevenueNonTax          *float64 `json:"generalBudgetRevenueNonTax,omitempty"`
	GeneralBudgetRevenueSuperiorSubsidy *float64 `json:"generalBudgetRevenueSuperiorSubsidy,omitempty"`
	LiabilityRatio                      *float64 `json:"liabilityRatio,omitempty"`
	LiabilityRatioBroad                 *float64 `json:"liabilityRatioBroad,omitempty"`
	DebtRatio                           *float64 `json:"debtRatio,omitempty"`
	DebtRatioBroad                      *float64 `json:"debtRatioBroad,omitempty"`
}

type RegionDTO struct {
	ID        int64  `json:"id"`
	AdminCode string `json:"adminCode"`
	Overview  string `json:"overview"`
}

type RegionDetailDTO struct {
	RegionDTO
	Economies []RegionEconomy `json:"economies"`
}

type RegionListQuery struct {
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
	Keyword  string `json:"keyword"`
}

type RegionPageResult struct {
	Items    []RegionDTO `json:"items"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
	Total    int64       `json:"total"`
}

type CreateRegionRequest struct {
	AdminCode string          `json:"adminCode"`
	Overview  string          `json:"overview"`
	Economies []RegionEconomy `json:"economies"`
}

type UpdateRegionRequest = CreateRegionRequest

func (region Region) ToDTO() RegionDTO {
	return RegionDTO{
		ID:        region.ID,
		AdminCode: region.AdminCode,
		Overview:  region.Overview,
	}
}
