package main

import (
	"log"
	"os"
	"time"

	"sxfgssever/server/internal/bootstrap"
)

func main() {
	configureTimezone()
	app, cfg := bootstrap.NewApp()
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("server listen failed: %v", err)
	}
}

func configureTimezone() {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		location = time.FixedZone("Asia/Shanghai", 8*60*60)
	}
	time.Local = location
	if os.Getenv("TZ") == "" {
		_ = os.Setenv("TZ", "Asia/Shanghai")
	}
}
