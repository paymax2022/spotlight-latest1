package finance

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/ptr"
)

// Repository is the parameterized data layer for the referral finance tables. It
// also reads RB0's referral_reward_ledger and the user_profiles KYC tier for
// payout gating, all via parameterized queries.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const payoutCols = `id, beneficiary_id, reward_id, amount_kobo, currency, status,
	requested_by, approved_by, ledger_entry_id, reject_reason, created_at, updated_at, decided_at`

func scanPayout(row pgx.Row) (*Payout, error) {
	var (
		p                              Payout
		reward, reqBy, apprBy, led, rj *string
	)
	if err := row.Scan(&p.ID, &p.BeneficiaryID, &reward, &p.AmountKobo, &p.Currency, &p.Status,
		&reqBy, &apprBy, &led, &rj, &p.CreatedAt, &p.UpdatedAt, &p.DecidedAt); err != nil {
		return nil, err
	}
	ptr.Assign(&p.RewardID, reward)
	ptr.Assign(&p.RequestedBy, reqBy)
	ptr.Assign(&p.ApprovedBy, apprBy)
	ptr.Assign(&p.LedgerEntryID, led)
	ptr.Assign(&p.RejectReason, rj)
	return &p, nil
}

// QueuePayout inserts a payout request (idempotent on idempotency_key). Returns
// the row and whether it was newly created.
func (r *Repository) QueuePayout(ctx context.Context, in PayoutRequest, requestedBy string) (*Payout, bool, error) {
	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}
	const q = `
		INSERT INTO referral_payouts
			(beneficiary_id, reward_id, amount_kobo, currency, status, requested_by, idempotency_key)
		VALUES ($1,$2,$3,$4,'queued',$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING ` + payoutCols
	p, err := scanPayout(r.db.QueryRow(ctx, q,
		in.BeneficiaryID, dbutil.NullStr(in.RewardID), in.AmountKobo, currency, dbutil.NullStr(requestedBy), in.IdempotencyKey))
	if errors.Is(err, pgx.ErrNoRows) {
		existing, e := scanPayout(r.db.QueryRow(ctx,
			`SELECT `+payoutCols+` FROM referral_payouts WHERE idempotency_key = $1`, in.IdempotencyKey))
		if e != nil {
			return nil, false, fmt.Errorf("finance: queue payout (dup lookup): %w", e)
		}
		return existing, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("finance: queue payout: %w", err)
	}
	return p, true, nil
}

// GetPayout returns one payout by id.
func (r *Repository) GetPayout(ctx context.Context, id string) (*Payout, error) {
	p, err := scanPayout(r.db.QueryRow(ctx, `SELECT `+payoutCols+` FROM referral_payouts WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("finance: get payout: %w", err)
	}
	return p, nil
}

// ListPayouts lists payouts, optional status filter.
func (r *Repository) ListPayouts(ctx context.Context, status string, limit int) ([]Payout, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	q := `SELECT ` + payoutCols + ` FROM referral_payouts`
	var args []any
	if status != "" {
		q += ` WHERE status = $1 ORDER BY created_at DESC LIMIT $2`
		args = append(args, status, limit)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $1`
		args = append(args, limit)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("finance: list payouts: %w", err)
	}
	defer rows.Close()
	out := []Payout{}
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// MarkPayoutPaid flips a payout queued/approved → paid, recording the ledger ref.
// Guarded so a concurrent caller can't double-pay.
func (r *Repository) MarkPayoutPaid(ctx context.Context, id, approvedBy, ledgerEntryID string) error {
	const q = `
		UPDATE referral_payouts
		SET status = 'paid', approved_by = $2::uuid, ledger_entry_id = $3, decided_at = now(), updated_at = now()
		WHERE id = $1 AND status IN ('queued','approved')`
	tag, err := r.db.Exec(ctx, q, id, dbutil.NullStr(approvedBy), ledgerEntryID)
	if err != nil {
		return fmt.Errorf("finance: mark payout paid: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errors.New("finance: payout not in a payable state")
	}
	return nil
}

// RejectPayout flips a queued/approved payout → rejected.
func (r *Repository) RejectPayout(ctx context.Context, id, approvedBy, reason string) error {
	const q = `
		UPDATE referral_payouts
		SET status = 'rejected', approved_by = $2::uuid, reject_reason = $3, decided_at = now(), updated_at = now()
		WHERE id = $1 AND status IN ('queued','approved')`
	tag, err := r.db.Exec(ctx, q, id, dbutil.NullStr(approvedBy), reason)
	if err != nil {
		return fmt.Errorf("finance: reject payout: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errors.New("finance: payout not in a rejectable state")
	}
	return nil
}

// MarkPayoutFailed flips a payout → failed (ledger posting failure).
func (r *Repository) MarkPayoutFailed(ctx context.Context, id, reason string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE referral_payouts SET status='failed', reject_reason=$2, updated_at=now() WHERE id=$1 AND status IN ('queued','approved')`,
		id, reason)
	if err != nil {
		return fmt.Errorf("finance: mark payout failed: %w", err)
	}
	return nil
}

