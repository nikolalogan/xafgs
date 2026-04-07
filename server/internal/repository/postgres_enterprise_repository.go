package repository

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresEnterpriseRepository struct {
	db *sql.DB
}

func NewPostgresEnterpriseRepository(db *sql.DB) EnterpriseRepository {
	return &PostgresEnterpriseRepository{db: db}
}

func (repository *PostgresEnterpriseRepository) FindByID(enterpriseID int64) (model.EnterpriseDetailDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	aggregate, ok := repository.findAggregateByID(ctx, nil, enterpriseID)
	if !ok {
		return model.EnterpriseDetailDTO{}, false
	}
	return aggregate.ToDetailDTO(), true
}

func (repository *PostgresEnterpriseRepository) FindByShortName(shortName string) (model.EnterpriseDetailDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(shortName)
	if trimmed == "" {
		return model.EnterpriseDetailDTO{}, false
	}

	var enterpriseID int64
	if err := repository.db.QueryRowContext(ctx, `
SELECT id
FROM enterprise
WHERE short_name = $1 AND deleted_at IS NULL
ORDER BY id ASC
LIMIT 1
`, trimmed).Scan(&enterpriseID); err != nil {
		return model.EnterpriseDetailDTO{}, false
	}
	return repository.FindByID(enterpriseID)
}

func (repository *PostgresEnterpriseRepository) FindByUnifiedCreditCode(unifiedCreditCode string) (model.Enterprise, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(unifiedCreditCode)
	if trimmed == "" {
		return model.Enterprise{}, false
	}

	var enterprise model.Enterprise
	err := repository.db.QueryRowContext(ctx, `
SELECT
  id, short_name, region_id,
  in_hidden_debt_list, in_3899_list, meets_335_indicator, meets_224_indicator,
  enterprise_level, net_assets, real_estate_revenue_ratio, main_business_type,
  established_at, liability_asset_ratio, liability_asset_ratio_industry_median,
  non_standard_financing_ratio, main_business, related_party_public_opinion,
  admission_status, calculated_at, registered_capital, paid_in_capital,
  industry, address, business_scope, legal_person, company_type, enterprise_nature,
  actual_controller, actual_controller_control_path,
  issuer_rating, issuer_rating_agency,
  unified_credit_code, legal_person_id_card,
  status, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by
FROM enterprise
WHERE unified_credit_code = $1 AND deleted_at IS NULL
`, trimmed).Scan(
		&enterprise.ID,
		&enterprise.ShortName,
		&enterprise.RegionID,
		&enterprise.InHiddenDebtList,
		&enterprise.In3899List,
		&enterprise.Meets335Indicator,
		&enterprise.Meets224Indicator,
		&enterprise.EnterpriseLevel,
		floatPtrScanner{dst: &enterprise.NetAssets},
		floatPtrScanner{dst: &enterprise.RealEstateRevenueRatio},
		&enterprise.MainBusinessType,
		timePtrScanner{dst: &enterprise.EstablishedAt},
		floatPtrScanner{dst: &enterprise.LiabilityAssetRatio},
		floatPtrScanner{dst: &enterprise.LiabilityAssetRatioIndustryMedian},
		floatPtrScanner{dst: &enterprise.NonStandardFinancingRatio},
		&enterprise.MainBusiness,
		&enterprise.RelatedPartyPublicOpinion,
		&enterprise.AdmissionStatus,
		timePtrScanner{dst: &enterprise.CalculatedAt},
		floatPtrScanner{dst: &enterprise.RegisteredCapital},
		floatPtrScanner{dst: &enterprise.PaidInCapital},
		&enterprise.Industry,
		&enterprise.Address,
		&enterprise.BusinessScope,
		&enterprise.LegalPerson,
		&enterprise.CompanyType,
		&enterprise.EnterpriseNature,
		&enterprise.ActualController,
		&enterprise.ActualControllerControlPath,
		&enterprise.IssuerRating,
		&enterprise.IssuerRatingAgency,
		&enterprise.UnifiedCreditCode,
		&enterprise.LegalPersonIDCard,
		&enterprise.Status,
		&enterprise.CreatedAt,
		&enterprise.UpdatedAt,
		&enterprise.CreatedBy,
		&enterprise.UpdatedBy,
		timePtrScanner{dst: &enterprise.DeletedAt},
		int64PtrScanner{dst: &enterprise.DeletedBy},
	)
	if err != nil {
		return model.Enterprise{}, false
	}
	return enterprise, true
}

