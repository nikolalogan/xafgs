package model

type AdminDivision struct {
	BaseEntity
	Code       string `json:"code"`
	Name       string `json:"name"`
	Level      int    `json:"level"`
	Indent     int    `json:"indent"`
	ParentCode string `json:"parentCode"`
}

type AdminDivisionDTO struct {
	ID         int64  `json:"id"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Level      int    `json:"level"`
	Indent     int    `json:"indent"`
	ParentCode string `json:"parentCode"`
	ParentName string `json:"parentName"`
}

type AdminDivisionChainNode struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Level int    `json:"level"`
}

type AdminDivisionAncestorNode struct {
	Code  string `json:"code"`
	Area  string `json:"area"`
	Level string `json:"level"`
}

type AdminDivisionByCodeResult struct {
	Current     AdminDivisionDTO       `json:"current"`
	ParentChain []AdminDivisionChainNode `json:"parentChain"`
}

type AdminDivisionListQuery struct {
	Page       int    `json:"page"`
	PageSize   int    `json:"pageSize"`
	Keyword    string `json:"keyword"`
	Level      *int   `json:"level,omitempty"`
	ParentCode string `json:"parentCode"`
}

type AdminDivisionPageResult struct {
	Items    []AdminDivisionDTO `json:"items"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
	Total    int64              `json:"total"`
}
