package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type OpenResult struct {
	DB *sql.DB
}

func OpenFromEnv() (*OpenResult, bool, error) {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		return nil, false, nil
	}

	conn, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, false, fmt.Errorf("open database: %w", err)
	}

	conn.SetConnMaxLifetime(30 * time.Minute)
	conn.SetMaxOpenConns(10)
	conn.SetMaxIdleConns(5)

	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		return nil, false, fmt.Errorf("ping database: %w", err)
	}

	return &OpenResult{DB: conn}, true, nil
}

func HasExtension(ctx context.Context, conn *sql.DB, name string) (bool, error) {
	trimmed := strings.TrimSpace(name)
	if conn == nil || trimmed == "" {
		return false, nil
	}
	var exists bool
	err := conn.QueryRowContext(ctx, `
SELECT EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = $1
)
`, trimmed).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