func (repository *PostgresEnterpriseRepository) FindPage(query model.EnterpriseListQuery) model.EnterprisePageResult {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conditions := []string{"deleted_at IS NULL"}
	args := make([]any, 0)
	argIndex := 1

	if strings.TrimSpace(query.Keyword) != "" {
		conditions = append(conditions, "(short_name ILIKE $"+strconv.Itoa(argIndex)+" OR unified_credit_code ILIKE $"+strconv.Itoa(argIndex)+")")
		args = append(args, "%"+strings.TrimSpace(query.Keyword)+"%")
		argIndex++
	}
	if query.RegionID > 0 {
		conditions = append(conditions, "region_id = $"+strconv.Itoa(argIndex))
		args = append(args, query.RegionID)
		argIndex++
	}
	if query.AdmissionStatus != nil {
		conditions = append(conditions, "admission_status = $"+strconv.Itoa(argIndex))
		args = append(args, *query.AdmissionStatus)
		argIndex++
	}

	whereClause := strings.Join(conditions, " AND ")

	var total int64
	if err := repository.db.QueryRowContext(ctx, "SELECT COUNT(1) FROM enterprise WHERE "+whereClause, args...).Scan(&total); err != nil {
		return model.EnterprisePageResult{Items: []model.EnterpriseDTO{}, Page: query.Page, PageSize: query.PageSize, Total: 0}
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, query.PageSize, (query.Page-1)*query.PageSize)
	rows, err := repository.db.QueryContext(ctx, "\nSELECT id, short_name, unified_credit_code, region_id, admission_status, created_at, updated_at\nFROM enterprise\nWHERE "+whereClause+"\nORDER BY id DESC\nLIMIT $"+strconv.Itoa(argIndex)+" OFFSET $"+strconv.Itoa(argIndex+1), listArgs...)
	if err != nil {
		return model.EnterprisePageResult{Items: []model.EnterpriseDTO{}, Page: query.Page, PageSize: query.PageSize, Total: total}
	}
	defer rows.Close()

	items := make([]model.EnterpriseDTO, 0)
	for rows.Next() {
		var dto model.EnterpriseDTO
		if err := rows.Scan(&dto.ID, &dto.ShortName, &dto.UnifiedCreditCode, &dto.RegionID, &dto.AdmissionStatus, &dto.CreatedAt, &dto.UpdatedAt); err != nil {
			continue
		}
		items = append(items, dto)
	}

	return model.EnterprisePageResult{Items: items, Page: query.Page, PageSize: query.PageSize, Total: total}
}