// KYCTier returns a beneficiary's verified KYC tier (0 when none). Used to gate
// payouts (Tier/KYC gated).
func (r *Repository) KYCTier(ctx context.Context, userID string) (int, error) {
	const q = `SELECT COALESCE(kyc_tier, 0) FROM user_profiles WHERE id = $1 AND kyc_status = 'verified'`
	var tier int
	err := r.db.QueryRow(ctx, q, userID).Scan(&tier)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("finance: kyc tier: %w", err)
	}
	return tier, nil
}

const reconCols = `id, period_start, period_end, ledger_paid_kobo, wallet_paid_kobo, variance_kobo, status, created_by, created_at`

func scanRecon(row pgx.Row) (*Reconciliation, error) {
	var (
		rc    Reconciliation
		creBy *string
	)
	if err := row.Scan(&rc.ID, &rc.PeriodStart, &rc.PeriodEnd, &rc.LedgerPaidKobo,
		&rc.WalletPaidKobo, &rc.VarianceKobo, &rc.Status, &creBy, &rc.CreatedAt); err != nil {
		return nil, err
	}
	ptr.Assign(&rc.CreatedBy, creBy)
	return &rc, nil
}

// LedgerPaidInPeriod sums RB0 reward-ledger amounts in 'paid' state for human
// (non-house) beneficiaries within the window.
func (r *Repository) LedgerPaidInPeriod(ctx context.Context, since, until string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM referral_reward_ledger
		WHERE state = 'paid' AND is_house = false
		  AND updated_at >= $1::timestamptz AND updated_at < $2::timestamptz`
	var sum int64
	if err := r.db.QueryRow(ctx, q, since, until).Scan(&sum); err != nil {
		return 0, fmt.Errorf("finance: ledger paid in period: %w", err)
	}
	return sum, nil
}

// WalletPaidInPeriod sums referral payouts marked 'paid' within the window.
func (r *Repository) WalletPaidInPeriod(ctx context.Context, since, until string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM referral_payouts
		WHERE status = 'paid'
		  AND decided_at >= $1::timestamptz AND decided_at < $2::timestamptz`
	var sum int64
	if err := r.db.QueryRow(ctx, q, since, until).Scan(&sum); err != nil {
		return 0, fmt.Errorf("finance: wallet paid in period: %w", err)
	}
	return sum, nil
}

// InsertReconciliation records a reconciliation snapshot.
func (r *Repository) InsertReconciliation(ctx context.Context, rc Reconciliation, createdBy string) (*Reconciliation, error) {
	const q = `
		INSERT INTO referral_reconciliation
			(period_start, period_end, ledger_paid_kobo, wallet_paid_kobo, variance_kobo, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING ` + reconCols
	return scanRecon(r.db.QueryRow(ctx, q,
		rc.PeriodStart, rc.PeriodEnd, rc.LedgerPaidKobo, rc.WalletPaidKobo, rc.VarianceKobo, rc.Status, dbutil.NullStr(createdBy)))
}

