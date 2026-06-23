package ratings

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service manages ratings. All entity types share one table.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Create submits a rating. Idempotent per (rater_id, transaction_ref).
func (s *Service) Create(ctx context.Context, raterID string, req CreateRequest) (*Rating, error) {
	r := &Rating{
		ID:             uuid.New().String(),
		RaterID:        raterID,
		EntityID:       req.EntityID,
		EntityType:     req.EntityType,
		TransactionRef: req.TransactionRef,
		Score:          req.Score,
		Comment:        req.Comment,
		CreatedAt:      time.Now(),
	}
	const insert = `
		INSERT INTO ratings (id, rater_id, entity_id, entity_type, transaction_ref, score, comment)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (rater_id, transaction_ref) DO NOTHING
		RETURNING id`
	var returned string
	err := s.db.QueryRow(ctx, insert,
		r.ID, r.RaterID, r.EntityID, string(r.EntityType), r.TransactionRef, r.Score, r.Comment,
	).Scan(&returned)
	if err != nil {
		// Conflict (already rated this transaction) — idempotent success.
		return r, nil
	}
	return r, nil
}

// GetSummary returns the aggregated rating for an entity.
func (s *Service) GetSummary(ctx context.Context, entityID string, entityType EntityType) (*Summary, error) {
	const q = `SELECT COALESCE(AVG(score),0), COUNT(*) FROM ratings WHERE entity_id=$1 AND entity_type=$2`
	sum := &Summary{EntityID: entityID, EntityType: string(entityType)}
	err := s.db.QueryRow(ctx, q, entityID, string(entityType)).Scan(&sum.Average, &sum.Count)
	if err != nil {
		return nil, fmt.Errorf("ratings: get summary: %w", err)
	}
	return sum, nil
}