func (repository *PostgresEnterpriseRepository) Create(aggregate model.EnterpriseAggregate) model.EnterpriseDetailDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.EnterpriseDetailDTO{}
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()
	aggregate.Enterprise.CreatedAt = now
	aggregate.Enterprise.UpdatedAt = now
	if aggregate.Enterprise.Status == "" {
		aggregate.Enterprise.Status = model.EnterpriseStatusActive
	}

	err = tx.QueryRowContext(ctx, `
INSERT INTO enterprise (
  short_name, region_id,
  in_hidden_debt_list, in_3899_list, meets_335_indicator, meets_224_indicator,
  enterprise_level, net_assets, real_estate_revenue_ratio, main_business_type,
  established_at, liability_asset_ratio, liability_asset_ratio_industry_median,
  non_standard_financing_ratio, main_business, related_party_public_opinion,
  admission_status, calculated_at, registered_capital, paid_in_capital,
  industry, address, business_scope, legal_person, company_type, enterprise_nature,
  actual_controller, actual_controller_control_path,
  issuer_rating, issuer_rating_agency,
  unified_credit_code, legal_person_id_card,
  status, created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2,
  $3, $4, $5, $6,
  $7, $8, $9, $10,
  $11, $12, $13,
  $14, $15, $16,
  $17, $18, $19, $20,
  $21, $22, $23, $24, $25, $26,
  $27, $28,
  $29, $30,
  $31, $32,
  $33, $34, $34, $35, $35
)
RETURNING id
`,
		aggregate.Enterprise.ShortName,
		aggregate.Enterprise.RegionID,
		aggregate.Enterprise.InHiddenDebtList,
		aggregate.Enterprise.In3899List,
		aggregate.Enterprise.Meets335Indicator,
		aggregate.Enterprise.Meets224Indicator,
		aggregate.Enterprise.EnterpriseLevel,
		aggregate.Enterprise.NetAssets,
		aggregate.Enterprise.RealEstateRevenueRatio,
		aggregate.Enterprise.MainBusinessType,
		aggregate.Enterprise.EstablishedAt,
		aggregate.Enterprise.LiabilityAssetRatio,
		aggregate.Enterprise.LiabilityAssetRatioIndustryMedian,
		aggregate.Enterprise.NonStandardFinancingRatio,
		aggregate.Enterprise.MainBusiness,
		aggregate.Enterprise.RelatedPartyPublicOpinion,
		aggregate.Enterprise.AdmissionStatus,
		aggregate.Enterprise.CalculatedAt,
		aggregate.Enterprise.RegisteredCapital,
		aggregate.Enterprise.PaidInCapital,
		aggregate.Enterprise.Industry,
		aggregate.Enterprise.Address,
		aggregate.Enterprise.BusinessScope,
		aggregate.Enterprise.LegalPerson,
		aggregate.Enterprise.CompanyType,
		aggregate.Enterprise.EnterpriseNature,
		aggregate.Enterprise.ActualController,
		aggregate.Enterprise.ActualControllerControlPath,
		aggregate.Enterprise.IssuerRating,
		aggregate.Enterprise.IssuerRatingAgency,
		aggregate.Enterprise.UnifiedCreditCode,
		aggregate.Enterprise.LegalPersonIDCard,
		aggregate.Enterprise.Status,
		now,
		aggregate.Enterprise.CreatedBy,
	).Scan(&aggregate.Enterprise.ID)
	if err != nil {
		return model.EnterpriseDetailDTO{}
	}

	if err := repository.replaceChildren(ctx, tx, aggregate); err != nil {
		return model.EnterpriseDetailDTO{}
	}

	if err := tx.Commit(); err != nil {
		return model.EnterpriseDetailDTO{}
	}

	created, ok := repository.FindByID(aggregate.Enterprise.ID)
	if !ok {
		return model.EnterpriseDetailDTO{}
	}
	return created
}

