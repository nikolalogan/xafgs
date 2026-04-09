package repository

import (
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type EnterpriseRepository interface {
	FindByID(enterpriseID int64) (model.EnterpriseDetailDTO, bool)
	FindByShortName(shortName string) (model.EnterpriseDetailDTO, bool)
	FindByUnifiedCreditCode(unifiedCreditCode string) (model.Enterprise, bool)
	FindPage(query model.EnterpriseListQuery) model.EnterprisePageResult
	Create(aggregate model.EnterpriseAggregate) model.EnterpriseDetailDTO
	Update(enterpriseID int64, aggregate model.EnterpriseAggregate) (model.EnterpriseDetailDTO, bool)
	Delete(enterpriseID int64, operatorID int64) bool
}

type enterpriseRepository struct {
	items  map[int64]model.EnterpriseAggregate
	nextID int64
}

func NewEnterpriseRepository() EnterpriseRepository {
	now := time.Now().UTC()
	seed := model.EnterpriseAggregate{
		Enterprise: model.Enterprise{
			BaseEntity: model.BaseEntity{
				ID:        1,
				CreatedAt: now,
				UpdatedAt: now,
				CreatedBy: 1,
				UpdatedBy: 1,
			},
			ShortName:         "示例企业",
			RegionID:          1,
			AdmissionStatus:   model.EnterpriseAdmissionStatusAdmitted,
			UnifiedCreditCode: "91310000MA1EXAMPLE",
			Status:            model.EnterpriseStatusActive,
		},
	}
	return &enterpriseRepository{
		items: map[int64]model.EnterpriseAggregate{
			1: seed,
		},
		nextID: 2,
	}
}

func (repository *enterpriseRepository) FindByID(enterpriseID int64) (model.EnterpriseDetailDTO, bool) {
	aggregate, ok := repository.items[enterpriseID]
	if !ok {
		return model.EnterpriseDetailDTO{}, false
	}
	if aggregate.Enterprise.DeletedAt != nil {
		return model.EnterpriseDetailDTO{}, false
	}
	return aggregate.ToDetailDTO(), true
}

func (repository *enterpriseRepository) FindByShortName(shortName string) (model.EnterpriseDetailDTO, bool) {
	trimmed := strings.TrimSpace(shortName)
	if trimmed == "" {
		return model.EnterpriseDetailDTO{}, false
	}
	for _, aggregate := range repository.items {
		if aggregate.Enterprise.DeletedAt != nil {
			continue
		}
		if aggregate.Enterprise.ShortName == trimmed {
			return aggregate.ToDetailDTO(), true
		}
	}
	return model.EnterpriseDetailDTO{}, false
}

func (repository *enterpriseRepository) FindByUnifiedCreditCode(unifiedCreditCode string) (model.Enterprise, bool) {
	trimmed := strings.TrimSpace(unifiedCreditCode)
	if trimmed == "" {
		return model.Enterprise{}, false
	}
	for _, aggregate := range repository.items {
		if aggregate.Enterprise.DeletedAt != nil {
			continue
		}
		if aggregate.Enterprise.UnifiedCreditCode == trimmed {
			return aggregate.Enterprise, true
		}
	}
	return model.Enterprise{}, false
}

func (repository *enterpriseRepository) FindPage(query model.EnterpriseListQuery) model.EnterprisePageResult {
	filtered := make([]model.EnterpriseDTO, 0)
	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	regionID := query.RegionID
	for _, aggregate := range repository.items {
		enterprise := aggregate.Enterprise
		if enterprise.DeletedAt != nil {
			continue
		}
		if keyword != "" {
			shortName := strings.ToLower(strings.TrimSpace(enterprise.ShortName))
			creditCode := strings.ToLower(strings.TrimSpace(enterprise.UnifiedCreditCode))
			if !strings.Contains(shortName, keyword) && !strings.Contains(creditCode, keyword) {
				continue
			}
		}
		if regionID > 0 && enterprise.RegionID != regionID {
			continue
		}
		if query.AdmissionStatus != "" && enterprise.AdmissionStatus != query.AdmissionStatus {
			continue
		}
		filtered = append(filtered, enterprise.ToDTO())
	}

	sort.Slice(filtered, func(i, j int) bool { return filtered[i].ID > filtered[j].ID })

	total := int64(len(filtered))
	page := query.Page
	pageSize := query.PageSize
	start := (page - 1) * pageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	items := make([]model.EnterpriseDTO, 0)
	if start < end {
		items = filtered[start:end]
	}

	return model.EnterprisePageResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}
}