// ListReconciliations lists recon snapshots.
func (r *Repository) ListReconciliations(ctx context.Context) ([]Reconciliation, error) {
	rows, err := r.db.Query(ctx, `SELECT `+reconCols+` FROM referral_reconciliation ORDER BY period_end DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("finance: list reconciliations: %w", err)
	}
	defer rows.Close()
	out := []Reconciliation{}
	for rows.Next() {
		rc, err := scanRecon(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rc)
	}
	return out, rows.Err()
}

const budgetCols = `id, scope, scope_ref, budget_kobo, spent_kobo, alert_threshold_pct,
	period_start, period_end, active, created_at, updated_at`

func scanBudget(row pgx.Row) (*Budget, error) {
	var (
		b   Budget
		ref *string
	)
	if err := row.Scan(&b.ID, &b.Scope, &ref, &b.BudgetKobo, &b.SpentKobo, &b.AlertThresholdPct,
		&b.PeriodStart, &b.PeriodEnd, &b.Active, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return nil, err
	}
	ptr.Assign(&b.ScopeRef, ref)
	b.computeBurn()
	return &b, nil
}

func (b *Budget) computeBurn() {
	if b.BudgetKobo > 0 {
		b.BurnPct = int(b.SpentKobo * 100 / b.BudgetKobo)
	}
	b.AlertTriggered = b.AlertThresholdPct > 0 && b.BurnPct >= b.AlertThresholdPct
}

// UpsertBudget creates/updates a budget envelope keyed by (scope, scope_ref).
func (r *Repository) UpsertBudget(ctx context.Context, in BudgetInput) (*Budget, error) {
	scope := in.Scope
	if scope == "" {
		scope = "program"
	}
	threshold := 80
	if in.AlertThresholdPct != nil {
		threshold = *in.AlertThresholdPct
	}
	const q = `
		INSERT INTO referral_budgets (scope, scope_ref, budget_kobo, alert_threshold_pct, active)
		VALUES ($1,$2,$3,$4,true)
		ON CONFLICT (scope, scope_ref) DO UPDATE SET
			budget_kobo = EXCLUDED.budget_kobo,
			alert_threshold_pct = EXCLUDED.alert_threshold_pct,
			active = true,
			updated_at = now()
		RETURNING ` + budgetCols
	return scanBudget(r.db.QueryRow(ctx, q, scope, dbutil.NullStr(in.ScopeRef), in.BudgetKobo, threshold))
}

// ListBudgets lists active budgets with burn computed.
func (r *Repository) ListBudgets(ctx context.Context) ([]Budget, error) {
	rows, err := r.db.Query(ctx, `SELECT `+budgetCols+` FROM referral_budgets ORDER BY scope, scope_ref`)
	if err != nil {
		return nil, fmt.Errorf("finance: list budgets: %w", err)
	}
	defer rows.Close()
	out := []Budget{}
	for rows.Next() {
		b, err := scanBudget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// AddSpend increments a budget's spent_kobo (called on payout). Idempotency is the
// caller's responsibility (payouts are idempotent upstream).
func (r *Repository) AddSpend(ctx context.Context, scope, scopeRef string, amountKobo int64) error {
	const q = `
		UPDATE referral_budgets SET spent_kobo = spent_kobo + $3, updated_at = now()
		WHERE scope = $1 AND scope_ref IS NOT DISTINCT FROM $2 AND active = true`
	_, err := r.db.Exec(ctx, q, scope, dbutil.NullStr(scopeRef), amountKobo)
	if err != nil {
		return fmt.Errorf("finance: add spend: %w", err)
	}
	return nil
}

const floatCols = `id, position_kobo, liability_kobo, funded_kobo, as_of, note, created_at`

func scanFloat(row pgx.Row) (*Float, error) {
	var (
		f    Float
		note *string
	)
	if err := row.Scan(&f.ID, &f.PositionKobo, &f.LiabilityKobo, &f.FundedKobo, &f.AsOf, &note, &f.CreatedAt); err != nil {
		return nil, err
	}
	ptr.Assign(&f.Note, note)
	return &f, nil
}

// SnapshotFloat records a float / liability snapshot. The outstanding liability
// is the sum of eligible-but-unpaid human reward-ledger rows.
func (r *Repository) SnapshotFloat(ctx context.Context, fundedKobo int64, note string) (*Float, error) {
	const liab = `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM referral_reward_ledger
		WHERE is_house = false AND state IN ('earned','pending','vesting','eligible')`
	var liability int64
	if err := r.db.QueryRow(ctx, liab).Scan(&liability); err != nil {
		return nil, fmt.Errorf("finance: float liability: %w", err)
	}
	position := fundedKobo - liability
	const q = `
		INSERT INTO referral_float (position_kobo, liability_kobo, funded_kobo, note)
		VALUES ($1,$2,$3,$4)
		RETURNING ` + floatCols
	return scanFloat(r.db.QueryRow(ctx, q, position, liability, fundedKobo, dbutil.NullStr(note)))
}

// LatestFloat returns the most recent float snapshot (nil when none).
func (r *Repository) LatestFloat(ctx context.Context) (*Float, error) {
	f, err := scanFloat(r.db.QueryRow(ctx, `SELECT `+floatCols+` FROM referral_float ORDER BY as_of DESC LIMIT 1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("finance: latest float: %w", err)
	}
	return f, nil
}

