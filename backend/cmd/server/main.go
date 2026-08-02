package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Cloud Run (and most orchestrators) send SIGTERM before removing an instance.
	// Drain in-flight requests/transactions instead of dropping them mid-flight.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("backend listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutdown signal received — draining connections (up to 25s)")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("graceful shutdown failed: %v", err)
	}
	log.Println("shutdown complete")
}
