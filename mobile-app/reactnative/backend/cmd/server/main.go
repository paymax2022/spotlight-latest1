// Command server starts the Paymax Invest · Crypto API (mock provider adapters).
// Run: cd backend && go run ./cmd/server   (listens on :8080, override with PORT)
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

	"paymax/crypto-backend/internal/api"
	"paymax/crypto-backend/internal/config"
	"paymax/crypto-backend/internal/pgstore"
	"paymax/crypto-backend/internal/store"
)

func main() {
	// Central config layer: one load from the environment (see internal/config).
	cfg := config.Load()

	port := cfg.Port
	if port == "" {
		port = "8080"
	}

	// Storage engine: Postgres when DATABASE_URL is set, else the in-memory mock.
	var repo store.Repository
	if dsn := cfg.DatabaseURL; dsn != "" {
		pg, err := pgstore.New(context.Background(), dsn)
		if err != nil {
			log.Fatalf("postgres: %v", err)
		}
		defer pg.Close()
		repo = pg
		log.Printf("storage: postgres")
	} else {
		repo = store.New()
		log.Printf("storage: in-memory (set DATABASE_URL to use postgres)")
	}

	srv := api.NewServer(repo)
	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	// Graceful shutdown: stop accepting on SIGINT/SIGTERM, drain in-flight requests.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("Paymax Invest · Crypto API listening on :%s", port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
