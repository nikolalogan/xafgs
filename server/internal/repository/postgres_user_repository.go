package repository

import (
	"context"
	"database/sql"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type PostgresUserRepository struct {
	db *sql.DB
}

func NewPostgresUserRepository(db *sql.DB) UserRepository {
	return &PostgresUserRepository{db: db}
}

func (repository *PostgresUserRepository) FindByID(userID int64) (model.UserDTO, bool) {
	user, ok := repository.FindEntityByID(userID)
	if !ok {
		return model.UserDTO{}, false
	}
	return user.ToDTO(), true
}

func (repository *PostgresUserRepository) FindEntityByID(userID int64) (model.User, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var user model.User
	err := repository.db.QueryRowContext(ctx, `
SELECT id, username, name, password, role, created_at, updated_at, created_by, updated_by
FROM app_user
WHERE id = $1
`, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Name,
		&user.Password,
		&user.Role,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.CreatedBy,
		&user.UpdatedBy,
	)
	if err != nil {
		return model.User{}, false
	}
	return user, true
}

func (repository *PostgresUserRepository) FindByUsername(username string) (model.User, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	trimmed := strings.TrimSpace(username)
	if trimmed == "" {
		return model.User{}, false
	}

	var user model.User
	err := repository.db.QueryRowContext(ctx, `
SELECT id, username, name, password, role, created_at, updated_at, created_by, updated_by
FROM app_user
WHERE username = $1
`, trimmed).Scan(
		&user.ID,
		&user.Username,
		&user.Name,
		&user.Password,
		&user.Role,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.CreatedBy,
		&user.UpdatedBy,
	)
	if err != nil {
		return model.User{}, false
	}
	return user, true
}

func (repository *PostgresUserRepository) FindAll() []model.UserDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := repository.db.QueryContext(ctx, `
SELECT id, username, name, role
FROM app_user
ORDER BY id ASC
`)
	if err != nil {
		return []model.UserDTO{}
	}
	defer rows.Close()

	users := make([]model.UserDTO, 0)
	for rows.Next() {
		var dto model.UserDTO
		if err := rows.Scan(&dto.ID, &dto.Username, &dto.Name, &dto.Role); err != nil {
			continue
		}
		users = append(users, dto)
	}

	sort.Slice(users, func(i, j int) bool { return users[i].ID < users[j].ID })
	return users
}

func (repository *PostgresUserRepository) Create(user model.User) model.UserDTO {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	user.CreatedAt = now
	user.UpdatedAt = now

	_ = repository.db.QueryRowContext(ctx, `
INSERT INTO app_user (username, name, password, role, created_at, updated_at, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $5, $6, $6)
RETURNING id
`, user.Username, user.Name, user.Password, user.Role, now, user.CreatedBy).Scan(&user.ID)

	return user.ToDTO()
}

func (repository *PostgresUserRepository) Update(userID int64, update model.User) (model.UserDTO, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	now := time.Now().UTC()
	_, err := repository.db.ExecContext(ctx, `
UPDATE app_user
SET name = $2, password = $3, role = $4, updated_at = $5, updated_by = $6
WHERE id = $1
`, userID, update.Name, update.Password, update.Role, now, update.UpdatedBy)
	if err != nil {
		return model.UserDTO{}, false
	}

	dto, ok := repository.FindByID(userID)
	return dto, ok
}

func (repository *PostgresUserRepository) Delete(userID int64) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := repository.db.ExecContext(ctx, `DELETE FROM app_user WHERE id = $1`, userID)
	return err == nil
}

