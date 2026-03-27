package main

import (
	"log"

	"sxfgssever/server/internal/bootstrap"
)

func main() {
	app, cfg := bootstrap.NewApp()
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("server listen failed: %v", err)
	}
}