func (repository *PostgresEnterpriseRepository) Update(enterpriseID int64, aggregate model.EnterpriseAggregate) (model.EnterpriseDetailDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.EnterpriseDetailDTO{}, false
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `
UPDATE enterprise
SET
  short_name = $2,
  region_id = $3,
  in_hidden_debt_list = $4,
  in_3899_list = $5,
  meets_335_indicator = $6,
  meets_224_indicator = $7,
  enterprise_level = $8,
  net_assets = $9,
  real_estate_revenue_ratio = $10,
  main_business_type = $11,
  established_at = $12,
  liability_asset_ratio = $13,
  liability_asset_ratio_industry_median = $14,
  non_standard_financing_ratio = $15,
  main_business = $16,
  related_party_public_opinion = $17,
  admission_status = $18,
  calculated_at = $19,
  registered_capital = $20,
  paid_in_capital = $21,
  industry = $22,
  address = $23,
  business_scope = $24,
  legal_person = $25,
  company_type = $26,
  enterprise_nature = $27,
  actual_controller = $28,
  actual_controller_control_path = $29,
  issuer_rating = $30,
  issuer_rating_agency = $31,
  unified_credit_code = $32,
  legal_person_id_card = $33,
  updated_at = $34,
  updated_by = $35
WHERE id = $1 AND deleted_at IS NULL
`,
		enterpriseID,
		aggregate.Enterprise.ShortName,
		aggregate.Enterprise.RegionID,
		aggregate.Enterprise.InHiddenDebtList,
		aggregate.Enterprise.In3899List,
		aggregate.Enterprise.Meets335Indicator,
		aggregate.Enterprise.Meets224Indicator,
		aggregate.Enterprise.EnterpriseLevel,
		aggregate.Enterprise.NetAssets,
		aggregate.Enterprise.RealEstateRevenueRatio,
		aggregate.Enterprise.MainBusinessType,
		aggregate.Enterprise.EstablishedAt,
		aggregate.Enterprise.LiabilityAssetRatio,
		aggregate.Enterprise.LiabilityAssetRatioIndustryMedian,
		aggregate.Enterprise.NonStandardFinancingRatio,
		aggregate.Enterprise.MainBusiness,
		aggregate.Enterprise.RelatedPartyPublicOpinion,
		aggregate.Enterprise.AdmissionStatus,
		aggregate.Enterprise.CalculatedAt,
		aggregate.Enterprise.RegisteredCapital,
		aggregate.Enterprise.PaidInCapital,
		aggregate.Enterprise.Industry,
		aggregate.Enterprise.Address,
		aggregate.Enterprise.BusinessScope,
		aggregate.Enterprise.LegalPerson,
		aggregate.Enterprise.CompanyType,
		aggregate.Enterprise.EnterpriseNature,
		aggregate.Enterprise.ActualController,
		aggregate.Enterprise.ActualControllerControlPath,
		aggregate.Enterprise.IssuerRating,
		aggregate.Enterprise.IssuerRatingAgency,
		aggregate.Enterprise.UnifiedCreditCode,
		aggregate.Enterprise.LegalPersonIDCard,
		now,
		aggregate.Enterprise.UpdatedBy,
	)
	if err != nil {
		return model.EnterpriseDetailDTO{}, false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return model.EnterpriseDetailDTO{}, false
	}

	aggregate.Enterprise.ID = enterpriseID
	if err := repository.replaceChildren(ctx, tx, aggregate); err != nil {
		return model.EnterpriseDetailDTO{}, false
	}

	if err := tx.Commit(); err != nil {
		return model.EnterpriseDetailDTO{}, false
	}

	updated, ok := repository.FindByID(enterpriseID)
	return updated, ok
}

func (repository *PostgresEnterpriseRepository) Delete(enterpriseID int64, operatorID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	result, err := repository.db.ExecContext(ctx, `
UPDATE enterprise
SET status = $2, deleted_at = $3, deleted_by = $4, updated_at = $3, updated_by = $4
WHERE id = $1 AND deleted_at IS NULL
`, enterpriseID, model.EnterpriseStatusDeleted, now, operatorID)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	return err == nil && affected > 0
}

