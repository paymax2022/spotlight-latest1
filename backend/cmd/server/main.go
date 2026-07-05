package main

import (
	"log"

	"spotlight/backend/internal/app"
	"spotlight/backend/internal/config"
)

func main() {
	cfg := config.Load()
	// Fail-fast: refuse to boot in production with missing/placeholder/swapped
	// secrets; log advisory warnings in dev/staging.
	if err := cfg.Validate(); err != nil {
		log.Fatalf("startup aborted: %v", err)
	}
	r := app.NewRouter(cfg)
	log.Printf("backend listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
