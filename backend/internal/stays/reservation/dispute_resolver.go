package reservation

// dispute_resolver.go — stays-side delegate for the shared finance/disputes
// module (COM-016, ADM-009, ADM-011). The generic AdminResolve bare-flips the
// status column for every non-food module_type; wiring this resolver makes a
// "stays" dispute resolution with resolution=refunded post REAL refund legs
// through the same residual machinery the cancel sagas use — never a status
// flip that moves no money (the FOOD-004 bug shape).
//
// Money semantics: postCancelRefund under the 'stays:refund:<resID>:*' reference
// family, so dispute refunds net against the same parked provider_clearing /
// commission / escrow residual a later cancel sees — a dispute refund followed
// by a cancellation can never double-pay the guest. Legs are idempotent per
// (dispute, leg, amount) key; a refunded-above-residual request fails closed.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// DisputeResolver resolves module_type=="stays" disputes opened through the
// generic POST /api/finance/disputes surface (reference = stays_reservation.id).
type DisputeResolver struct {
	db     *pgxpool.Pool
	refund *RefundOps
}

// NewDisputeResolver constructs the stays dispute-resolution delegate.
func NewDisputeResolver(db *pgxpool.Pool) *DisputeResolver {
	return &DisputeResolver{
		db:     db,
		refund: NewRefundOps(NewRepository(db), ledger.NewService(ledger.NewRepository(db), nil)),
	}
}

// ResolveStaysDispute performs the admin resolution for one stays dispute.
// resolution: "refunded" posts real refund legs (refund_kobo REQUIRED, > 0);
// "settled"/"dismissed" only close the ticket. The dispute's reporter must be
// the reservation's guest — a dispute someone else opened against your booking
// can never draw your refund.
func (d *DisputeResolver) ResolveStaysDispute(ctx context.Context, disputeID, adminID, resolution string, refundKobo int64, note string) error {
	if d.db == nil {
		return errors.New("stays disputes: nil pool")
	}
	var resID, reporterID, status string
	if err := d.db.QueryRow(ctx,
		`SELECT reference, user_id, status FROM public.disputes WHERE id = $1 AND module_type = 'stays'`,
		disputeID).Scan(&resID, &reporterID, &status); err != nil {
		return fmt.Errorf("stays disputes: dispute %s not found: %w", disputeID, err)
	}
	if status == "resolved" || status == "closed" {
		return fmt.Errorf("stays disputes: dispute %s already %s", disputeID, status)
	}
	res, err := d.refund.repo.Get(ctx, resID)
	if err != nil {
		return fmt.Errorf("stays disputes: reservation %s lookup: %w", resID, err)
	}
	if res.GuestUserID != reporterID {
		return fmt.Errorf("stays disputes: reporter does not own reservation %s", resID)
	}

	if resolution == "refunded" {
		if refundKobo <= 0 {
			return errors.New("stays disputes: refund_kobo required for resolution=refunded")
		}
		if err := d.refund.postCancelRefund(ctx, res, refundKobo,
			"stays:refund:"+res.ID, "stays:dispute:"+disputeID+":refund"); err != nil {
			return fmt.Errorf("stays disputes: refund posting failed (retryable): %w", err)
		}
	}

	if _, err := d.db.Exec(ctx, `
		UPDATE public.disputes
		SET status = 'resolved', resolution = $2, admin_note = $3, updated_at = now()
		WHERE id = $1`, disputeID, resolution, note); err != nil {
		return fmt.Errorf("stays disputes: resolve update: %w", err)
	}
	return nil
}
