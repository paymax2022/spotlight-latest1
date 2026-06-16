package disputes

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service manages dispute lifecycle.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Open creates a new dispute ticket.
func (s *Service) Open(ctx context.Context, userID string, req OpenRequest) (*Dispute, error) {
	d := &Dispute{
		ID:          uuid.New().String(),
		UserID:      userID,
		Reference:   req.Reference,
		ModuleType:  req.ModuleType,
		Type:        req.Type,
		Description: req.Description,
		Status:      StatusOpen,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	const insert = `
		INSERT INTO disputes (id, user_id, reference, module_type, type, description, status)
		VALUES ($1,$2,$3,$4,$5,$6,'open')`
	_, err := s.db.Exec(ctx, insert, d.ID, d.UserID, d.Reference, d.ModuleType, string(d.Type), d.Description)
	if err != nil {
		return nil, fmt.Errorf("disputes: open: %w", err)
	}
	return d, nil
}

// List returns disputes for a user, newest first.
func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]Dispute, error) {
	const q = `
		SELECT id, user_id, reference, module_type, type, description, status, created_at, updated_at
		FROM disputes WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dispute
	for rows.Next() {
		var d Dispute
		var typ, status string
		if err := rows.Scan(&d.ID, &d.UserID, &d.Reference, &d.ModuleType, &typ, &d.Description, &status, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.Type = DisputeType(typ)
		d.Status = Status(status)
		out = append(out, d)
	}
	return out, rows.Err()
}

// Resolve is called by admin to close a dispute.
func (s *Service) Resolve(ctx context.Context, disputeID string, resolution Resolution, adminNote string, adminID string) error {
	const update = `
		UPDATE disputes
		SET status='resolved', resolution=$2, admin_note=$3, updated_at=NOW()
		WHERE id=$1`
	_, err := s.db.Exec(ctx, update, disputeID, string(resolution), adminNote)
	return err
}
