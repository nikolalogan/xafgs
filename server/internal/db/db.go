package db

import (
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

