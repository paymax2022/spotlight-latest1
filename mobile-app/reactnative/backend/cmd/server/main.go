// Command server starts the Paymax Invest · Crypto API (mock provider adapters).
// Run: cd backend && go run ./cmd/server   (listens on :8080, override with PORT)
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"paymax/crypto-backend/internal/api"
	"paymax/crypto-backend/internal/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := api.NewServer(store.New())
	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	log.Printf("Paymax Invest · Crypto API listening on :%s", port)
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
