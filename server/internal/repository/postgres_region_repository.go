package repository

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresRegionRepository struct {
	db *sql.DB
}

func NewPostgresRegionRepository(db *sql.DB) RegionRepository {
	return &PostgresRegionRepository{db: db}
}

func (repository *PostgresRegionRepository) FindByID(regionID int64) (model.RegionDetailDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var region model.Region
	err := repository.db.QueryRowContext(ctx, `
SELECT id, admin_code, overview, created_at, updated_at, created_by, updated_by
FROM region
WHERE id = $1
`, regionID).Scan(
		&region.ID,
		&region.AdminCode,
		&region.Overview,
		&region.CreatedAt,
		&region.UpdatedAt,
		&region.CreatedBy,
		&region.UpdatedBy,
	)
	if err != nil {
		return model.RegionDetailDTO{}, false
	}

	economies, ok := repository.ListEconomies(regionID)
	if !ok {
		return model.RegionDetailDTO{}, false
	}
	ranks, ok := repository.ListRanks(regionID)
	if !ok {
		return model.RegionDetailDTO{}, false
	}
	return model.RegionDetailDTO{
		RegionDTO: region.ToDTO(),
		Economies: economies,
		Ranks:     ranks,
	}, true
}

func (repository *PostgresRegionRepository) FindByAdminCode(adminCode string) (model.RegionDetailDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(adminCode)
	if trimmed == "" {
		return model.RegionDetailDTO{}, false
	}
	var regionID int64
	if err := repository.db.QueryRowContext(ctx, `
SELECT id
FROM region
WHERE admin_code = $1
ORDER BY id ASC
LIMIT 1
`, trimmed).Scan(&regionID); err != nil {
		return model.RegionDetailDTO{}, false
	}
	return repository.FindByID(regionID)
}

func (repository *PostgresRegionRepository) FindPage(query model.RegionListQuery) model.RegionPageResult {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conditions := []string{"1 = 1"}
	args := make([]any, 0)
	argIndex := 1
	if strings.TrimSpace(query.Keyword) != "" {
		conditions = append(conditions, "(admin_code ILIKE $"+strconv.Itoa(argIndex)+" OR overview ILIKE $"+strconv.Itoa(argIndex)+")")
		args = append(args, "%"+strings.TrimSpace(query.Keyword)+"%")
		argIndex++
	}

	whereClause := strings.Join(conditions, " AND ")
	var total int64
	if err := repository.db.QueryRowContext(ctx, "SELECT COUNT(1) FROM region WHERE "+whereClause, args...).Scan(&total); err != nil {
		return model.RegionPageResult{Items: []model.RegionDTO{}, Page: query.Page, PageSize: query.PageSize, Total: 0}
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, query.PageSize, (query.Page-1)*query.PageSize)
	rows, err := repository.db.QueryContext(ctx, `
SELECT id, admin_code, overview
FROM region
WHERE `+whereClause+`
ORDER BY id DESC
LIMIT $`+strconv.Itoa(argIndex)+` OFFSET $`+strconv.Itoa(argIndex+1), listArgs...)
	if err != nil {
		return model.RegionPageResult{Items: []model.RegionDTO{}, Page: query.Page, PageSize: query.PageSize, Total: total}
	}
	defer rows.Close()

	items := make([]model.RegionDTO, 0)
	for rows.Next() {
		var row model.RegionDTO
		if err := rows.Scan(&row.ID, &row.AdminCode, &row.Overview); err == nil {
			items = append(items, row)
		}
	}

	return model.RegionPageResult{
		Items:    items,
		Page:     query.Page,
		PageSize: query.PageSize,
		Total:    total,
	}
}

func (repository *PostgresRegionRepository) Create(region model.Region, economies []model.RegionEconomy, ranks []model.RegionRank) model.RegionDetailDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.RegionDetailDTO{}
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()
	region.CreatedAt = now
	region.UpdatedAt = now
	err = tx.QueryRowContext(ctx, `
INSERT INTO region (admin_code, overview, created_at, updated_at, created_by, updated_by)
VALUES ($1, $2, $3, $3, $4, $4)
RETURNING id
`, region.AdminCode, region.Overview, now, region.CreatedBy).Scan(&region.ID)
	if err != nil {
		return model.RegionDetailDTO{}
	}

	for _, item := range economies {
		if _, ok := repository.createEconomyTx(ctx, tx, region.ID, item); !ok {
			return model.RegionDetailDTO{}
		}
	}
	for _, item := range ranks {
		if _, ok := repository.createRankTx(ctx, tx, region.ID, item); !ok {
			return model.RegionDetailDTO{}
		}
	}

	if err := tx.Commit(); err != nil {
		return model.RegionDetailDTO{}
	}
	created, ok := repository.FindByID(region.ID)
	if !ok {
		return model.RegionDetailDTO{}
	}
	return created
}

