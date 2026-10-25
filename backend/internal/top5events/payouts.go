package top5events

// Organiser payout / settlement rail (EVTC-D003, S1). Gated by
// FEATURE_EVENTS_ORGANISER_PAYOUTS (default off) — RegisterPayouts is only
// mounted when the flag is on.
//
// Ticket checkout (Purchase) parks every paid order's full total in the shared
// `escrow` standing account. This file disburses an event's eligible share of
// that escrow, mirroring the existing SettleVendor money legs and the
// restaurant payout-run state machine (restaurant/payout.go) rather than
// building a parallel payout stack:
//
//	net : DR escrow  -> CR organiser user_wallet   (ledger.Credit,  key evpayout:<id>:net)
//	fee : DR escrow  -> CR paymax_revenue          (ledger.PostJournal, key evpayout:<id>:fee)
//
// The organiser then withdraws to a bank through the shared finance/transfers
// rail (PIN, tier limits, provider webhooks, reversal on failure) — so a bank
// destination is never bound to a payout here and an in-flight payout cannot
// be redirected by a bank-account change.
//
// Eligibility (per event, payee = events.organiser_id):
//   - event state CLOSED (never CANCELLED/SUSPENDED/LIVE — a CLOSED event can no
//     longer be cancelled, so no post-payout cancel refund can drain escrow);
//   - now >= ends_at + HoldWindow;
//   - organiser KYC tier >= MinKYCTier (fail-closed on lookup error, NL-10).
//
// Amount (cumulative, recomputed under the event row lock):
//
//	G  = Σ total_kobo of PAID orders with no blocking dispute
//	F  = G * fee_bps / 10000                       (same truncation as SettleVendor / Cancel)
//	R  = (G - F) * ReserveBps / 10000  while now < ends_at + ReserveRelease, else 0
//	N  = G - F - R
//	this payout: fee = F - ΣF(prior non-failed), net = N - ΣN(prior non-failed)
//
// so a failed payout's amount is simply re-offered and a paid one is never
// re-offered. A payout is created PENDING by a maker (organiser or admin) and
// executed only when a DIFFERENT actor approves it (maker-checker):
//
//	pending -> processing -> paid | failed ;  pending -> failed (rejected)
//
// Exactly-once: one in-flight payout per event (partial unique index), the
// execution holds the payout row lock across both ledger legs, and the legs'
// idempotency keys derive from the payout id, so a concurrent or repeated
// approve / reconcile replays instead of double-paying. A payout is only marked
// failed when the ledger of record shows NEITHER leg posted; a partially posted
// payout stays processing and is re-driven by ReconcileOrganiserPayouts.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/finance/ledger"
)

// PayoutStatus is the organiser payout lifecycle.
type PayoutStatus string

const (
	PayoutPending    PayoutStatus = "pending"
	PayoutProcessing PayoutStatus = "processing"
	PayoutPaid       PayoutStatus = "paid"
	PayoutFailed     PayoutStatus = "failed"
)

var payoutMoves = fsm.Table[PayoutStatus]{
	PayoutPending:    fsm.Set(PayoutProcessing, PayoutFailed),
	PayoutProcessing: fsm.Set(PayoutPaid, PayoutFailed),
}

// PayoutPolicy is the ops-tunable settlement policy (wired from config).
type PayoutPolicy struct {
	HoldWindow     time.Duration // after ends_at before any payout
	ReserveBps     int           // share of post-fee earnings held back
	ReserveRelease time.Duration // after ends_at, when the reserve is released
	MinKYCTier     int           // organiser KYC tier required to be paid
}

// DefaultPayoutPolicy: 72h hold, 5% reserve released 30 days after the event,
// KYC tier 1 (the same NL-10 bar SettleVendor applies to vendors).
func DefaultPayoutPolicy() PayoutPolicy {
	return PayoutPolicy{HoldWindow: 72 * time.Hour, ReserveBps: 500, ReserveRelease: 30 * 24 * time.Hour, MinKYCTier: 1}
}

// payoutConfig is the Service's payout state (policy + test-only fault seam).
type payoutConfig struct {
	policy   *PayoutPolicy
	legFault func(leg string) error // nil in production; see export_test.go
	nowFn    func() time.Time
}

// SetPayoutPolicy injects the settlement policy (app wiring, post-construction).
func (s *Service) SetPayoutPolicy(p PayoutPolicy) { s.payouts.policy = &p }

func (s *Service) payoutPolicy() PayoutPolicy {
	if s.payouts.policy == nil {
		return DefaultPayoutPolicy()
	}
	return *s.payouts.policy
}

func (s *Service) now() time.Time {
	if s.payouts.nowFn != nil {
		return s.payouts.nowFn()
	}
	return time.Now()
}

