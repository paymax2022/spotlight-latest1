package restaurant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
)

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant / rider payout-run DISBURSEMENT subsystem.
//
// This replaces the read-only settlement-projection view (see admin_repo.go
// AdminPayoutRuns) with a real, auditable money path. A payout run aggregates
// settled-but-unpaid `settlements` for ONE provider (a restaurant owner or a
// rider) in ONE period into a draft run + append-only lines, then ProcessRun
// posts ONE balanced ledger transfer (DR settlement standing account, CR provider
// wallet) keyed on the run's idempotency_key and flips the run
// draft -> processing -> paid under a status guard.
//
// Iron rules honoured (root CLAUDE.md "Money handling"):
//   - amounts are integer minor units (kobo) — BIGINT, never float/string math;
//   - the disbursement mutation requires an Idempotency-Key and posts a balanced
//     double-entry ONLY through the ledger service (no shadow ledger);
//   - the run is a guarded state machine (draft->processing->paid|failed); a
//     duplicate ProcessRun is a safe no-op via the ledger idempotency key + the
//     status guard, so a provider is never double-paid;
//   - no direct balance mutation — the provider wallet balance is a projection of
//     the ledger entries this posts;
//   - every disbursement emits an audit event.
//
// Why the ledger transfer is DR settlement -> CR provider wallet: at delivery the
// order's escrow is released via settlement.Settle into a settlement/clearing
// posture; the payout run is the batched disbursement that credits the provider's
// spendable wallet. Each settlement can only ever back ONE payout line (unique
// index uq_restaurant_payout_lines_settlement), so it is disbursed exactly once.
// ─────────────────────────────────────────────────────────────────────────────

// Payout provider types.
const (
	PayoutProviderRestaurant = "restaurant"
	PayoutProviderRider      = "rider"
)

// Payout run statuses (mirror the CHECK constraint on restaurant_payout_runs).
const (
	PayoutStatusDraft      = "draft"
	PayoutStatusProcessing = "processing"
	PayoutStatusPaid       = "paid"
	PayoutStatusFailed     = "failed"
)

// Sentinel errors.
var (
	ErrPayoutMissingIdem = errors.New("restaurant: Idempotency-Key required to process a payout run")
	ErrPayoutRunNotFound = errors.New("restaurant: payout run not found")
	ErrPayoutBadProvider = errors.New("restaurant: provider_type must be 'restaurant' or 'rider'")
	ErrPayoutNothingDue  = errors.New("restaurant: no unpaid settlements for this provider/period")
)