// RewardToLTV computes reward spend (paid, non-house) vs referred-user verified
// activity value (LTV proxy). House rows are excluded from spend.
func (r *Repository) RewardToLTV(ctx context.Context) (*RewardToLTV, error) {
	var out RewardToLTV
	const spendQ = `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM referral_reward_ledger
		WHERE state = 'paid' AND is_house = false`
	if err := r.db.QueryRow(ctx, spendQ).Scan(&out.RewardSpentKobo); err != nil {
		return nil, fmt.Errorf("finance: reward spend: %w", err)
	}
	const ltvQ = `
		SELECT COALESCE(SUM((payload->>'value_kobo')::bigint), 0)
		FROM referral_engine_events
		WHERE event_type IN ('qualifying_action','transaction','verified_revenue')
		  AND (payload->>'value_kobo') IS NOT NULL
		  AND user_id IN (SELECT referred_user_id FROM referral_attributions WHERE is_house = false)`
	if err := r.db.QueryRow(ctx, ltvQ).Scan(&out.ReferredLTVKobo); err != nil {
		return nil, fmt.Errorf("finance: referred ltv: %w", err)
	}
	if out.RewardSpentKobo > 0 {
		out.RatioBps = out.ReferredLTVKobo * 10000 / out.RewardSpentKobo
	}
	return &out, nil
}

// Payout statuses.
const (
	PayoutQueued   = "queued"
	PayoutApproved = "approved"
	PayoutPaid     = "paid"
	PayoutRejected = "rejected"
	PayoutFailed   = "failed"
)

// Reconciliation statuses.
const (
	ReconOpen     = "open"
	ReconBalanced = "balanced"
	ReconVariance = "variance"
)

// Payout is a payout-queue row.
type Payout struct {
	ID            string     `json:"id"`
	BeneficiaryID string     `json:"beneficiary_id"`
	RewardID      string     `json:"reward_id,omitempty"`
	AmountKobo    int64      `json:"amount_kobo"`
	Currency      string     `json:"currency"`
	Status        string     `json:"status"`
	RequestedBy   string     `json:"requested_by,omitempty"`
	ApprovedBy    string     `json:"approved_by,omitempty"`
	LedgerEntryID string     `json:"ledger_entry_id,omitempty"`
	RejectReason  string     `json:"reject_reason,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	DecidedAt     *time.Time `json:"decided_at,omitempty"`
}

// PayoutRequest queues a payout. IdempotencyKey is required (one payout per key).
type PayoutRequest struct {
	BeneficiaryID  string `json:"beneficiary_id"`
	RewardID       string `json:"reward_id"`
	AmountKobo     int64  `json:"amount_kobo"`
	Currency       string `json:"currency"`
	IdempotencyKey string `json:"idempotency_key"`
}

// Reconciliation is a recon snapshot row.
type Reconciliation struct {
	ID             string    `json:"id"`
	PeriodStart    time.Time `json:"period_start"`
	PeriodEnd      time.Time `json:"period_end"`
	LedgerPaidKobo int64     `json:"ledger_paid_kobo"`
	WalletPaidKobo int64     `json:"wallet_paid_kobo"`
	VarianceKobo   int64     `json:"variance_kobo"`
	Status         string    `json:"status"`
	CreatedBy      string    `json:"created_by,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// Budget is a budget envelope with burn tracking.
type Budget struct {
	ID                string     `json:"id"`
	Scope             string     `json:"scope"`
	ScopeRef          string     `json:"scope_ref,omitempty"`
	BudgetKobo        int64      `json:"budget_kobo"`
	SpentKobo         int64      `json:"spent_kobo"`
	AlertThresholdPct int        `json:"alert_threshold_pct"`
	PeriodStart       *time.Time `json:"period_start,omitempty"`
	PeriodEnd         *time.Time `json:"period_end,omitempty"`
	Active            bool       `json:"active"`
	BurnPct           int        `json:"burn_pct"`
	AlertTriggered    bool       `json:"alert_triggered"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// BudgetInput creates/updates a budget envelope.
type BudgetInput struct {
	Scope             string `json:"scope"`
	ScopeRef          string `json:"scope_ref"`
	BudgetKobo        int64  `json:"budget_kobo"`
	AlertThresholdPct *int   `json:"alert_threshold_pct"`
}

// Float is a float / liability snapshot.
type Float struct {
	ID            string    `json:"id"`
	PositionKobo  int64     `json:"position_kobo"`
	LiabilityKobo int64     `json:"liability_kobo"`
	FundedKobo    int64     `json:"funded_kobo"`
	AsOf          time.Time `json:"as_of"`
	Note          string    `json:"note,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// RewardToLTV is the reward-to-LTV summary (A-FIN / A-BI). LTV is the verified
// activity value generated by referred users vs reward spend.
type RewardToLTV struct {
	RewardSpentKobo int64 `json:"reward_spent_kobo"`
	ReferredLTVKobo int64 `json:"referred_ltv_kobo"`
	RatioBps        int64 `json:"ratio_bps"` // LTV / spend in basis points
}