func (repository *PostgresEnterpriseRepository) replaceChildren(ctx context.Context, tx *sql.Tx, aggregate model.EnterpriseAggregate) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_tag WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.Tags {
		if strings.TrimSpace(item.Title) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO enterprise_tag (enterprise_id, title, order_no) VALUES ($1, $2, $3)`, aggregate.Enterprise.ID, strings.TrimSpace(item.Title), i+1); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_public_opinion WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.PublicOpinions {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO enterprise_public_opinion (enterprise_id, source, issue, opinion_time, title, order_no)
VALUES ($1, $2, $3, $4, $5, $6)
`, aggregate.Enterprise.ID, strings.TrimSpace(item.Source), strings.TrimSpace(item.Issue), item.Time, strings.TrimSpace(item.Title), i+1); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_bond_tender WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.BondTenders {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO enterprise_bond_tender (enterprise_id, tender_time, tender_type, project_type, winner, tender_title, order_no)
VALUES ($1, $2, $3, $4, $5, $6, $7)
`, aggregate.Enterprise.ID, item.Time, strings.TrimSpace(item.Type), strings.TrimSpace(item.ProjectType), strings.TrimSpace(item.Winner), strings.TrimSpace(item.TenderTitle), i+1); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_bond_detail WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.BondDetails {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO enterprise_bond_detail (
  enterprise_id, short_name, bond_code, bond_type, balance, bond_term, rating, guarantor,
  guarantor_type, issue_time, issue_rate, maturity_date, usefor, order_no
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
`, aggregate.Enterprise.ID, strings.TrimSpace(item.ShortName), strings.TrimSpace(item.Code), strings.TrimSpace(item.Type), item.Balance, strings.TrimSpace(item.Term), strings.TrimSpace(item.Rating), strings.TrimSpace(item.Guarantor), strings.TrimSpace(item.GuarantorType), item.Time, item.Rate, item.MaturityDate, strings.TrimSpace(item.Usefor), i+1); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_bond_registration WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.BondRegistrations {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO enterprise_bond_registration (enterprise_id, project_name, registration_status, status_updated_at, amount, process, order_no)
VALUES ($1, $2, $3, $4, $5, $6, $7)
`, aggregate.Enterprise.ID, strings.TrimSpace(item.ProjectName), strings.TrimSpace(item.Status), item.UpdatedAt, item.Amount, strings.TrimSpace(item.Process), i+1); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_finance_snapshot WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	if aggregate.FinanceSnapshot != nil {
		item := aggregate.FinanceSnapshot
		if _, err := tx.ExecContext(ctx, `
INSERT INTO enterprise_finance_snapshot (
  enterprise_id, roa, roe, interest_coverage,
  ebit_coverage, ebit_coverage_industry_median, ebitda_coverage, ebitda_coverage_industry_median,
  liability_asset_ratio_industry_median, roe_industry_median, non_standard_financing_ratio_industry_median,
  main_business_1, main_business_2, main_business_3, main_business_4, main_business_5,
  main_business_ratio_1, main_business_ratio_2, main_business_ratio_3, main_business_ratio_4, main_business_ratio_5
) VALUES (
  $1, $2, $3, $4,
  $5, $6, $7, $8,
  $9, $10, $11,
  $12, $13, $14, $15, $16,
  $17, $18, $19, $20, $21
)
`,
			aggregate.Enterprise.ID,
			item.ROA,
			item.ROE,
			item.InterestCoverage,
			item.EBITCoverage,
			item.EBITCoverageIndustryMedian,
			item.EBITDACoverage,
			item.EBITDACoverageIndustryMedian,
			item.LiabilityAssetRatioIndustryMedian,
			item.ROEIndustryMedian,
			item.NonStandardFinancingRatioIndustryMedian,
			strings.TrimSpace(item.MainBusiness1),
			strings.TrimSpace(item.MainBusiness2),
			strings.TrimSpace(item.MainBusiness3),
			strings.TrimSpace(item.MainBusiness4),
			strings.TrimSpace(item.MainBusiness5),
			item.MainBusinessRatio1,
			item.MainBusinessRatio2,
			item.MainBusinessRatio3,
			item.MainBusinessRatio4,
			item.MainBusinessRatio5,
		); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_finance_subject WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.FinanceSubjects {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO enterprise_finance_subject (enterprise_id, subject_name, subject_type, order_no)
VALUES ($1, $2, $3, $4)
`, aggregate.Enterprise.ID, strings.TrimSpace(item.SubjectName), strings.TrimSpace(item.SubjectType), i+1); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM enterprise_shareholder WHERE enterprise_id = $1`, aggregate.Enterprise.ID); err != nil {
		return err
	}
	for i, item := range aggregate.Shareholders {
		if strings.TrimSpace(item.ShareholderID) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO enterprise_shareholder (enterprise_id, shareholder_id, order_no) VALUES ($1, $2, $3)`, aggregate.Enterprise.ID, strings.TrimSpace(item.ShareholderID), i+1); err != nil {
			return err
		}
	}

	return nil
}

