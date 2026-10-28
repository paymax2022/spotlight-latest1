package healthlab

import (
	"context"
	"errors"
	"time"
)

// Provider earnings: a READ-ONLY view for a lab owner. It moves no money and posts
// no ledger entries.
//
// Money model (unchanged by this file): a patient's payment is HELD in escrow at
// order time; releasing a result releases the held amount, in full, to the lab
// owner's WALLET (escrow.ensureResolutionCredit). Getting that money out of the
// wallet is the platform's one canonical wallet-to-bank corridor
// (finance/transfers.InitiateBankTransfer: transaction PIN, tier limit, fee,
// ledger reservation, provider failover, idempotency). The lab module therefore
// has NO payout mutation of its own — a second money-out path would duplicate that
// corridor's invariants. This view reports where the owner's money is:
//
//	earned    released to this owner (escrow RELEASED, payee = owner)
//	pending   HELD on orders still moving through collection / processing
//	held      HELD on orders awaiting sign-off or escalated, plus DISPUTED holds
//	available the wallet balance the ledger reports (what a bank transfer can draw on)
//
// Every figure is integer kobo and is derived from escrow_holds joined to this
// owner's lab orders, so it can be reconciled row by row against the ledger.

var ErrNotLabOwner = errors.New("lab: only a lab owner can view earnings")

// EarningsReader reads the owner's withdrawable wallet balance from the ledger.
type EarningsReader interface {
	AvailableKobo(ctx context.Context, userID string) (int64, error)
}

// SetEarningsReader injects the wallet-balance reader (app wiring).
func (s *Service) SetEarningsReader(r EarningsReader) { s.earn = r }

// Withdrawal is one of the owner's wallet-to-bank transfers. These are the
// owner's own transfers from the canonical corridor — not lab-specific rows.
type Withdrawal struct {
	ID         string    `json:"id"`
	AmountKobo int64     `json:"amount_kobo"`
	Status     string    `json:"status"` // paid | processing | failed
	At         time.Time `json:"at"`
}

// Earnings is the owner's earnings summary.
type Earnings struct {
	AvailableKobo int64        `json:"available_kobo"`
	EarnedKobo    int64        `json:"earned_kobo"`
	PendingKobo   int64        `json:"pending_kobo"`
	HeldKobo      int64        `json:"held_kobo"`
	Withdrawals   []Withdrawal `json:"withdrawals"`
}

// withdrawalStatus folds the transfer lifecycle into what the owner needs to know.
func withdrawalStatus(s string) string {
	switch s {
	case "successful":
		return "paid"
	case "failed", "reversed":
		return "failed"
	}
	return "processing"
}

// ownedLabIDs returns the lab providers the caller owns; none => ErrNotLabOwner.
func (s *Service) ownedLabIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text FROM health_providers
		WHERE owner_user_id = $1 AND domain = 'LAB' AND provider_type = 'lab'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, ErrNotLabOwner
	}
	return ids, nil
}

// ProviderEarnings returns the owner's earnings. An unavailable ledger fails the
// read — a balance is never silently reported as zero.
func (s *Service) ProviderEarnings(ctx context.Context, userID string) (*Earnings, error) {
	labs, err := s.ownedLabIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	if s.earn == nil {
		return nil, ErrSharingUnavailable
	}
	available, err := s.earn.AvailableKobo(ctx, userID)
	if err != nil {
		return nil, err
	}

	// One pass over this owner's labs' escrow rows; each hold lands in exactly one bucket.
	var earned, pending, held int64
	err = s.db.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(h.amount_kobo) FILTER (WHERE h.state = 'RELEASED' AND h.payee_id = $2), 0)::bigint,
		  COALESCE(SUM(h.amount_kobo) FILTER (WHERE h.state = 'HELD'
		        AND o.state IN ('CREATED','SCHEDULED','SAMPLE_COLLECTED','IN_TRANSIT','ACCESSIONED','PROCESSING')), 0)::bigint,
		  COALESCE(SUM(h.amount_kobo) FILTER (WHERE h.state = 'DISPUTED'
		        OR (h.state = 'HELD' AND o.state IN ('RESULT_READY','ESCALATED'))), 0)::bigint
		FROM lab_orders o
		JOIN escrow_holds h ON h.id = o.escrow_id
		WHERE o.lab_provider_id = ANY($1::uuid[])`, labs, userID).Scan(&earned, &pending, &held)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT id::text, amount_kobo, status, created_at
		FROM bank_transfers WHERE user_id = $1
		ORDER BY created_at DESC LIMIT 20`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Earnings{AvailableKobo: available, EarnedKobo: earned, PendingKobo: pending, HeldKobo: held, Withdrawals: []Withdrawal{}}
	for rows.Next() {
		var w Withdrawal
		var status string
		if err := rows.Scan(&w.ID, &w.AmountKobo, &status, &w.At); err != nil {
			return nil, err
		}
		w.Status = withdrawalStatus(status)
		out.Withdrawals = append(out.Withdrawals, w)
	}
	return out, rows.Err()
}

// ProviderReviews returns reviews of the labs the caller owns, newest first.
func (s *Service) ProviderReviews(ctx context.Context, userID string) ([]Review, error) {
	labs, err := s.ownedLabIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.id, COALESCE(NULLIF(btrim(up.full_name),''), NULLIF(btrim(up.display_name),''), ''),
		       r.rating, r.body, r.created_at
		FROM lab_reviews r LEFT JOIN user_profiles up ON up.id = r.author_id
		WHERE r.lab_provider_id = ANY($1::uuid[])
		ORDER BY r.created_at DESC LIMIT 100`, labs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		var rv Review
		var full string
		var rating int16
		if err := rows.Scan(&rv.ID, &full, &rating, &rv.Body, &rv.CreatedAt); err != nil {
			return nil, err
		}
		rv.Rating, rv.Author = int(rating), shortAuthor(full)
		out = append(out, rv)
	}
	return out, rows.Err()
}