// PayoutRun mirrors a row of public.restaurant_payout_runs.
type PayoutRun struct {
	ID              string     `json:"id"`
	PeriodKey       string     `json:"period_key"`
	ProviderType    string     `json:"provider_type"` // restaurant | rider
	ProviderID      string     `json:"provider_id"`
	GrossMinor      int64      `json:"gross_minor"`
	FeeMinor        int64      `json:"fee_minor"`
	NetMinor        int64      `json:"net_minor"`
	Status          string     `json:"status"` // draft|processing|paid|failed
	IdempotencyKey  string     `json:"idempotency_key"`
	LedgerReference *string    `json:"ledger_reference,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	ProcessedAt     *time.Time `json:"processed_at,omitempty"`
}

// PayoutLine mirrors a row of public.restaurant_payout_lines (append-only).
type PayoutLine struct {
	ID           string    `json:"id"`
	RunID        string    `json:"run_id"`
	OrderID      *string   `json:"order_id,omitempty"`
	SettlementID *string   `json:"settlement_id,omitempty"`
	AmountMinor  int64     `json:"amount_minor"`
	CreatedAt    time.Time `json:"created_at"`
}

// PayoutRunDetail is a run plus its append-only lines (GET /payouts/:id).
type PayoutRunDetail struct {
	PayoutRun
	Lines []PayoutLine `json:"lines"`
}

// unpaidSettlement is one settled-but-undisbursed settlement contributing to a run.
type unpaidSettlement struct {
	settlementID string
	orderID      string
	amountMinor  int64 // the provider's share (restaurant provider_kobo, or rider share)
	feeMinor     int64 // platform fee attributable to this settlement (restaurant runs only)
}

// BuildRun aggregates the settled-but-unpaid `settlements` for one provider in one
// period into a DRAFT run + append-only lines. It is IDEMPOTENT per
// (providerType, providerID, periodKey): a second call re-uses the existing draft
// (unique index uq_restaurant_payout_runs_provider_period) and only appends lines
// for settlements not already claimed (unique index
// uq_restaurant_payout_lines_settlement). net = gross - fees.
//
// periodKey is a caller-supplied bucket label (e.g. an ISO week "2026-W38"); it is
// used verbatim so BuildRun is deterministic and does not itself decide the
// period. Selection of unpaid settlements is by "settled and not yet on any payout
// line", so re-running for the same period after new settlements land simply
// extends the draft.
func (s *Service) BuildRun(ctx context.Context, periodKey, providerType, providerID string) (*PayoutRun, error) {
	if providerType != PayoutProviderRestaurant && providerType != PayoutProviderRider {
		return nil, ErrPayoutBadProvider
	}
	if s.ledger == nil {
		return nil, fmt.Errorf("restaurant: payout runs require a ledger (WithLedger not wired)")
	}

	items, err := s.loadUnpaidSettlements(ctx, providerType, providerID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: payout build begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Resolve (or create) the single draft run for this provider+period. The unique
	// (provider_type, provider_id, period_key) index makes this idempotent — a
	// prior BuildRun's draft is re-used. Only a DRAFT run may accept new lines; if
	// the run has already moved to processing/paid, we return it unchanged.
	idem := fmt.Sprintf("rpayout:%s:%s:%s", providerType, providerID, periodKey)
	var run PayoutRun
	const upsertRun = `
		INSERT INTO restaurant_payout_runs
			(period_key, provider_type, provider_id, status, idempotency_key)
		VALUES ($1,$2,$3,'draft',$4)
		ON CONFLICT (provider_type, provider_id, period_key) DO UPDATE
			SET period_key = EXCLUDED.period_key
		RETURNING id, period_key, provider_type, provider_id, gross_minor, fee_minor,
		          net_minor, status, idempotency_key, ledger_reference, created_at, processed_at`
	if err := tx.QueryRow(ctx, upsertRun, periodKey, providerType, providerID, idem).Scan(
		&run.ID, &run.PeriodKey, &run.ProviderType, &run.ProviderID, &run.GrossMinor,
		&run.FeeMinor, &run.NetMinor, &run.Status, &run.IdempotencyKey,
		&run.LedgerReference, &run.CreatedAt, &run.ProcessedAt,
	); err != nil {
		return nil, fmt.Errorf("restaurant: payout upsert run: %w", err)
	}

	// Only extend a run that is still a draft. A run already processing/paid is
	// frozen — returning it as-is keeps BuildRun a safe no-op.
	if run.Status != PayoutStatusDraft {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &run, nil
	}

	// Append each unpaid settlement as a line. ON CONFLICT DO NOTHING on the
	// (run_id, settlement_id) and (settlement_id) unique indexes makes the append
	// idempotent and prevents a settlement being disbursed by two runs.
	const insLine = `
		INSERT INTO restaurant_payout_lines (run_id, order_id, settlement_id, amount_minor)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT DO NOTHING`
	for _, it := range items {
		if it.amountMinor <= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, insLine, run.ID, it.orderID, it.settlementID, it.amountMinor); err != nil {
			return nil, fmt.Errorf("restaurant: payout append line: %w", err)
		}
	}

	// Recompute the run totals from the append-only lines (source of truth), plus
	// the platform fee attributable to the claimed settlements. net = gross - fees.
	const recompute = `
		UPDATE restaurant_payout_runs r
		SET net_minor   = COALESCE((SELECT sum(amount_minor) FROM restaurant_payout_lines WHERE run_id = r.id), 0),
		    fee_minor   = $2::bigint,
		    gross_minor = COALESCE((SELECT sum(amount_minor) FROM restaurant_payout_lines WHERE run_id = r.id), 0) + $2::bigint
		WHERE r.id = $1
		RETURNING gross_minor, fee_minor, net_minor`
	if err := tx.QueryRow(ctx, recompute, run.ID, totalFee(items)).Scan(
		&run.GrossMinor, &run.FeeMinor, &run.NetMinor,
	); err != nil {
		return nil, fmt.Errorf("restaurant: payout recompute totals: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("restaurant: payout build commit: %w", err)
	}
	return &run, nil
}

// loadUnpaidSettlements selects settled `settlements` for the given provider that
// are NOT yet claimed by any payout line. Settlements carry no provider_id column,
// so the provider is resolved through the order the settlement references
// (settlements.reference = 'order:' + orders.id): a restaurant provider is the
// restaurant owner; a rider provider is orders.rider_id. amountMinor is the
// provider's share — provider_kobo for a restaurant run, or the rider remainder
// (total - provider - fee) for a rider run.
func (s *Service) loadUnpaidSettlements(ctx context.Context, providerType, providerID string) ([]unpaidSettlement, error) {
	var q string
	switch providerType {
	case PayoutProviderRestaurant:
		q = `
			SELECT st.id, o.id, st.provider_kobo, st.fee_kobo
			FROM settlements st
			JOIN orders o        ON o.id = replace(st.reference, 'order:', '')::uuid
			JOIN restaurants res ON res.id = o.restaurant_id
			WHERE st.module_type = 'food_delivery'
			  AND st.status = 'settled'
			  AND res.owner_id = $1
			  AND st.provider_kobo > 0
			  AND NOT EXISTS (SELECT 1 FROM restaurant_payout_lines pl WHERE pl.settlement_id = st.id)`
	case PayoutProviderRider:
		q = `
			SELECT st.id, o.id, (st.total_kobo - st.provider_kobo - st.fee_kobo) AS rider_kobo, 0::bigint
			FROM settlements st
			JOIN orders o ON o.id = replace(st.reference, 'order:', '')::uuid
			WHERE st.module_type = 'food_delivery'
			  AND st.status = 'settled'
			  AND o.rider_id = $1
			  AND (st.total_kobo - st.provider_kobo - st.fee_kobo) > 0
			  AND NOT EXISTS (SELECT 1 FROM restaurant_payout_lines pl WHERE pl.settlement_id = st.id)`
	default:
		return nil, ErrPayoutBadProvider
	}
	rows, err := s.db.Query(ctx, q, providerID)
	if err != nil {
		return nil, fmt.Errorf("restaurant: payout load unpaid: %w", err)
	}
	defer rows.Close()
	var out []unpaidSettlement
	for rows.Next() {
		var u unpaidSettlement
		if err := rows.Scan(&u.settlementID, &u.orderID, &u.amountMinor, &u.feeMinor); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func totalFee(items []unpaidSettlement) int64 {
	var f int64
	for _, it := range items {
		f += it.feeMinor
	}
	return f
}

// ProcessRun disburses a DRAFT run: it flips draft -> processing -> paid under a
// row-level status guard and posts ONE balanced ledger transfer for the run's
// net (DR settlement standing account, CR provider wallet) keyed on the run's
// idempotency_key. Fail-closed and NEVER double-pays:
//
//   - the caller MUST supply an Idempotency-Key (ErrPayoutMissingIdem otherwise);
//   - the draft -> processing transition is an atomic guarded UPDATE
//     (WHERE status='draft'); a concurrent/duplicate call sees 0 rows affected and
//     does not re-post;
//   - the ledger posting is idempotent on the run's idempotency_key (a replay
//     after a crash mid-post is absorbed by the ledger unique constraint / Redis
//     fast-path — ledger.ErrDuplicate is treated as already-posted);
//   - only after the posting succeeds is the run stamped 'paid' with the ledger
//     reference + processed_at.
//
// A run with no net (nothing due) is a no-op error rather than a zero posting.
func (s *Service) ProcessRun(ctx context.Context, runID, idempotencyKey string) (*PayoutRun, error) {
	if idempotencyKey == "" {
		return nil, ErrPayoutMissingIdem
	}
	if s.ledger == nil {
		return nil, fmt.Errorf("restaurant: payout runs require a ledger (WithLedger not wired)")
	}

	// Guarded transition draft -> processing. Atomic: only one caller wins the
	// UPDATE; a duplicate/racing caller affects 0 rows and is rejected below.
	var run PayoutRun
	const claim = `
		UPDATE restaurant_payout_runs
		SET status = 'processing'
		WHERE id = $1 AND status = 'draft'
		RETURNING id, period_key, provider_type, provider_id, gross_minor, fee_minor,
		          net_minor, status, idempotency_key, ledger_reference, created_at, processed_at`
	err := s.db.QueryRow(ctx, claim, runID).Scan(
		&run.ID, &run.PeriodKey, &run.ProviderType, &run.ProviderID, &run.GrossMinor,
		&run.FeeMinor, &run.NetMinor, &run.Status, &run.IdempotencyKey,
		&run.LedgerReference, &run.CreatedAt, &run.ProcessedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either the run does not exist, or it is not a draft (already processing/
		// paid/failed). Distinguish so a duplicate ProcessRun of an already-paid run
		// is an idempotent success returning the paid run, not a spurious error.
		existing, gerr := s.GetRun(ctx, runID)
		if gerr != nil {
			return nil, ErrPayoutRunNotFound
		}
		if existing.Status == PayoutStatusPaid {
			return &existing.PayoutRun, nil // already disbursed — idempotent no-op
		}
		return nil, fmt.Errorf("restaurant: payout run %s not disbursable (status %s)", runID, existing.Status)
	}
	if err != nil {
		return nil, fmt.Errorf("restaurant: payout claim run: %w", err)
	}

	if run.NetMinor <= 0 {
		// Nothing to disburse — roll the guarded transition back to draft so the run
		// can be rebuilt, and report fail-closed.
		_, _ = s.db.Exec(ctx, `UPDATE restaurant_payout_runs SET status='draft' WHERE id=$1 AND status='processing'`, runID)
		return nil, ErrPayoutNothingDue
	}

	// Resolve the settlement standing account (money leaves here) and the provider's
	// wallet (money lands here). GetOrCreate* only ensures the account rows exist and
	// moves no money.
	settleAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, s.failRun(ctx, runID, fmt.Errorf("restaurant: payout resolve settlement acct: %w", err))
	}
	providerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, run.ProviderID)
	if err != nil {
		return nil, s.failRun(ctx, runID, fmt.Errorf("restaurant: payout resolve provider wallet: %w", err))
	}

	ledgerRef := "rpayout:" + run.ID
	// ONE balanced double-entry: DR settlement account, CR provider wallet, for the
	// run's net. Keyed on the run's idempotency_key so a crash-replay posts exactly
	// once (ErrDuplicate == already posted → treat as success).
	if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       ledgerRef,
		IdempotencyKey:  run.IdempotencyKey,
		AmountKobo:      run.NetMinor,
		DebitAccountID:  settleAcc.ID,
		CreditAccountID: providerWallet.ID,
		Description:     "restaurant payout run " + run.ProviderType,
	}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, s.failRun(ctx, runID, fmt.Errorf("restaurant: payout post journal: %w", err))
	}

	// Guarded transition processing -> paid, stamping the ledger reference. Only a
	// run still in 'processing' is finalised.
	now := time.Now()
	const finalise = `
		UPDATE restaurant_payout_runs
		SET status = 'paid', ledger_reference = $2, processed_at = $3
		WHERE id = $1 AND status = 'processing'
		RETURNING id, period_key, provider_type, provider_id, gross_minor, fee_minor,
		          net_minor, status, idempotency_key, ledger_reference, created_at, processed_at`
	if err := s.db.QueryRow(ctx, finalise, runID, ledgerRef, now).Scan(
		&run.ID, &run.PeriodKey, &run.ProviderType, &run.ProviderID, &run.GrossMinor,
		&run.FeeMinor, &run.NetMinor, &run.Status, &run.IdempotencyKey,
		&run.LedgerReference, &run.CreatedAt, &run.ProcessedAt,
	); err != nil {
		return nil, fmt.Errorf("restaurant: payout finalise: %w", err)
	}

	// Immutable audit event (best-effort via the shared notifier sink; the ledger
	// entry itself is the durable financial record).
	s.notify(ctx, Notification{
		UserID: run.ProviderID,
		Event:  EventPayoutDisbursed,
		Title:  "Payout disbursed",
		Body:   fmt.Sprintf("Your %s payout of ₦%d.%02d has been disbursed to your wallet.", run.ProviderType, run.NetMinor/100, run.NetMinor%100),
		Data: map[string]any{
			"run_id":        run.ID,
			"provider_type": run.ProviderType,
			"period_key":    run.PeriodKey,
			"net_minor":     run.NetMinor,
			"ledger_ref":    ledgerRef,
		},
	})
	return &run, nil
}

// failRun stamps a run 'failed' (fail-closed) and returns the original error. Only
// a run still in 'processing' is failed, so it never overrides a paid run.
func (s *Service) failRun(ctx context.Context, runID string, cause error) error {
	_, _ = s.db.Exec(ctx,
		`UPDATE restaurant_payout_runs SET status='failed', processed_at=now() WHERE id=$1 AND status='processing'`, runID)
	return cause
}

// ListRuns returns payout runs newest-first for the admin console (all providers).
func (s *Service) ListRuns(ctx context.Context, limit int) ([]PayoutRun, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, period_key, provider_type, provider_id, gross_minor, fee_minor,
		       net_minor, status, idempotency_key, ledger_reference, created_at, processed_at
		FROM restaurant_payout_runs
		ORDER BY created_at DESC
		LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("restaurant: payout list runs: %w", err)
	}
	defer rows.Close()
	var out []PayoutRun
	for rows.Next() {
		var r PayoutRun
		if err := rows.Scan(&r.ID, &r.PeriodKey, &r.ProviderType, &r.ProviderID,
			&r.GrossMinor, &r.FeeMinor, &r.NetMinor, &r.Status, &r.IdempotencyKey,
			&r.LedgerReference, &r.CreatedAt, &r.ProcessedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRun returns a single run plus its append-only lines (GET /payouts/:id).
func (s *Service) GetRun(ctx context.Context, runID string) (*PayoutRunDetail, error) {
	// Validate the id shape up front so a malformed path segment is a clean 404
	// rather than a driver cast error.
	if _, err := uuid.Parse(runID); err != nil {
		return nil, ErrPayoutRunNotFound
	}
	var d PayoutRunDetail
	const q = `
		SELECT id, period_key, provider_type, provider_id, gross_minor, fee_minor,
		       net_minor, status, idempotency_key, ledger_reference, created_at, processed_at
		FROM restaurant_payout_runs WHERE id = $1`
	if err := s.db.QueryRow(ctx, q, runID).Scan(
		&d.ID, &d.PeriodKey, &d.ProviderType, &d.ProviderID, &d.GrossMinor, &d.FeeMinor,
		&d.NetMinor, &d.Status, &d.IdempotencyKey, &d.LedgerReference, &d.CreatedAt, &d.ProcessedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPayoutRunNotFound
		}
		return nil, fmt.Errorf("restaurant: payout get run: %w", err)
	}

	const lq = `
		SELECT id, run_id, order_id, settlement_id, amount_minor, created_at
		FROM restaurant_payout_lines WHERE run_id = $1 ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, lq, runID)
	if err != nil {
		return nil, fmt.Errorf("restaurant: payout get lines: %w", err)
	}
	defer rows.Close()
	d.Lines = []PayoutLine{}
	for rows.Next() {
		var l PayoutLine
		if err := rows.Scan(&l.ID, &l.RunID, &l.OrderID, &l.SettlementID, &l.AmountMinor, &l.CreatedAt); err != nil {
			return nil, err
		}
		d.Lines = append(d.Lines, l)
	}
	return &d, rows.Err()
}