// Payout sentinel errors.
var (
	ErrPayoutNotEligible = errors.New("events: event is not yet eligible for payout")
	ErrPayoutNothingDue  = errors.New("events: nothing is due to the organiser")
	ErrPayoutInFlight    = errors.New("events: a payout for this event is already pending or processing")
	ErrPayoutSameActor   = errors.New("events: a different user must approve this payout (maker-checker)")
	ErrPayoutNotPayable  = errors.New("events: payout is not pending")
	ErrPayoutLegFailed   = errors.New("events: payout transfer failed")
	ErrPayoutIdemReuse   = errors.New("events: Idempotency-Key already used for a different payout")
	ErrIdempotencyKey    = errors.New("events: Idempotency-Key header required")
)

// PayoutAmounts is one payout's money breakdown (kobo).
type PayoutAmounts struct {
	GrossKobo       int64 `json:"gross_kobo"`        // incremental eligible gross covered by this payout
	FeeKobo         int64 `json:"fee_kobo"`          // platform fee collected by this payout
	NetKobo         int64 `json:"net_kobo"`          // paid to the organiser by this payout
	ReserveHeldKobo int64 `json:"reserve_held_kobo"` // reserve still held for the event after this payout
}

// OrganiserPayout mirrors a row of public.event_organiser_payouts.
type OrganiserPayout struct {
	PayoutAmounts

	ID              string       `json:"id"`
	EventID         string       `json:"event_id"`
	OrganiserID     string       `json:"organiser_id"`
	Status          PayoutStatus `json:"status"`
	FeeBps          int          `json:"fee_bps"`
	ReserveBps      int          `json:"reserve_bps"`
	RefundsKobo     int64        `json:"refunds_kobo"`
	DisputedKobo    int64        `json:"disputed_kobo"`
	Destination     string       `json:"destination"`
	IdempotencyKey  string       `json:"idempotency_key"`
	RequestedBy     string       `json:"requested_by"`
	ApprovedBy      *string      `json:"approved_by,omitempty"`
	FailureReason   string       `json:"failure_reason,omitempty"`
	LedgerReference *string      `json:"ledger_reference,omitempty"`
	CreatedAt       time.Time    `json:"created_at"`
	ProcessingAt    *time.Time   `json:"processing_at,omitempty"`
	PaidAt          *time.Time   `json:"paid_at,omitempty"`
	FailedAt        *time.Time   `json:"failed_at,omitempty"`
}

// payoutTotals sums the non-failed payouts already made for an event.
type payoutTotals struct {
	GrossKobo, FeeKobo, NetKobo int64
}

// computePayout applies the cumulative formula (see file header). Pure.
func computePayout(eligibleGross int64, feeBps, reserveBps int, reserveActive bool, prior payoutTotals) (PayoutAmounts, error) {
	if feeBps < 0 || feeBps > 10000 || reserveBps < 0 || reserveBps > 10000 {
		return PayoutAmounts{}, fmt.Errorf("%w: fee_bps/reserve_bps out of range", ErrValidation)
	}
	if eligibleGross < 0 {
		return PayoutAmounts{}, fmt.Errorf("%w: negative eligible gross", ErrValidation)
	}
	fee := eligibleGross * int64(feeBps) / 10000
	var reserve int64
	if reserveActive {
		reserve = (eligibleGross - fee) * int64(reserveBps) / 10000
	}
	netTotal := eligibleGross - fee - reserve
	out := PayoutAmounts{
		GrossKobo:       eligibleGross - prior.GrossKobo,
		FeeKobo:         fee - prior.FeeKobo,
		NetKobo:         netTotal - prior.NetKobo,
		ReserveHeldKobo: reserve,
	}
	// Never post a negative leg: a shrunk eligible base after an earlier payout
	// is an organiser shortfall surfaced on the statement, not a payout.
	if out.GrossKobo < 0 || out.FeeKobo < 0 || out.NetKobo < 0 || out.FeeKobo+out.NetKobo == 0 {
		return PayoutAmounts{}, ErrPayoutNothingDue
	}
	return out, nil
}

// PayoutEligibility is the time/state gate for one event.
type PayoutEligibility struct {
	Eligible         bool      `json:"eligible"`
	Reason           string    `json:"reason,omitempty"` // event_not_closed | hold_window
	EligibleAt       time.Time `json:"eligible_at"`
	ReserveActive    bool      `json:"reserve_active"`
	ReserveReleaseAt time.Time `json:"reserve_release_at"`
}

func payoutEligibility(state EventState, endsAt, now time.Time, p PayoutPolicy) PayoutEligibility {
	e := PayoutEligibility{
		EligibleAt:       endsAt.Add(p.HoldWindow),
		ReserveReleaseAt: endsAt.Add(p.ReserveRelease),
	}
	e.ReserveActive = now.Before(e.ReserveReleaseAt)
	switch {
	case state != EventClosed:
		e.Reason = "event_not_closed"
	case now.Before(e.EligibleAt):
		e.Reason = "hold_window"
	default:
		e.Eligible = true
	}
	return e
}

