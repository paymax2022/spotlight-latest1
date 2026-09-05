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
	"spotlight/backend/internal/platform/buildinfo"
	"spotlight/backend/internal/platform/observability"
)

func main() {
	cfg := config.Load()
	// Fail-fast: refuse to boot in production with missing/placeholder/swapped
	// secrets; log advisory warnings in dev/staging.
	if err := cfg.Validate(); err != nil {
		log.Fatalf("startup aborted: %v", err)
	}

	// Say which source this process is actually serving. A server is a snapshot
	// of its tree at start time, and the shared dev backend runs from whichever
	// checkout someone last started it in — so "the fix is on develop" tells you
	// nothing about what is answering requests. Skipped in production: a deployed
	// image has no .git, and there is no shared-checkout ambiguity to resolve.
	if cfg.AppEnv != "production" {
		log.Print(buildinfo.Line(buildinfo.Describe(context.Background(), ".")))
	}

	// Error tracking (Sentry) + tracing (OTel→Cloud Trace); no-op unless configured.
	flushObservability := observability.Init(cfg.AppEnv)

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
		log.Printf("graceful shutdown error: %v", err)
	}
	// Flush buffered Sentry events + OTel spans before the process exits.
	flushObservability(shutdownCtx)
	log.Println("shutdown complete")
}