func (repository *PostgresEnterpriseRepository) findAggregateByID(ctx context.Context, tx *sql.Tx, enterpriseID int64) (model.EnterpriseAggregate, bool) {
	aggregate := model.EnterpriseAggregate{}
	queryRow := func(query string, args ...any) *sql.Row {
		if tx != nil {
			return tx.QueryRowContext(ctx, query, args...)
		}
		return repository.db.QueryRowContext(ctx, query, args...)
	}
	query := func(sqlText string, args ...any) (*sql.Rows, error) {
		if tx != nil {
			return tx.QueryContext(ctx, sqlText, args...)
		}
		return repository.db.QueryContext(ctx, sqlText, args...)
	}

	err := queryRow(`
SELECT
  id, short_name, region_id,
  in_hidden_debt_list, in_3899_list, meets_335_indicator, meets_224_indicator,
  enterprise_level, net_assets, real_estate_revenue_ratio, main_business_type,
  established_at, liability_asset_ratio, liability_asset_ratio_industry_median,
  non_standard_financing_ratio, main_business, related_party_public_opinion,
  admission_status, calculated_at, registered_capital, paid_in_capital,
  industry, address, business_scope, legal_person, company_type, enterprise_nature,
  actual_controller, actual_controller_control_path,
  issuer_rating, issuer_rating_agency,
  unified_credit_code, legal_person_id_card,
  status, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by
FROM enterprise
WHERE id = $1 AND deleted_at IS NULL
`, enterpriseID).Scan(
		&aggregate.Enterprise.ID,
		&aggregate.Enterprise.ShortName,
		&aggregate.Enterprise.RegionID,
		&aggregate.Enterprise.InHiddenDebtList,
		&aggregate.Enterprise.In3899List,
		&aggregate.Enterprise.Meets335Indicator,
		&aggregate.Enterprise.Meets224Indicator,
		&aggregate.Enterprise.EnterpriseLevel,
		floatPtrScanner{dst: &aggregate.Enterprise.NetAssets},
		floatPtrScanner{dst: &aggregate.Enterprise.RealEstateRevenueRatio},
		&aggregate.Enterprise.MainBusinessType,
		timePtrScanner{dst: &aggregate.Enterprise.EstablishedAt},
		floatPtrScanner{dst: &aggregate.Enterprise.LiabilityAssetRatio},
		floatPtrScanner{dst: &aggregate.Enterprise.LiabilityAssetRatioIndustryMedian},
		floatPtrScanner{dst: &aggregate.Enterprise.NonStandardFinancingRatio},
		&aggregate.Enterprise.MainBusiness,
		&aggregate.Enterprise.RelatedPartyPublicOpinion,
		&aggregate.Enterprise.AdmissionStatus,
		timePtrScanner{dst: &aggregate.Enterprise.CalculatedAt},
		floatPtrScanner{dst: &aggregate.Enterprise.RegisteredCapital},
		floatPtrScanner{dst: &aggregate.Enterprise.PaidInCapital},
		&aggregate.Enterprise.Industry,
		&aggregate.Enterprise.Address,
		&aggregate.Enterprise.BusinessScope,
		&aggregate.Enterprise.LegalPerson,
		&aggregate.Enterprise.CompanyType,
		&aggregate.Enterprise.EnterpriseNature,
		&aggregate.Enterprise.ActualController,
		&aggregate.Enterprise.ActualControllerControlPath,
		&aggregate.Enterprise.IssuerRating,
		&aggregate.Enterprise.IssuerRatingAgency,
		&aggregate.Enterprise.UnifiedCreditCode,
		&aggregate.Enterprise.LegalPersonIDCard,
		&aggregate.Enterprise.Status,
		&aggregate.Enterprise.CreatedAt,
		&aggregate.Enterprise.UpdatedAt,
		&aggregate.Enterprise.CreatedBy,
		&aggregate.Enterprise.UpdatedBy,
		timePtrScanner{dst: &aggregate.Enterprise.DeletedAt},
		int64PtrScanner{dst: &aggregate.Enterprise.DeletedBy},
	)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}

	rows, err := query(`SELECT id, title FROM enterprise_tag WHERE enterprise_id = $1 ORDER BY order_no ASC, id ASC`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterpriseTag
		if err := rows.Scan(&row.ID, &row.Title); err == nil {
			aggregate.Tags = append(aggregate.Tags, row)
		}
	}
	_ = rows.Close()

	rows, err = query(`SELECT id, source, issue, opinion_time, title, order_no FROM enterprise_public_opinion WHERE enterprise_id = $1 ORDER BY order_no ASC, id ASC`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterprisePublicOpinion
		if err := rows.Scan(&row.ID, &row.Source, &row.Issue, timePtrScanner{dst: &row.Time}, &row.Title, &row.OrderNo); err == nil {
			aggregate.PublicOpinions = append(aggregate.PublicOpinions, row)
		}
	}
	_ = rows.Close()

	rows, err = query(`SELECT id, tender_time, tender_type, project_type, winner, tender_title, order_no FROM enterprise_bond_tender WHERE enterprise_id = $1 ORDER BY order_no ASC, id ASC`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterpriseBondTender
		if err := rows.Scan(&row.ID, timePtrScanner{dst: &row.Time}, &row.Type, &row.ProjectType, &row.Winner, &row.TenderTitle, &row.OrderNo); err == nil {
			aggregate.BondTenders = append(aggregate.BondTenders, row)
		}
	}
	_ = rows.Close()

	rows, err = query(`
SELECT
  id, short_name, bond_code, bond_type, balance, bond_term, rating, guarantor,
  guarantor_type, issue_time, issue_rate, maturity_date, usefor, order_no
FROM enterprise_bond_detail
WHERE enterprise_id = $1
ORDER BY order_no ASC, id ASC
`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterpriseBondDetail
		if err := rows.Scan(
			&row.ID,
			&row.ShortName,
			&row.Code,
			&row.Type,
			floatPtrScanner{dst: &row.Balance},
			&row.Term,
			&row.Rating,
			&row.Guarantor,
			&row.GuarantorType,
			timePtrScanner{dst: &row.Time},
			floatPtrScanner{dst: &row.Rate},
			timePtrScanner{dst: &row.MaturityDate},
			&row.Usefor,
			&row.OrderNo,
		); err == nil {
			aggregate.BondDetails = append(aggregate.BondDetails, row)
		}
	}
	_ = rows.Close()

	rows, err = query(`SELECT id, project_name, registration_status, status_updated_at, amount, process, order_no FROM enterprise_bond_registration WHERE enterprise_id = $1 ORDER BY order_no ASC, id ASC`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterpriseBondRegistration
		if err := rows.Scan(&row.ID, &row.ProjectName, &row.Status, timePtrScanner{dst: &row.UpdatedAt}, floatPtrScanner{dst: &row.Amount}, &row.Process, &row.OrderNo); err == nil {
			aggregate.BondRegistrations = append(aggregate.BondRegistrations, row)
		}
	}
	_ = rows.Close()

	var snapshot model.EnterpriseFinanceSnapshot
	err = queryRow(`
SELECT id, roa, interest_coverage,
  roe, ebit_coverage, ebit_coverage_industry_median, ebitda_coverage, ebitda_coverage_industry_median,
  liability_asset_ratio_industry_median, roe_industry_median, non_standard_financing_ratio_industry_median,
  main_business_1, main_business_2, main_business_3, main_business_4, main_business_5,
  main_business_ratio_1, main_business_ratio_2, main_business_ratio_3, main_business_ratio_4, main_business_ratio_5
FROM enterprise_finance_snapshot
WHERE enterprise_id = $1
`, enterpriseID).Scan(
		&snapshot.ID,
		floatPtrScanner{dst: &snapshot.ROA},
		floatPtrScanner{dst: &snapshot.ROE},
		floatPtrScanner{dst: &snapshot.InterestCoverage},
		floatPtrScanner{dst: &snapshot.EBITCoverage},
		floatPtrScanner{dst: &snapshot.EBITCoverageIndustryMedian},
		floatPtrScanner{dst: &snapshot.EBITDACoverage},
		floatPtrScanner{dst: &snapshot.EBITDACoverageIndustryMedian},
		floatPtrScanner{dst: &snapshot.LiabilityAssetRatioIndustryMedian},
		floatPtrScanner{dst: &snapshot.ROEIndustryMedian},
		floatPtrScanner{dst: &snapshot.NonStandardFinancingRatioIndustryMedian},
		&snapshot.MainBusiness1,
		&snapshot.MainBusiness2,
		&snapshot.MainBusiness3,
		&snapshot.MainBusiness4,
		&snapshot.MainBusiness5,
		floatPtrScanner{dst: &snapshot.MainBusinessRatio1},
		floatPtrScanner{dst: &snapshot.MainBusinessRatio2},
		floatPtrScanner{dst: &snapshot.MainBusinessRatio3},
		floatPtrScanner{dst: &snapshot.MainBusinessRatio4},
		floatPtrScanner{dst: &snapshot.MainBusinessRatio5},
	)
	if err == nil {
		aggregate.FinanceSnapshot = &snapshot
	}

	rows, err = query(`SELECT id, subject_name, subject_type, order_no FROM enterprise_finance_subject WHERE enterprise_id = $1 ORDER BY order_no ASC, id ASC`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterpriseFinanceSubject
		if err := rows.Scan(&row.ID, &row.SubjectName, &row.SubjectType, &row.OrderNo); err == nil {
			aggregate.FinanceSubjects = append(aggregate.FinanceSubjects, row)
		}
	}
	_ = rows.Close()

	rows, err = query(`SELECT id, shareholder_id, order_no FROM enterprise_shareholder WHERE enterprise_id = $1 ORDER BY order_no ASC, id ASC`, enterpriseID)
	if err != nil {
		return model.EnterpriseAggregate{}, false
	}
	for rows.Next() {
		var row model.EnterpriseShareholder
		if err := rows.Scan(&row.ID, &row.ShareholderID, &row.OrderNo); err == nil {
			aggregate.Shareholders = append(aggregate.Shareholders, row)
		}
	}
	_ = rows.Close()

	return aggregate, true
}