func (repository *enterpriseRepository) Create(aggregate model.EnterpriseAggregate) model.EnterpriseDetailDTO {
	now := time.Now().UTC()
	aggregate.Enterprise.ID = repository.nextID
	aggregate.Enterprise.CreatedAt = now
	aggregate.Enterprise.UpdatedAt = now
	if aggregate.Enterprise.Status == "" {
		aggregate.Enterprise.Status = model.EnterpriseStatusActive
	}
	repository.items[aggregate.Enterprise.ID] = normalizeAggregate(aggregate)
	repository.nextID++
	stored := repository.items[aggregate.Enterprise.ID]
	return stored.ToDetailDTO()
}

func (repository *enterpriseRepository) Update(enterpriseID int64, aggregate model.EnterpriseAggregate) (model.EnterpriseDetailDTO, bool) {
	existing, ok := repository.items[enterpriseID]
	if !ok || existing.Enterprise.DeletedAt != nil {
		return model.EnterpriseDetailDTO{}, false
	}
	now := time.Now().UTC()
	aggregate.Enterprise.ID = enterpriseID
	aggregate.Enterprise.CreatedAt = existing.Enterprise.CreatedAt
	aggregate.Enterprise.CreatedBy = existing.Enterprise.CreatedBy
	aggregate.Enterprise.UpdatedAt = now
	if aggregate.Enterprise.Status == "" {
		aggregate.Enterprise.Status = model.EnterpriseStatusActive
	}
	repository.items[enterpriseID] = normalizeAggregate(aggregate)
	stored := repository.items[enterpriseID]
	return stored.ToDetailDTO(), true
}

func (repository *enterpriseRepository) Delete(enterpriseID int64, operatorID int64) bool {
	existing, ok := repository.items[enterpriseID]
	if !ok || existing.Enterprise.DeletedAt != nil {
		return false
	}
	now := time.Now().UTC()
	existing.Enterprise.DeletedAt = &now
	existing.Enterprise.DeletedBy = &operatorID
	existing.Enterprise.UpdatedAt = now
	existing.Enterprise.UpdatedBy = operatorID
	existing.Enterprise.Status = model.EnterpriseStatusDeleted
	repository.items[enterpriseID] = existing
	return true
}

func normalizeAggregate(aggregate model.EnterpriseAggregate) model.EnterpriseAggregate {
	copyTags := make([]model.EnterpriseTag, 0, len(aggregate.Tags))
	for i, item := range aggregate.Tags {
		item.ID = int64(i + 1)
		copyTags = append(copyTags, item)
	}

	copyOpinions := make([]model.EnterprisePublicOpinion, 0, len(aggregate.PublicOpinions))
	for i, item := range aggregate.PublicOpinions {
		item.ID = int64(i + 1)
		item.OrderNo = i + 1
		copyOpinions = append(copyOpinions, item)
	}

	copyTenders := make([]model.EnterpriseBondTender, 0, len(aggregate.BondTenders))
	for i, item := range aggregate.BondTenders {
		item.ID = int64(i + 1)
		item.OrderNo = i + 1
		copyTenders = append(copyTenders, item)
	}

	copyDetails := make([]model.EnterpriseBondDetail, 0, len(aggregate.BondDetails))
	for i, item := range aggregate.BondDetails {
		item.ID = int64(i + 1)
		item.OrderNo = i + 1
		copyDetails = append(copyDetails, item)
	}

	copyRegistrations := make([]model.EnterpriseBondRegistration, 0, len(aggregate.BondRegistrations))
	for i, item := range aggregate.BondRegistrations {
		item.ID = int64(i + 1)
		item.OrderNo = i + 1
		copyRegistrations = append(copyRegistrations, item)
	}

	copySubjects := make([]model.EnterpriseFinanceSubject, 0, len(aggregate.FinanceSubjects))
	for i, item := range aggregate.FinanceSubjects {
		item.ID = int64(i + 1)
		item.OrderNo = i + 1
		copySubjects = append(copySubjects, item)
	}

	copyShareholders := make([]model.EnterpriseShareholder, 0, len(aggregate.Shareholders))
	for i, item := range aggregate.Shareholders {
		item.ID = int64(i + 1)
		item.OrderNo = i + 1
		copyShareholders = append(copyShareholders, item)
	}

	var finance *model.EnterpriseFinanceSnapshot
	if aggregate.FinanceSnapshot != nil {
		snapshot := *aggregate.FinanceSnapshot
		snapshot.ID = 1
		finance = &snapshot
	}

	aggregate.Tags = copyTags
	aggregate.PublicOpinions = copyOpinions
	aggregate.BondTenders = copyTenders
	aggregate.BondDetails = copyDetails
	aggregate.BondRegistrations = copyRegistrations
	aggregate.FinanceSubjects = copySubjects
	aggregate.Shareholders = copyShareholders
	aggregate.FinanceSnapshot = finance
	return aggregate
}