// ── Merchant earnings (owner-scoped read) ─────────────────────────────────────

// EarningsRun is a payout-run summary line for the merchant earnings screen.
type EarningsRun struct {
	ID          string     `json:"id"`
	PeriodKey   string     `json:"period_key"`
	NetKobo     int64      `json:"net_kobo"`
	Status      string     `json:"status"`
	ProcessedAt *time.Time `json:"processed_at,omitempty"`
}

// MerchantEarnings summarizes a restaurant owner's food-delivery earnings: what
// has been paid out (net of paid runs), what is still pending (settled provider
// shares not yet claimed by a payout line), and the recent runs. Read-only — it
// projects the ledger/payout tables and never moves money.
type MerchantEarnings struct {
	PaidOutKobo int64         `json:"paid_out_kobo"`
	PendingKobo int64         `json:"pending_kobo"`
	Runs        []EarningsRun `json:"runs"`
}

// GetMerchantEarnings computes the earnings summary for a restaurant owner.
func (s *Service) GetMerchantEarnings(ctx context.Context, ownerID string) (*MerchantEarnings, error) {
	out := &MerchantEarnings{Runs: []EarningsRun{}}

	// Paid out: net of all PAID runs for this provider.
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(sum(net_minor),0) FROM restaurant_payout_runs
		  WHERE provider_type=$2 AND provider_id=$1 AND status='paid'`,
		ownerID, PayoutProviderRestaurant).Scan(&out.PaidOutKobo); err != nil {
		return nil, fmt.Errorf("restaurant: earnings paid-out: %w", err)
	}

	// Pending: settled provider shares not yet claimed by a payout line. Mirrors
	// loadUnpaidSettlements' restaurant branch so the number matches what the next
	// payout run would disburse.
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(sum(st.provider_kobo),0)
		   FROM settlements st
		   JOIN orders o        ON o.id = replace(st.reference, 'order:', '')::uuid
		   JOIN restaurants res ON res.id = o.restaurant_id
		  WHERE st.module_type='food_delivery' AND st.status='settled'
		    AND res.owner_id=$1 AND st.provider_kobo > 0
		    AND NOT EXISTS (SELECT 1 FROM restaurant_payout_lines pl WHERE pl.settlement_id = st.id)`,
		ownerID).Scan(&out.PendingKobo); err != nil {
		return nil, fmt.Errorf("restaurant: earnings pending: %w", err)
	}

	// Recent runs (most recent first).
	rows, err := s.db.Query(ctx,
		`SELECT id, period_key, net_minor, status, processed_at
		   FROM restaurant_payout_runs WHERE provider_type=$2 AND provider_id=$1
		  ORDER BY created_at DESC LIMIT 20`, ownerID, PayoutProviderRestaurant)
	if err != nil {
		return nil, fmt.Errorf("restaurant: earnings runs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r EarningsRun
		if err := rows.Scan(&r.ID, &r.PeriodKey, &r.NetKobo, &r.Status, &r.ProcessedAt); err != nil {
			return nil, err
		}
		out.Runs = append(out.Runs, r)
	}
	return out, rows.Err()
}
