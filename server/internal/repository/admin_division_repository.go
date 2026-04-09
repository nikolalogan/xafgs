package repository

import (
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/admindivisiondata"
	"sxfgssever/server/internal/model"
)

type AdminDivisionRepository interface {
	FindPage(query model.AdminDivisionListQuery) model.AdminDivisionPageResult
	FindByCode(code string) (model.AdminDivisionDTO, bool)
	FindParentChainByCode(code string) ([]model.AdminDivisionChainNode, bool)
}

type adminDivisionRepository struct {
	itemsByCode map[string]model.AdminDivision
	sortedCodes []string
}

func NewAdminDivisionRepository() AdminDivisionRepository {
	now := time.Now().UTC()
	itemsByCode := make(map[string]model.AdminDivision, len(admindivisiondata.Rows))
	sortedCodes := make([]string, 0, len(admindivisiondata.Rows))
	var id int64 = 1
	for _, row := range admindivisiondata.Rows {
		code := strings.TrimSpace(row.Code)
		if code == "" {
			continue
		}
		if _, exists := itemsByCode[code]; exists {
			continue
		}
		itemsByCode[code] = model.AdminDivision{
			BaseEntity: model.BaseEntity{
				ID:        id,
				CreatedAt: now,
				UpdatedAt: now,
				CreatedBy: 1,
				UpdatedBy: 1,
			},
			Code:       code,
			Name:       strings.TrimSpace(row.Name),
			Level:      row.Level,
			Indent:     row.Indent,
			ParentCode: strings.TrimSpace(row.ParentCode),
		}
		sortedCodes = append(sortedCodes, code)
		id++
	}
	sort.Strings(sortedCodes)
	return &adminDivisionRepository{
		itemsByCode: itemsByCode,
		sortedCodes: sortedCodes,
	}
}

func (repository *adminDivisionRepository) FindPage(query model.AdminDivisionListQuery) model.AdminDivisionPageResult {
	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	parentCode := strings.TrimSpace(query.ParentCode)
	filtered := make([]model.AdminDivisionDTO, 0)

	for _, code := range repository.sortedCodes {
		item, ok := repository.itemsByCode[code]
		if !ok {
			continue
		}
		if keyword != "" {
			if !strings.Contains(strings.ToLower(item.Code), keyword) &&
				!strings.Contains(strings.ToLower(item.Name), keyword) {
				continue
			}
		}
		if query.Level != nil && item.Level != *query.Level {
			continue
		}
		if parentCode != "" && item.ParentCode != parentCode {
			continue
		}
		parentName := ""
		if parent, ok := repository.itemsByCode[item.ParentCode]; ok {
			parentName = parent.Name
		}
		filtered = append(filtered, model.AdminDivisionDTO{
			ID:         item.ID,
			Code:       item.Code,
			Name:       item.Name,
			Level:      item.Level,
			Indent:     item.Indent,
			ParentCode: item.ParentCode,
			ParentName: parentName,
		})
	}

	total := int64(len(filtered))
	start := (query.Page - 1) * query.PageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + query.PageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	items := []model.AdminDivisionDTO{}
	if start < end {
		items = filtered[start:end]
	}

	return model.AdminDivisionPageResult{
		Items:    items,
		Page:     query.Page,
		PageSize: query.PageSize,
		Total:    total,
	}
}

func (repository *adminDivisionRepository) FindByCode(code string) (model.AdminDivisionDTO, bool) {
	trimmed := strings.TrimSpace(code)
	if trimmed == "" {
		return model.AdminDivisionDTO{}, false
	}
	item, ok := repository.itemsByCode[trimmed]
	if !ok {
		return model.AdminDivisionDTO{}, false
	}
	parentName := ""
	if parent, exists := repository.itemsByCode[item.ParentCode]; exists {
		parentName = parent.Name
	}
	return model.AdminDivisionDTO{
		ID:         item.ID,
		Code:       item.Code,
		Name:       item.Name,
		Level:      item.Level,
		Indent:     item.Indent,
		ParentCode: item.ParentCode,
		ParentName: parentName,
	}, true
}

func (repository *adminDivisionRepository) FindParentChainByCode(code string) ([]model.AdminDivisionChainNode, bool) {
	current, ok := repository.itemsByCode[strings.TrimSpace(code)]
	if !ok {
		return nil, false
	}
	chain := make([]model.AdminDivisionChainNode, 0, 4)
	parentCode := strings.TrimSpace(current.ParentCode)
	for parentCode != "" {
		parent, exists := repository.itemsByCode[parentCode]
		if !exists {
			break
		}
		chain = append(chain, model.AdminDivisionChainNode{
			Code:  parent.Code,
			Name:  parent.Name,
			Level: parent.Level,
		})
		parentCode = strings.TrimSpace(parent.ParentCode)
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain, true
}

