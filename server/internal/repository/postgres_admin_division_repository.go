package repository

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresAdminDivisionRepository struct {
	db *sql.DB
}

func NewPostgresAdminDivisionRepository(db *sql.DB) AdminDivisionRepository {
	return &PostgresAdminDivisionRepository{db: db}
}

func (repository *PostgresAdminDivisionRepository) FindPage(query model.AdminDivisionListQuery) model.AdminDivisionPageResult {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conditions := []string{"1=1"}
	args := make([]any, 0, 4)
	argIndex := 1
	if keyword := strings.TrimSpace(query.Keyword); keyword != "" {
		conditions = append(conditions, "(ad.code ILIKE $"+strconv.Itoa(argIndex)+" OR ad.name ILIKE $"+strconv.Itoa(argIndex)+")")
		args = append(args, "%"+keyword+"%")
		argIndex++
	}
	if query.Level != nil {
		conditions = append(conditions, "ad.level = $"+strconv.Itoa(argIndex))
		args = append(args, *query.Level)
		argIndex++
	}
	if parentCode := strings.TrimSpace(query.ParentCode); parentCode != "" {
		conditions = append(conditions, "ad.parent_code = $"+strconv.Itoa(argIndex))
		args = append(args, parentCode)
		argIndex++
	}

	whereClause := strings.Join(conditions, " AND ")
	var total int64
	if err := repository.db.QueryRowContext(ctx, "SELECT COUNT(1) FROM admin_division ad WHERE "+whereClause, args...).Scan(&total); err != nil {
		return model.AdminDivisionPageResult{Items: []model.AdminDivisionDTO{}, Page: query.Page, PageSize: query.PageSize, Total: 0}
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, query.PageSize, (query.Page-1)*query.PageSize)
	rows, err := repository.db.QueryContext(ctx, `
SELECT ad.id, ad.code, ad.name, ad.level, ad.indent, COALESCE(ad.parent_code, ''), COALESCE(p.name, '')
FROM admin_division ad
LEFT JOIN admin_division p ON p.code = ad.parent_code
WHERE `+whereClause+`
ORDER BY ad.code ASC
LIMIT $`+strconv.Itoa(argIndex)+` OFFSET $`+strconv.Itoa(argIndex+1), listArgs...)
	if err != nil {
		return model.AdminDivisionPageResult{Items: []model.AdminDivisionDTO{}, Page: query.Page, PageSize: query.PageSize, Total: total}
	}
	defer rows.Close()

	items := make([]model.AdminDivisionDTO, 0)
	for rows.Next() {
		var item model.AdminDivisionDTO
		if scanErr := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Level, &item.Indent, &item.ParentCode, &item.ParentName); scanErr == nil {
			items = append(items, item)
		}
	}

	return model.AdminDivisionPageResult{
		Items:    items,
		Page:     query.Page,
		PageSize: query.PageSize,
		Total:    total,
	}
}

func (repository *PostgresAdminDivisionRepository) FindByCode(code string) (model.AdminDivisionDTO, bool) {
	trimmed := strings.TrimSpace(code)
	if trimmed == "" {
		return model.AdminDivisionDTO{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var item model.AdminDivisionDTO
	err := repository.db.QueryRowContext(ctx, `
SELECT ad.id, ad.code, ad.name, ad.level, ad.indent, COALESCE(ad.parent_code, ''), COALESCE(p.name, '')
FROM admin_division ad
LEFT JOIN admin_division p ON p.code = ad.parent_code
WHERE ad.code = $1
LIMIT 1
`, trimmed).Scan(&item.ID, &item.Code, &item.Name, &item.Level, &item.Indent, &item.ParentCode, &item.ParentName)
	if err != nil {
		return model.AdminDivisionDTO{}, false
	}
	return item, true
}

func (repository *PostgresAdminDivisionRepository) FindParentChainByCode(code string) ([]model.AdminDivisionChainNode, bool) {
	current, ok := repository.FindByCode(code)
	if !ok {
		return nil, false
	}
	parentCode := strings.TrimSpace(current.ParentCode)
	if parentCode == "" {
		return []model.AdminDivisionChainNode{}, true
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	chain := make([]model.AdminDivisionChainNode, 0, 4)
	guard := 0
	for parentCode != "" && guard < 16 {
		guard++
		var codeValue string
		var name string
		var level int
		var nextParentCode string
		err := repository.db.QueryRowContext(ctx, `
SELECT code, name, level, COALESCE(parent_code, '')
FROM admin_division
WHERE code = $1
LIMIT 1
`, parentCode).Scan(&codeValue, &name, &level, &nextParentCode)
		if err != nil {
			break
		}
		chain = append(chain, model.AdminDivisionChainNode{
			Code:  codeValue,
			Name:  name,
			Level: level,
		})
		parentCode = strings.TrimSpace(nextParentCode)
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain, true
}

