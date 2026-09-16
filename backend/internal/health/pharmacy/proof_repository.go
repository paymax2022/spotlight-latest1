package healthpharmacy

// ProofRepo is the DP-006 thin repository over pharmacy_delivery_proofs — the
// default ProofRecorder wired by NewService. Rows are immutable: RecordProof only
// inserts (idempotent per order via the partial unique index), never updates.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProofRepo struct {
	db *pgxpool.Pool
}

func NewProofRepo(db *pgxpool.Pool) *ProofRepo { return &ProofRepo{db: db} }

func (r *ProofRepo) RecordProof(ctx context.Context, proof DeliveryProof) (*DeliveryProof, error) {
	const q = `
		INSERT INTO pharmacy_delivery_proofs (order_id, proof_type, proof_data, captured_by, note, recipient_name)
		VALUES ($1, $2, $3, $4, NULLIF($5,''), $6)
		RETURNING id, captured_at`
	stored := proof
	if err := r.db.QueryRow(ctx, q, proof.OrderID, string(proof.ProofType), proof.ProofData,
		proof.CapturedBy, proof.Note, proof.RecipientName).Scan(&stored.ID, &stored.CapturedAt); err != nil {
		// A proof already recorded for this order (unique per order) is returned
		// as-is rather than erroring — completion retries must stay idempotent.
		if existing, gerr := r.GetProofForOrder(ctx, proof.OrderID); gerr == nil && existing != nil {
			return existing, nil
		}
		return nil, fmt.Errorf("pharmacy: record delivery proof: %w", err)
	}
	return &stored, nil
}

func (r *ProofRepo) GetProofForOrder(ctx context.Context, orderID string) (*DeliveryProof, error) {
	const q = `
		SELECT id, order_id, proof_type, proof_data, captured_by, captured_at, verified_at,
		       COALESCE(note,''), recipient_name
		FROM pharmacy_delivery_proofs WHERE order_id = $1
		ORDER BY captured_at ASC LIMIT 1`
	var p DeliveryProof
	if err := r.db.QueryRow(ctx, q, orderID).Scan(
		&p.ID, &p.OrderID, &p.ProofType, &p.ProofData, &p.CapturedBy, &p.CapturedAt,
		&p.VerifiedAt, &p.Note, &p.RecipientName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("pharmacy: load delivery proof: %w", err)
	}
	return &p, nil
}