// blockingDisputeSQL matches an order held back by an events dispute that is
// still open, or that was resolved in the buyer's favour (money owed back to
// the buyer must never be paid to the organiser).
const blockingDisputeSQL = `EXISTS (
	SELECT 1 FROM disputes d
	 WHERE d.module_type IN ('events','event','tickets','event_tickets')
	   AND d.reference IN (o.id::text, 'order:' || o.id::text, 'event_order:' || o.id::text)
	   AND (d.status IN ('open','in_review','investigating')
	        OR d.resolution IN ('refund','partial_refund','refunded')))`

// eventProceeds is the per-event sales breakdown from event_orders.
type eventProceeds struct {
	grossSales, refunds, disputed, eligible int64
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func loadProceeds(ctx context.Context, q querier, eventID string) (eventProceeds, error) {
	var p eventProceeds
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(o.total_kobo) FILTER (WHERE o.status IN ('PAID','REFUNDED')), 0),
		       COALESCE(SUM(o.total_kobo) FILTER (WHERE o.status = 'REFUNDED'), 0),
		       COALESCE(SUM(o.total_kobo) FILTER (WHERE o.status = 'PAID' AND `+blockingDisputeSQL+`), 0),
		       COALESCE(SUM(o.total_kobo) FILTER (WHERE o.status = 'PAID' AND NOT `+blockingDisputeSQL+`), 0)
		  FROM event_orders o WHERE o.event_id = $1`, eventID).
		Scan(&p.grossSales, &p.refunds, &p.disputed, &p.eligible)
	if err != nil {
		return p, fmt.Errorf("events: payout proceeds: %w", err)
	}
	return p, nil
}

// payoutSums returns Σ over the event's payouts: paid, and in-flight (pending/processing).
type payoutSums struct {
	paid, inflight payoutTotals
}

func (t payoutSums) committed() payoutTotals {
	return payoutTotals{
		GrossKobo: t.paid.GrossKobo + t.inflight.GrossKobo,
		FeeKobo:   t.paid.FeeKobo + t.inflight.FeeKobo,
		NetKobo:   t.paid.NetKobo + t.inflight.NetKobo,
	}
}

func loadPayoutSums(ctx context.Context, q querier, eventID string) (payoutSums, error) {
	var t payoutSums
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(gross_kobo) FILTER (WHERE status='paid'),0),
		       COALESCE(SUM(fee_kobo)   FILTER (WHERE status='paid'),0),
		       COALESCE(SUM(net_kobo)   FILTER (WHERE status='paid'),0),
		       COALESCE(SUM(gross_kobo) FILTER (WHERE status IN ('pending','processing')),0),
		       COALESCE(SUM(fee_kobo)   FILTER (WHERE status IN ('pending','processing')),0),
		       COALESCE(SUM(net_kobo)   FILTER (WHERE status IN ('pending','processing')),0)
		  FROM event_organiser_payouts WHERE event_id=$1`, eventID).
		Scan(&t.paid.GrossKobo, &t.paid.FeeKobo, &t.paid.NetKobo, &t.inflight.GrossKobo, &t.inflight.FeeKobo, &t.inflight.NetKobo)
	if err != nil {
		return t, fmt.Errorf("events: payout sums: %w", err)
	}
	return t, nil
}

// requireOrganiserKYC is the NL-10 payout gate. Fail-closed: a tier lookup
// error refuses the payout. Denials are audited.
func (s *Service) requireOrganiserKYC(ctx context.Context, actorID, organiserID, eventID string) error {
	tier, err := s.tiers.GetUserTier(ctx, organiserID)
	if err != nil {
		return fmt.Errorf("events: organiser kyc check (fail closed): %w", err)
	}
	if int(tier) < s.payoutPolicy().MinKYCTier {
		s.logPayout(actorID, organiserID, "events.payout.denied", eventID, map[string]any{keyReason: "kyc_required", keyTier: int(tier)}, "warning")
		return ErrKYCRequired
	}
	return nil
}

const payoutCols = `id, event_id, organiser_id, status, gross_kobo, fee_kobo, net_kobo, reserve_held_kobo,
	fee_bps, reserve_bps, refunds_kobo, disputed_kobo, destination, idempotency_key, requested_by,
	approved_by::text, COALESCE(failure_reason,''), ledger_reference, created_at, processing_at, paid_at, failed_at`