func (repository *PostgresRegionRepository) Update(regionID int64, region model.Region, economies []model.RegionEconomy, ranks []model.RegionRank) (model.RegionDetailDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	tx, err := repository.db.BeginTx(ctx, nil)
	if err != nil {
		return model.RegionDetailDTO{}, false
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `
UPDATE region
SET admin_code = $2, overview = $3, updated_at = $4, updated_by = $5
WHERE id = $1
`, regionID, region.AdminCode, region.Overview, now, region.UpdatedBy)
	if err != nil {
		return model.RegionDetailDTO{}, false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return model.RegionDetailDTO{}, false
	}

	if economies != nil {
		if _, err := tx.ExecContext(ctx, `DELETE FROM region_economy WHERE region_id = $1`, regionID); err != nil {
			return model.RegionDetailDTO{}, false
		}
		for _, item := range economies {
			if _, ok := repository.createEconomyTx(ctx, tx, regionID, item); !ok {
				return model.RegionDetailDTO{}, false
			}
		}
	}
	if ranks != nil {
		if _, err := tx.ExecContext(ctx, `DELETE FROM region_rank WHERE region_id = $1`, regionID); err != nil {
			return model.RegionDetailDTO{}, false
		}
		for _, item := range ranks {
			if _, ok := repository.createRankTx(ctx, tx, regionID, item); !ok {
				return model.RegionDetailDTO{}, false
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return model.RegionDetailDTO{}, false
	}
	updated, ok := repository.FindByID(regionID)
	return updated, ok
}

func (repository *PostgresRegionRepository) Delete(regionID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	result, err := repository.db.ExecContext(ctx, `DELETE FROM region WHERE id = $1`, regionID)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	return err == nil && affected > 0
}

func (repository *PostgresRegionRepository) ListEconomies(regionID int64) ([]model.RegionEconomy, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

rows, err := repository.db.QueryContext(ctx, `
SELECT
  id, region_id, year, is_top100_county, is_top100_city,
  gdp, gdp_growth, population, fiscal_self_sufficiency_ratio, general_budget_revenue,
  general_budget_revenue_growth, general_budget_revenue_total, general_budget_revenue_tax,
  general_budget_revenue_non_tax, general_budget_revenue_superior_subsidy,
  liability_ratio, liability_ratio_broad, debt_ratio, debt_ratio_broad,
  created_at, updated_at, created_by, updated_by
FROM region_economy
WHERE region_id = $1
ORDER BY year DESC, id DESC
`, regionID)
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	out := make([]model.RegionEconomy, 0)
	for rows.Next() {
		var row model.RegionEconomy
		if err := rows.Scan(
			&row.ID,
			&row.RegionID,
			&row.Year,
			&row.IsTop100County,
			&row.IsTop100City,
			floatPtrScanner{dst: &row.GDP},
			floatPtrScanner{dst: &row.GDPGrowth},
			floatPtrScanner{dst: &row.Population},
			floatPtrScanner{dst: &row.FiscalSelfSufficiencyRatio},
			floatPtrScanner{dst: &row.GeneralBudgetRevenue},
			floatPtrScanner{dst: &row.GeneralBudgetRevenueGrowth},
			floatPtrScanner{dst: &row.GeneralBudgetRevenueTotal},
			floatPtrScanner{dst: &row.GeneralBudgetRevenueTax},
			floatPtrScanner{dst: &row.GeneralBudgetRevenueNonTax},
			floatPtrScanner{dst: &row.GeneralBudgetRevenueSuperiorSubsidy},
			floatPtrScanner{dst: &row.LiabilityRatio},
			floatPtrScanner{dst: &row.LiabilityRatioBroad},
			floatPtrScanner{dst: &row.DebtRatio},
			floatPtrScanner{dst: &row.DebtRatioBroad},
			&row.CreatedAt,
			&row.UpdatedAt,
			&row.CreatedBy,
			&row.UpdatedBy,
		); err == nil {
			out = append(out, row)
		}
	}
	return out, true
}

func (repository *PostgresRegionRepository) CreateEconomy(regionID int64, economy model.RegionEconomy) (model.RegionEconomy, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	created, ok := repository.createEconomyTx(ctx, nil, regionID, economy)
	if !ok {
		return model.RegionEconomy{}, false
	}
	return created, true
}

func (repository *PostgresRegionRepository) UpdateEconomy(regionID int64, economyID int64, economy model.RegionEconomy) (model.RegionEconomy, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
result, err := repository.db.ExecContext(ctx, `
UPDATE region_economy
SET
  year = $3,
  is_top100_county = $4,
  is_top100_city = $5,
  gdp = $6,
  gdp_growth = $7,
  population = $8,
  fiscal_self_sufficiency_ratio = $9,
  general_budget_revenue = $10,
  general_budget_revenue_growth = $11,
  general_budget_revenue_total = $12,
  general_budget_revenue_tax = $13,
  general_budget_revenue_non_tax = $14,
  general_budget_revenue_superior_subsidy = $15,
  liability_ratio = $16,
  liability_ratio_broad = $17,
  debt_ratio = $18,
  debt_ratio_broad = $19,
  updated_at = $20,
  updated_by = $21
WHERE id = $1 AND region_id = $2
`, economyID, regionID, economy.Year, economy.IsTop100County, economy.IsTop100City,
		economy.GDP, economy.GDPGrowth, economy.Population, economy.FiscalSelfSufficiencyRatio,
		economy.GeneralBudgetRevenue, economy.GeneralBudgetRevenueGrowth, economy.GeneralBudgetRevenueTotal,
		economy.GeneralBudgetRevenueTax, economy.GeneralBudgetRevenueNonTax, economy.GeneralBudgetRevenueSuperiorSubsidy,
		economy.LiabilityRatio, economy.LiabilityRatioBroad, economy.DebtRatio, economy.DebtRatioBroad,
		now, economy.UpdatedBy)
	if err != nil {
		return model.RegionEconomy{}, false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return model.RegionEconomy{}, false
	}

	rows, ok := repository.ListEconomies(regionID)
	if !ok {
		return model.RegionEconomy{}, false
	}
	for _, row := range rows {
		if row.ID == economyID {
			return row, true
		}
	}
	return model.RegionEconomy{}, false
}

func (repository *PostgresRegionRepository) DeleteEconomy(regionID int64, economyID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	result, err := repository.db.ExecContext(ctx, `DELETE FROM region_economy WHERE id = $1 AND region_id = $2`, economyID, regionID)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	return err == nil && affected > 0
}

func (repository *PostgresRegionRepository) createEconomyTx(ctx context.Context, tx *sql.Tx, regionID int64, economy model.RegionEconomy) (model.RegionEconomy, bool) {
	now := time.Now().UTC()
	query := `
INSERT INTO region_economy (
  region_id, year, is_top100_county, is_top100_city,
  gdp, gdp_growth, population, fiscal_self_sufficiency_ratio, general_budget_revenue,
  general_budget_revenue_growth, general_budget_revenue_total, general_budget_revenue_tax,
  general_budget_revenue_non_tax, general_budget_revenue_superior_subsidy,
  liability_ratio, liability_ratio_broad, debt_ratio, debt_ratio_broad,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4,
  $5, $6, $7, $8, $9,
  $10, $11, $12, $13, $14,
  $15, $16, $17, $18,
  $19, $19, $20, $20
)
RETURNING id
`
	economy.RegionID = regionID
	economy.CreatedAt = now
	economy.UpdatedAt = now

	var err error
	if tx != nil {
		err = tx.QueryRowContext(ctx, query,
			regionID, economy.Year, economy.IsTop100County, economy.IsTop100City,
			economy.GDP, economy.GDPGrowth, economy.Population, economy.FiscalSelfSufficiencyRatio, economy.GeneralBudgetRevenue,
			economy.GeneralBudgetRevenueGrowth, economy.GeneralBudgetRevenueTotal, economy.GeneralBudgetRevenueTax,
			economy.GeneralBudgetRevenueNonTax, economy.GeneralBudgetRevenueSuperiorSubsidy,
			economy.LiabilityRatio, economy.LiabilityRatioBroad, economy.DebtRatio, economy.DebtRatioBroad,
			now, economy.CreatedBy,
		).Scan(&economy.ID)
	} else {
		err = repository.db.QueryRowContext(ctx, query,
			regionID, economy.Year, economy.IsTop100County, economy.IsTop100City,
			economy.GDP, economy.GDPGrowth, economy.Population, economy.FiscalSelfSufficiencyRatio, economy.GeneralBudgetRevenue,
			economy.GeneralBudgetRevenueGrowth, economy.GeneralBudgetRevenueTotal, economy.GeneralBudgetRevenueTax,
			economy.GeneralBudgetRevenueNonTax, economy.GeneralBudgetRevenueSuperiorSubsidy,
			economy.LiabilityRatio, economy.LiabilityRatioBroad, economy.DebtRatio, economy.DebtRatioBroad,
			now, economy.CreatedBy,
		).Scan(&economy.ID)
	}
	if err != nil {
		return model.RegionEconomy{}, false
	}
	return economy, true
}

func (repository *PostgresRegionRepository) ListRanks(regionID int64) ([]model.RegionRank, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT
  id, region_id, subject, rank, total, year, growth_rate,
  created_at, updated_at, created_by, updated_by
FROM region_rank
WHERE region_id = $1
ORDER BY year DESC, id DESC
`, regionID)
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	out := make([]model.RegionRank, 0)
	for rows.Next() {
		var row model.RegionRank
		if err := rows.Scan(
			&row.ID,
			&row.RegionID,
			&row.Subject,
			intPtrScanner{dst: &row.Rank},
			intPtrScanner{dst: &row.Total},
			&row.Year,
			floatPtrScanner{dst: &row.GrowthRate},
			&row.CreatedAt,
			&row.UpdatedAt,
			&row.CreatedBy,
			&row.UpdatedBy,
		); err == nil {
			out = append(out, row)
		}
	}
	return out, true
}

func (repository *PostgresRegionRepository) CreateRank(regionID int64, rank model.RegionRank) (model.RegionRank, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	created, ok := repository.createRankTx(ctx, nil, regionID, rank)
	if !ok {
		return model.RegionRank{}, false
	}
	return created, true
}

func (repository *PostgresRegionRepository) UpdateRank(regionID int64, rankID int64, rank model.RegionRank) (model.RegionRank, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	result, err := repository.db.ExecContext(ctx, `
UPDATE region_rank
SET
  subject = $3,
  rank = $4,
  total = $5,
  year = $6,
  growth_rate = $7,
  updated_at = $8,
  updated_by = $9
WHERE id = $1 AND region_id = $2
`, rankID, regionID, strings.TrimSpace(rank.Subject), rank.Rank, rank.Total, rank.Year, rank.GrowthRate, now, rank.UpdatedBy)
	if err != nil {
		return model.RegionRank{}, false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return model.RegionRank{}, false
	}
	rows, ok := repository.ListRanks(regionID)
	if !ok {
		return model.RegionRank{}, false
	}
	for _, row := range rows {
		if row.ID == rankID {
			return row, true
		}
	}
	return model.RegionRank{}, false
}

func (repository *PostgresRegionRepository) DeleteRank(regionID int64, rankID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result, err := repository.db.ExecContext(ctx, `DELETE FROM region_rank WHERE id = $1 AND region_id = $2`, rankID, regionID)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	return err == nil && affected > 0
}

func (repository *PostgresRegionRepository) createRankTx(ctx context.Context, tx *sql.Tx, regionID int64, rank model.RegionRank) (model.RegionRank, bool) {
	now := time.Now().UTC()
	query := `
INSERT INTO region_rank (
  region_id, subject, rank, total, year, growth_rate,
  created_at, updated_at, created_by, updated_by
) VALUES (
  $1, $2, $3, $4, $5, $6,
  $7, $7, $8, $8
)
RETURNING id
`
	rank.RegionID = regionID
	rank.Subject = strings.TrimSpace(rank.Subject)
	rank.CreatedAt = now
	rank.UpdatedAt = now

	var err error
	if tx != nil {
		err = tx.QueryRowContext(ctx, query,
			regionID, rank.Subject, rank.Rank, rank.Total, rank.Year, rank.GrowthRate,
			now, rank.CreatedBy,
		).Scan(&rank.ID)
	} else {
		err = repository.db.QueryRowContext(ctx, query,
			regionID, rank.Subject, rank.Rank, rank.Total, rank.Year, rank.GrowthRate,
			now, rank.CreatedBy,
		).Scan(&rank.ID)
	}
	if err != nil {
		return model.RegionRank{}, false
	}
	return rank, true
}

type intPtrScanner struct {
	dst **int
}

func (scanner intPtrScanner) Scan(src any) error {
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
	copied := int(value.Int64)
	*scanner.dst = &copied
	return nil
}
