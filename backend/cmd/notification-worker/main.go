package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/notifications"
	"spotlight/backend/internal/platform/queue"
	"syscall"

	"github.com/hibiken/asynq"
)

func main() {
	cfg := config.Load()

	srv, err := queue.NewServer(cfg.RedisURL, 10)
	if err != nil {
		log.Fatalf("notification-worker: create asynq server: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	mux := asynq.NewServeMux()
	notifications.Workers(mux, notifications.ProviderConfig{
		ResendAPIKey:    cfg.ResendAPIKey,
		ResendFromEmail: cfg.ResendFromEmail,
		TermiiAPIKey:    cfg.TermiiAPIKey,
		TermiiSenderID:  cfg.TermiiSenderID,
		ExpoPushToken:   cfg.ExpoPushToken,
	})

	// SIGTERM/SIGINT → Shutdown() lets in-flight tasks finish before exit.
	go func() {
		<-ctx.Done()
		srv.Shutdown()
	}()

	log.Printf("notification-worker: consuming from %s (concurrency 10)", cfg.RedisURL)
	if err := srv.Run(mux); err != nil {
		log.Fatalf("notification-worker: %v", err)
	}
}