func scanPayout(row pgx.Row) (*OrganiserPayout, error) {
	var p OrganiserPayout
	var status string
	if err := row.Scan(&p.ID, &p.EventID, &p.OrganiserID, &status, &p.GrossKobo, &p.FeeKobo, &p.NetKobo,
		&p.ReserveHeldKobo, &p.FeeBps, &p.ReserveBps, &p.RefundsKobo, &p.DisputedKobo, &p.Destination,
		&p.IdempotencyKey, &p.RequestedBy, &p.ApprovedBy, &p.FailureReason, &p.LedgerReference,
		&p.CreatedAt, &p.ProcessingAt, &p.PaidAt, &p.FailedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.Status = PayoutStatus(status)
	return &p, nil
}

func (s *Service) payoutByID(ctx context.Context, q querier, id string) (*OrganiserPayout, error) {
	return scanPayout(q.QueryRow(ctx, `SELECT `+payoutCols+` FROM event_organiser_payouts WHERE id::text=$1`, id))
}

// RequestOrganiserPayout creates (maker side) a PENDING payout for the event's
// currently payable amount. asAdmin=false requires the caller to own the event.
// Idempotent on idemKey: a replay returns the same payout object.
//
//nolint:gocognit // money-path gate sequence is deliberately one linear chain
func (s *Service) RequestOrganiserPayout(ctx context.Context, actorID, eventID, idemKey string, asAdmin bool) (*OrganiserPayout, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyKey
	}
	if existing, err := scanPayout(s.db.QueryRow(ctx, `SELECT `+payoutCols+` FROM event_organiser_payouts WHERE idempotency_key=$1`, idemKey)); err == nil {
		if existing.EventID != eventID {
			return nil, ErrPayoutIdemReuse
		}
		if !asAdmin && existing.OrganiserID != actorID {
			return nil, ErrForbidden
		}
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("events: payout idem lookup: %w", err)
	}

	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if !asAdmin && ev.OrganiserID != actorID {
		return nil, ErrForbidden
	}
	if err := s.requireOrganiserKYC(ctx, actorID, ev.OrganiserID, eventID); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: payout begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Serialise every payout decision for this event behind the event row lock.
	var organiserID, state string
	var endsAt time.Time
	var feeBps int
	if err := tx.QueryRow(ctx, `SELECT organiser_id::text, state, ends_at, fee_bps FROM events WHERE id=$1 FOR UPDATE`, eventID).
		Scan(&organiserID, &state, &endsAt, &feeBps); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: payout lock event: %w", err)
	}
	pol := s.payoutPolicy()
	elig := payoutEligibility(EventState(state), endsAt, s.now(), pol)
	if !elig.Eligible {
		return nil, fmt.Errorf("%w (%s, eligible_at %s)", ErrPayoutNotEligible, elig.Reason, elig.EligibleAt.Format(time.RFC3339))
	}
	sums, err := loadPayoutSums(ctx, tx, eventID)
	if err != nil {
		return nil, err
	}
	if sums.inflight.FeeKobo+sums.inflight.NetKobo > 0 {
		return nil, ErrPayoutInFlight
	}
	proc, err := loadProceeds(ctx, tx, eventID)
	if err != nil {
		return nil, err
	}
	amt, err := computePayout(proc.eligible, feeBps, pol.ReserveBps, elig.ReserveActive, sums.paid)
	if err != nil {
		return nil, err
	}

	p, err := scanPayout(tx.QueryRow(ctx, `
		INSERT INTO event_organiser_payouts
			(event_id, organiser_id, status, gross_kobo, fee_bps, fee_kobo, net_kobo, reserve_held_kobo,
			 reserve_bps, refunds_kobo, disputed_kobo, idempotency_key, requested_by)
		VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING `+payoutCols,
		eventID, organiserID, amt.GrossKobo, feeBps, amt.FeeKobo, amt.NetKobo, amt.ReserveHeldKobo,
		pol.ReserveBps, proc.refunds, proc.disputed, idemKey, actorID))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if strings.Contains(pgErr.ConstraintName, "inflight") {
				return nil, ErrPayoutInFlight
			}
			_ = tx.Rollback(ctx)
			return s.RequestOrganiserPayout(ctx, actorID, eventID, idemKey, asAdmin) // lost an idem race: replay
		}
		return nil, fmt.Errorf("events: insert payout: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrPayoutInFlight
		}
		return nil, fmt.Errorf("events: commit payout: %w", err)
	}
	s.logPayout(actorID, organiserID, "events.payout.request", p.ID, map[string]any{
		keyEvent: eventID, "gross": p.GrossKobo, keyFee: p.FeeKobo, keyNet: p.NetKobo, "reserve_held": p.ReserveHeldKobo,
	}, "info")
	return p, nil
}

