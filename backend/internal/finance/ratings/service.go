package ratings

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service manages ratings. All entity types share one table.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Create submits a rating. Idempotent per (rater_id, transaction_ref): a second
// submission for the same transaction never inserts a second row, and — unlike
// the previous version of this method — never fabricates one either. It returns
// the ACTUAL row that ends up in the table (the first submission's score/comment/
// id/timestamp, not whatever the caller just sent), plus created=false, so the
// caller can tell "recorded" from "you already rated this" instead of getting a
// fake 201 that silently discarded the real data on a duplicate.
func (s *Service) Create(ctx context.Context, raterID string, req CreateRequest) (rating *Rating, created bool, err error) {
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
		RETURNING id, created_at`
	if err := s.db.QueryRow(ctx, insert,
		r.ID, r.RaterID, r.EntityID, string(r.EntityType), r.TransactionRef, r.Score, r.Comment,
	).Scan(&r.ID, &r.CreatedAt); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, false, fmt.Errorf("ratings: create: %w", err)
		}
		// Conflict — this rater already rated this transaction. Fetch and return
		// the row that actually exists rather than the one just built in memory.
		existing, ferr := s.getByRaterAndTransaction(ctx, raterID, req.TransactionRef)
		if ferr != nil {
			return nil, false, fmt.Errorf("ratings: fetch existing after conflict: %w", ferr)
		}
		return existing, false, nil
	}
	return r, true, nil
}

func (s *Service) getByRaterAndTransaction(ctx context.Context, raterID, transactionRef string) (*Rating, error) {
	const q = `
		SELECT id, rater_id, entity_id, entity_type, transaction_ref, score, comment, created_at
		FROM ratings WHERE rater_id=$1 AND transaction_ref=$2`
	r := &Rating{}
	var entityType string
	if err := s.db.QueryRow(ctx, q, raterID, transactionRef).Scan(
		&r.ID, &r.RaterID, &r.EntityID, &entityType, &r.TransactionRef, &r.Score, &r.Comment, &r.CreatedAt,
	); err != nil {
		return nil, err
	}
	r.EntityType = EntityType(entityType)
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
