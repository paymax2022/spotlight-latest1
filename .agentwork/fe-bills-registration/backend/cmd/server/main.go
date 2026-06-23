package main

import (
	"log"

	"spotlight/backend/internal/app"
	"spotlight/backend/internal/config"
)

func main() {
	cfg := config.Load()
	r := app.NewRouter(cfg)
	log.Printf("backend listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