// ApproveOrganiserPayout is the checker side: a user other than the requester
// approves a PENDING payout, which moves it to processing and executes the
// ledger legs. Re-approving a processing payout re-drives it; a paid payout
// is returned unchanged (idempotent). idemKey is the approval's own key.
func (s *Service) ApproveOrganiserPayout(ctx context.Context, approverID, payoutID, idemKey string) (*OrganiserPayout, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyKey
	}
	p, err := s.payoutByID(ctx, s.db, payoutID)
	if err != nil {
		return nil, err
	}
	switch p.Status {
	case PayoutPaid:
		return p, nil
	case PayoutFailed:
		return nil, ErrPayoutNotPayable
	case PayoutProcessing:
		// Already approved by a checker: re-drive it (below) instead of
		// refusing. executePayout serialises on the row lock and its legs are
		// idempotent, so a concurrent approver that lost the pending→processing
		// claim waits for the winner and returns the paid payout.
	case PayoutPending:
		if p.RequestedBy == approverID {
			return nil, ErrPayoutSameActor
		}
		// Re-check the payee gate at execution time (KYC may have been revoked).
		if err := s.requireOrganiserKYC(ctx, approverID, p.OrganiserID, p.EventID); err != nil {
			return nil, err
		}
		if !payoutMoves.Can(PayoutPending, PayoutProcessing) {
			return nil, ErrPayoutNotPayable
		}
		tag, err := s.db.Exec(ctx, `
			UPDATE event_organiser_payouts
			   SET status='processing', approved_by=$2, approval_idempotency_key=$3, processing_at=now()
			 WHERE id=$1 AND status='pending'`, p.ID, approverID, idemKey)
		if err != nil {
			return nil, fmt.Errorf("events: claim payout: %w", err)
		}
		if tag.RowsAffected() == 1 {
			s.logPayout(approverID, p.OrganiserID, "events.payout.approve", p.ID, map[string]any{keyEvent: p.EventID, keyNet: p.NetKobo}, "info")
		}
	}
	return s.executePayout(ctx, p.ID)
}

// RejectOrganiserPayout fails a PENDING payout without moving money (checker
// rejection). Its amount is re-offered to the next request.
func (s *Service) RejectOrganiserPayout(ctx context.Context, actorID, payoutID, reason string) (*OrganiserPayout, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, fmt.Errorf("%w: reason required", ErrValidation)
	}
	if !payoutMoves.Can(PayoutPending, PayoutFailed) {
		return nil, ErrPayoutNotPayable
	}
	p, err := scanPayout(s.db.QueryRow(ctx, `
		UPDATE event_organiser_payouts
		   SET status='failed', failure_reason=$2, failed_at=now(), approved_by=$3
		 WHERE id::text=$1 AND status='pending'
		RETURNING `+payoutCols, payoutID, "rejected: "+reason, actorID))
	if errors.Is(err, ErrNotFound) {
		if _, gerr := s.payoutByID(ctx, s.db, payoutID); gerr != nil {
			return nil, gerr
		}
		return nil, ErrPayoutNotPayable
	}
	if err != nil {
		return nil, fmt.Errorf("events: reject payout: %w", err)
	}
	s.logPayout(actorID, p.OrganiserID, "events.payout.reject", p.ID, map[string]any{keyEvent: p.EventID, keyReason: reason}, "warning")
	return p, nil
}

// payoutLockAttempts × payoutLockBackoff bounds how long a re-driver waits for
// a peer that holds the payout row lock (~5s) before reporting it in flight.
const (
	payoutLockAttempts = 50
	payoutLockBackoff  = 100 * time.Millisecond
)

// lockPayoutForExec opens a tx holding the payout's row lock. It takes the lock
// with NOWAIT and backs off with the connection released, never blocking on
// it: the lock holder's ledger legs need further pool connections
// (postPayoutLegs goes through s.led), so N waiters each parked on a pooled
// connection inside FOR UPDATE would starve it and deadlock the pool (seen on
// 4-connection CI pools with 8 concurrent approvers). When the peer still
// holds the lock after the last attempt, it returns the current row with
// ErrPayoutInFlight.
func (s *Service) lockPayoutForExec(ctx context.Context, payoutID string) (pgx.Tx, *OrganiserPayout, error) {
	for attempt := 1; ; attempt++ {
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("events: payout exec begin: %w", err)
		}
		p, err := scanPayout(tx.QueryRow(ctx, `SELECT `+payoutCols+` FROM event_organiser_payouts WHERE id::text=$1 FOR UPDATE NOWAIT`, payoutID))
		if err == nil {
			return tx, p, nil
		}
		_ = tx.Rollback(ctx)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "55P03" { // lock_not_available
			return nil, nil, err
		}
		if attempt >= payoutLockAttempts {
			cur, gerr := s.payoutByID(ctx, s.db, payoutID)
			if gerr != nil {
				return nil, nil, gerr
			}
			return nil, cur, ErrPayoutInFlight
		}
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(payoutLockBackoff):
		}
	}
}

