package main

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	connectvoting "spotlight/backend/internal/connect/voting"
	"spotlight/backend/internal/config"
)

func main() {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// Health check (no DB needed)
	r.GET("/api/v1/connect/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"module": "connect-voting",
			"status": "ok",
			"message": "Voting test server running",
		})
	})

	// Try to connect to database if DATABASE_URL is set
	var pool *pgxpool.Pool
	cfg := config.Load()
	if cfg.DatabaseURL != "" {
		var err error
		pool, err = pgxpool.New(context.Background(), cfg.DatabaseURL)
		if err != nil {
			log.Printf("Warning: could not connect to database: %v", err)
			log.Println("Continuing without database support")
		} else {
			defer pool.Close()
			log.Println("Connected to database")
		}
	} else {
		log.Println("DATABASE_URL not set - running without database")
	}

	// Wire voting routes (if database is available)
	if pool != nil {
		votingRepo := connectvoting.NewRepository(pool)
		votingSvc := connectvoting.NewService(votingRepo, nil, nil, nil, nil)
		connectvoting.Register(r.Group("/api/v1/connect"), votingSvc, cfg)
		log.Println("Voting routes registered")
	} else {
		log.Println("Skipping voting routes - database required")

		// Register 404 handler for voting routes
		r.NoRoute(func(c *gin.Context) {
			c.JSON(404, gin.H{
				"error": "Voting routes not available - database connection required",
			})
		})
	}

	log.Println("Starting voting test server on :8091")
	if err := r.Run(":8091"); err != nil {
		log.Fatal(err)
	}
}
