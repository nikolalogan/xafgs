package model

type EnterpriseFinancialReport struct {
	BaseEntity
	EnterpriseID    int64  `json:"enterpriseId"`
	Year            int    `json:"year"`
	Month           int    `json:"month"`
	Level           int    `json:"level"`
	AccountingFirm  string `json:"accountingFirm"`
}

type EnterpriseFinancialReportItem struct {
	BaseEntity
	FinancialReportID int64    `json:"financialReportId"`
	SubjectID         int64    `json:"subjectId"`
	Value             *float64 `json:"value,omitempty"`
}