type floatPtrScanner struct {
	dst **float64
}

func (scanner floatPtrScanner) Scan(src any) error {
	if src == nil {
		*scanner.dst = nil
		return nil
	}
	var value sql.NullFloat64
	if err := value.Scan(src); err != nil {
		return err
	}
	if !value.Valid {
		*scanner.dst = nil
		return nil
	}
	copied := value.Float64
	*scanner.dst = &copied
	return nil
}

type timePtrScanner struct {
	dst **time.Time
}

func (scanner timePtrScanner) Scan(src any) error {
	if src == nil {
		*scanner.dst = nil
		return nil
	}
	var value sql.NullTime
	if err := value.Scan(src); err != nil {
		return err
	}
	if !value.Valid {
		*scanner.dst = nil
		return nil
	}
	copied := value.Time
	*scanner.dst = &copied
	return nil
}

type int64PtrScanner struct {
	dst **int64
}

func (scanner int64PtrScanner) Scan(src any) error {
	if src == nil {
		*scanner.dst = nil
		return nil
	}
	var value sql.NullInt64
	if err := value.Scan(src); err != nil {
		return err
	}
	if !value.Valid {
		*scanner.dst = nil
		return nil
	}
	copied := value.Int64
	*scanner.dst = &copied
	return nil
}