// executePayout posts the legs of a PROCESSING payout under its row lock and
// finalises it paid, or failed when the ledger shows no leg posted.
func (s *Service) executePayout(ctx context.Context, payoutID string) (*OrganiserPayout, error) {
	tx, p, err := s.lockPayoutForExec(ctx, payoutID)
	if err != nil {
		return p, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if p.Status != PayoutProcessing {
		// A concurrent driver finished it while we waited for the lock.
		_ = tx.Commit(ctx)
		if p.Status == PayoutFailed {
			return p, ErrPayoutNotPayable
		}
		return p, nil
	}

	legErr := s.postPayoutLegs(ctx, p)
	if legErr != nil {
		netKey, feeKey := payoutLegKeys(p.ID)
		netPosted, err1 := s.led.Posted(ctx, netKey)
		feePosted, err2 := s.led.Posted(ctx, feeKey)
		if err1 != nil || err2 != nil || netPosted || feePosted || !payoutMoves.Can(PayoutProcessing, PayoutFailed) {
			// Money may have partly moved (or we cannot prove it did not):
			// stay processing; ReconcileOrganiserPayouts / a re-approve re-drives.
			return p, fmt.Errorf("events: payout %s partially applied, will re-drive: %w", p.ID, legErr)
		}
		failed, err := scanPayout(tx.QueryRow(ctx, `
			UPDATE event_organiser_payouts SET status='failed', failure_reason=$2, failed_at=now()
			 WHERE id=$1 AND status='processing' RETURNING `+payoutCols, p.ID, truncate(legErr.Error(), 500)))
		if err != nil {
			return p, fmt.Errorf("events: mark payout failed: %w (cause %s)", err, legErr.Error())
		}
		if err := tx.Commit(ctx); err != nil {
			return p, fmt.Errorf("events: commit payout failure: %w", err)
		}
		s.logPayout("", failed.OrganiserID, "events.payout.failed", failed.ID, map[string]any{keyEvent: failed.EventID, keyNet: failed.NetKobo, keyReason: failed.FailureReason}, "error")
		return failed, fmt.Errorf("%w: %s", ErrPayoutLegFailed, legErr.Error())
	}

	if !payoutMoves.Can(PayoutProcessing, PayoutPaid) {
		return p, ErrPayoutNotPayable
	}
	paid, err := scanPayout(tx.QueryRow(ctx, `
		UPDATE event_organiser_payouts SET status='paid', paid_at=now(), ledger_reference=$2
		 WHERE id=$1 AND status='processing' RETURNING `+payoutCols, p.ID, "evpayout:"+p.ID))
	if err != nil {
		return p, fmt.Errorf("events: finalise payout: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return p, fmt.Errorf("events: commit payout: %w", err)
	}
	s.logPayout("", paid.OrganiserID, "events.payout.paid", paid.ID, map[string]any{
		keyEvent: paid.EventID, keyNet: paid.NetKobo, keyFee: paid.FeeKobo, "ledger_ref": "evpayout:" + paid.ID,
	}, "info")
	return paid, nil
}

func payoutLegKeys(id string) (string, string) {
	return "evpayout:" + id + ":net", "evpayout:" + id + ":fee"
}

// postPayoutLegs posts the two idempotent ledger legs (see file header).
func (s *Service) postPayoutLegs(ctx context.Context, p *OrganiserPayout) error {
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	netKey, feeKey := payoutLegKeys(p.ID)
	ref := "evpayout:" + p.ID
	if p.NetKobo > 0 {
		if err := s.payoutFault("net"); err != nil {
			return err
		}
		if err := s.led.Credit(ctx, p.OrganiserID, ref, netKey, escrowAcc.ID, p.NetKobo); !alreadyApplied(err) {
			return fmt.Errorf("events: payout net leg: %w", err)
		}
	}
	if p.FeeKobo > 0 {
		if err := s.payoutFault("fee"); err != nil {
			return err
		}
		revAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			return err
		}
		if err := s.led.PostJournal(ctx, ledger.JournalEntry{
			Reference: ref, IdempotencyKey: feeKey, AmountKobo: p.FeeKobo,
			DebitAccountID: escrowAcc.ID, CreditAccountID: revAcc.ID,
			Description: "event ticket platform fee",
		}); !alreadyApplied(err) {
			return fmt.Errorf("events: payout fee leg: %w", err)
		}
	}
	return nil
}

func (s *Service) payoutFault(leg string) error {
	if s.payouts.legFault == nil {
		return nil
	}
	return s.payouts.legFault(leg)
}

func truncate(v string, n int) string {
	if len(v) <= n {
		return v
	}
	return v[:n]
}

// ReconcileOrganiserPayouts re-drives PROCESSING payouts older than olderThan
// (a crash or transient error between the legs and the paid flip). Safe to run
// on every instance: execution is row-locked and the legs are idempotent.
func (s *Service) ReconcileOrganiserPayouts(ctx context.Context, olderThan time.Duration) (int, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text FROM event_organiser_payouts WHERE status='processing' AND processing_at <= $1`, s.now().Add(-olderThan))
	if err != nil {
		return 0, fmt.Errorf("events: payout reconcile list: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	done := 0
	for _, id := range ids {
		if p, err := s.executePayout(ctx, id); err == nil && p.Status == PayoutPaid {
			done++
		}
	}
	return done, rows.Err()
}

// PayoutStatement is the organiser's per-event earnings statement. Identities:
//
//	NetEarnings   = Paid + Pending + Balance   (Balance < 0 means the organiser owes)
//	EligibleGross = Fees + Reserve + NetEarnings
//	GrossSales    = Refunds + DisputedHeld + EligibleGross
type PayoutStatement struct {
	PayoutEligibility // eligible / reason / eligible_at / reserve window

	EventID           string            `json:"event_id"`
	EventTitle        string            `json:"event_title"`
	EventState        EventState        `json:"event_state"`
	EndsAt            time.Time         `json:"ends_at"`
	OrganiserID       string            `json:"organiser_id"`
	FeeBps            int               `json:"fee_bps"`
	ReserveBps        int               `json:"reserve_bps"`
	GrossSalesKobo    int64             `json:"gross_sales_kobo"`
	RefundsKobo       int64             `json:"refunds_kobo"`
	DisputedHeldKobo  int64             `json:"disputed_held_kobo"`
	EligibleGrossKobo int64             `json:"eligible_gross_kobo"`
	FeesKobo          int64             `json:"fees_kobo"`
	ReserveKobo       int64             `json:"reserve_kobo"`
	NetEarningsKobo   int64             `json:"net_earnings_kobo"`
	PaidKobo          int64             `json:"paid_kobo"`
	FeesCollectedKobo int64             `json:"fees_collected_kobo"`
	PendingKobo       int64             `json:"pending_kobo"`
	BalanceKobo       int64             `json:"balance_kobo"`
	AvailableKobo     int64             `json:"available_kobo"`
	Payouts           []OrganiserPayout `json:"payouts"`
}

func (s *Service) buildStatement(ctx context.Context, ev *Event) (*PayoutStatement, error) {
	pol := s.payoutPolicy()
	elig := payoutEligibility(ev.State, ev.EndsAt, s.now(), pol)
	proc, err := loadProceeds(ctx, s.db, ev.ID)
	if err != nil {
		return nil, err
	}
	sums, err := loadPayoutSums(ctx, s.db, ev.ID)
	if err != nil {
		return nil, err
	}
	fee := proc.eligible * int64(ev.FeeBps) / 10000
	var reserve int64
	if elig.ReserveActive {
		reserve = (proc.eligible - fee) * int64(pol.ReserveBps) / 10000
	}
	st := &PayoutStatement{
		EventID: ev.ID, EventTitle: ev.Title, EventState: ev.State, EndsAt: ev.EndsAt, OrganiserID: ev.OrganiserID,
		FeeBps: ev.FeeBps, ReserveBps: pol.ReserveBps,
		GrossSalesKobo: proc.grossSales, RefundsKobo: proc.refunds, DisputedHeldKobo: proc.disputed,
		EligibleGrossKobo: proc.eligible, FeesKobo: fee, ReserveKobo: reserve,
		NetEarningsKobo:   proc.eligible - fee - reserve,
		PaidKobo:          sums.paid.NetKobo,
		FeesCollectedKobo: sums.paid.FeeKobo,
		PendingKobo:       sums.inflight.NetKobo,
		PayoutEligibility: elig,
		Payouts:           []OrganiserPayout{},
	}
	st.BalanceKobo = st.NetEarningsKobo - st.PaidKobo - st.PendingKobo
	if elig.Eligible && sums.inflight.FeeKobo+sums.inflight.NetKobo == 0 {
		if amt, err := computePayout(proc.eligible, ev.FeeBps, pol.ReserveBps, elig.ReserveActive, sums.committed()); err == nil {
			st.AvailableKobo = amt.NetKobo
		}
	}
	rows, err := s.db.Query(ctx, `SELECT `+payoutCols+` FROM event_organiser_payouts WHERE event_id=$1 ORDER BY created_at DESC`, ev.ID)
	if err != nil {
		return nil, fmt.Errorf("events: statement payouts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		st.Payouts = append(st.Payouts, *p)
	}
	return st, rows.Err()
}

// OrganiserPayoutStatement returns the statement for an event the caller owns.
func (s *Service) OrganiserPayoutStatement(ctx context.Context, callerID, eventID string) (*PayoutStatement, error) {
	if err := s.assertOwner(ctx, eventID, callerID); err != nil {
		return nil, err
	}
	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	return s.buildStatement(ctx, ev)
}

// AdminPayoutStatement returns any event's statement (RBAC-gated at the route).
func (s *Service) AdminPayoutStatement(ctx context.Context, eventID string) (*PayoutStatement, error) {
	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	return s.buildStatement(ctx, ev)
}

// GetOrganiserPayout returns a payout only to its payee; any other caller gets
// ErrNotFound (no existence or amount disclosure).
func (s *Service) GetOrganiserPayout(ctx context.Context, callerID, payoutID string) (*OrganiserPayout, error) {
	p, err := s.payoutByID(ctx, s.db, payoutID)
	if err != nil {
		return nil, err
	}
	if p.OrganiserID != callerID {
		return nil, ErrNotFound
	}
	return p, nil
}

func (s *Service) listPayouts(ctx context.Context, where string, args ...any) ([]OrganiserPayout, error) {
	rows, err := s.db.Query(ctx, `SELECT `+payoutCols+` FROM event_organiser_payouts `+where+` ORDER BY created_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, fmt.Errorf("events: list payouts: %w", err)
	}
	defer rows.Close()
	out := []OrganiserPayout{}
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ListMyOrganiserPayouts lists the caller's own payouts across events.
func (s *Service) ListMyOrganiserPayouts(ctx context.Context, callerID string) ([]OrganiserPayout, error) {
	return s.listPayouts(ctx, `WHERE organiser_id::text=$1`, callerID)
}

// AdminListPayouts lists payouts, optionally by status.
func (s *Service) AdminListPayouts(ctx context.Context, status string) ([]OrganiserPayout, error) {
	if status == "" {
		return s.listPayouts(ctx, ``)
	}
	switch PayoutStatus(status) {
	case PayoutPending, PayoutProcessing, PayoutPaid, PayoutFailed:
	default:
		return nil, fmt.Errorf("%w: unknown status", ErrValidation)
	}
	return s.listPayouts(ctx, `WHERE status=$1`, status)
}

// AdminPayoutQueueLine is one CLOSED event's settlement position.
type AdminPayoutQueueLine struct {
	EventID       string     `json:"event_id"`
	EventTitle    string     `json:"event_title"`
	OrganiserID   string     `json:"organiser_id"`
	EndsAt        time.Time  `json:"ends_at"`
	Eligible      bool       `json:"eligible"`
	Reason        string     `json:"reason,omitempty"`
	EligibleAt    time.Time  `json:"eligible_at"`
	AvailableKobo int64      `json:"available_kobo"`
	PendingKobo   int64      `json:"pending_kobo"`
	PaidKobo      int64      `json:"paid_kobo"`
	ReserveKobo   int64      `json:"reserve_kobo"`
	InFlightID    *string    `json:"in_flight_payout_id,omitempty"`
	LastPayoutAt  *time.Time `json:"last_payout_at,omitempty"`
}

// AdminPayoutQueue lists CLOSED events (most recently ended first) with their
// payable / pending / paid positions — the admin settlement queue.
func (s *Service) AdminPayoutQueue(ctx context.Context) ([]AdminPayoutQueueLine, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text FROM events WHERE state='CLOSED' ORDER BY ends_at DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("events: payout queue: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]AdminPayoutQueueLine, 0, len(ids))
	for _, id := range ids {
		st, err := s.AdminPayoutStatement(ctx, id)
		if err != nil {
			return nil, err
		}
		l := AdminPayoutQueueLine{
			EventID: st.EventID, EventTitle: st.EventTitle, OrganiserID: st.OrganiserID, EndsAt: st.EndsAt,
			Eligible: st.Eligible, Reason: st.Reason, EligibleAt: st.EligibleAt,
			AvailableKobo: st.AvailableKobo, PendingKobo: st.PendingKobo, PaidKobo: st.PaidKobo, ReserveKobo: st.ReserveKobo,
		}
		for i := range st.Payouts {
			p := st.Payouts[i]
			if l.LastPayoutAt == nil {
				l.LastPayoutAt = &p.CreatedAt
			}
			if p.Status == PayoutPending || p.Status == PayoutProcessing {
				l.InFlightID = &p.ID
			}
		}
		out = append(out, l)
	}
	return out, nil
}

// StartPayoutReconciler starts a background ticker re-driving PROCESSING
// payouts older than olderThan — the crash window between posting the ledger
// legs and flipping the row paid (see executePayout). Wired from RegisterEvents
// under FeatureEventsOrganiserPayouts; mirrors StartPendingOrderReconciler.
// Multi-instance safe: execution holds the payout row lock and both legs are
// keyed on the payout id, so overlapping sweeps replay rather than double-pay.
func StartPayoutReconciler(ctx context.Context, svc *Service, interval, olderThan time.Duration) {
	if svc == nil || svc.db == nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if olderThan <= 0 {
		olderThan = 10 * time.Minute
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		if n, err := svc.ReconcileOrganiserPayouts(cctx, olderThan); err != nil {
			log.Printf("[top5events] organiser payout sweep error: %v", err)
		} else if n > 0 {
			log.Printf("[top5events] organiser payout sweep: redriven=%d", n)
		}
	}
	go func() {
		run()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
	log.Printf("[top5events] organiser payout reconciler started (interval %s, stuck %s)", interval, olderThan)
}

func (s *Service) logPayout(actor, organiser, action, id string, meta map[string]any, severity string) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, organiser, action, "events", "event_payout", id, nil, meta, "", "", severity)
}
