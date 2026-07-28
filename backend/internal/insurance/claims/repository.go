package claims

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for claims, evidence and payouts. It
// NEVER mutates wallet balances — money moves via the finance ledger/wallet
// service; this repo only records the insurance-domain rows that reference the
// posted ledger entries. No raw PII is written (only object refs + amounts).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the claims repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Sentinel errors.
var (
	ErrConflict = fmt.Errorf("claims: version conflict (concurrent transition)")
	ErrNotFound = fmt.Errorf("claims: not found")
)

const claimCols = `id, policy_id, claimant_user_id, provider, provider_claim_ref, state,
	loss_event_at, reported_at, description, claimed_amount_kobo, approved_amount_kobo,
	currency, payout_ledger_ref, idempotency_key, created_at, updated_at, version`

func scanClaim(row interface {
	Scan(dest ...any) error
}) (*Claim, error) {
	var c Claim
	if err := row.Scan(
		&c.ID, &c.PolicyID, &c.ClaimantID, &c.Provider, &c.ProviderClaimRef, &c.State,
		&c.LossEventAt, &c.ReportedAt, &c.Description, &c.ClaimedAmountKobo, &c.ApprovedAmountKobo,
		&c.Currency, &c.PayoutLedgerRef, &c.IdempotencyKey, &c.CreatedAt, &c.UpdatedAt, &c.Version,
	); err != nil {
		return nil, err
	}
	return &c, nil
}

// Create inserts a claim. idempotency_key is UNIQUE — a retried FNOL with the
// same key returns the existing claim instead of creating a second one.
func (r *Repository) Create(ctx context.Context, c *Claim) (*Claim, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_claim
			(policy_id, claimant_user_id, provider, state, loss_event_at, reported_at,
			 description, claimed_amount_kobo, currency, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING `+claimCols,
		c.PolicyID, c.ClaimantID, c.Provider, string(c.State), c.LossEventAt, c.ReportedAt,
		c.Description, c.ClaimedAmountKobo, c.Currency, c.IdempotencyKey,
	)
	return scanClaim(row)
}

// GetByIdempotencyKey returns a claim by its idempotency key, or ErrNotFound.
func (r *Repository) GetByIdempotencyKey(ctx context.Context, key string) (*Claim, error) {
	row := r.db.QueryRow(ctx, `SELECT `+claimCols+` FROM public.insurance_claim WHERE idempotency_key = $1`, key)
	c, err := scanClaim(row)
	if err != nil {
		return nil, ErrNotFound
	}
	return c, nil
}

// Get returns a claim by id (no ownership filter; callers enforce object-level
// authZ in the service).
func (r *Repository) Get(ctx context.Context, id string) (*Claim, error) {
	row := r.db.QueryRow(ctx, `SELECT `+claimCols+` FROM public.insurance_claim WHERE id = $1`, id)
	return scanClaim(row)
}

// GetByProviderRef returns a claim by (provider, provider_claim_ref) — used by
// webhook ingestion to map a provider claim event back to our claim row.
func (r *Repository) GetByProviderRef(ctx context.Context, provider, ref string) (*Claim, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+claimCols+` FROM public.insurance_claim
		WHERE provider = $1 AND provider_claim_ref = $2`, provider, ref)
	c, err := scanClaim(row)
	if err != nil {
		return nil, ErrNotFound
	}
	return c, nil
}

// ListByUser returns the caller's claims, newest first.
func (r *Repository) ListByUser(ctx context.Context, userID string, limit, offset int) ([]Claim, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+claimCols+` FROM public.insurance_claim
		WHERE claimant_user_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Claim
	for rows.Next() {
		c, err := scanClaim(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// SearchAdmin returns claims across all users for admin search.
func (r *Repository) SearchAdmin(ctx context.Context, state, policyID string, limit, offset int) ([]Claim, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + claimCols + ` FROM public.insurance_claim WHERE 1=1`
	args := []any{}
	n := 0
	if state != "" {
		n++
		q += fmt.Sprintf(" AND state = $%d", n)
		args = append(args, state)
	}
	if policyID != "" {
		n++
		q += fmt.Sprintf(" AND policy_id = $%d", n)
		args = append(args, policyID)
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", n+1, n+2)
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Claim
	for rows.Next() {
		c, err := scanClaim(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// SetState performs an optimistic-version guarded state write.
func (r *Repository) SetState(ctx context.Context, id string, to State, expectVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_claim
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $3`, id, string(to), expectVersion)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// SetProviderRef records the provider claim ref + moves to FNOL_SUBMITTED
// atomically (version-guarded) after a successful provider hand-off.
func (r *Repository) SetProviderRef(ctx context.Context, id, providerClaimRef string, to State, expectVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_claim
		SET provider_claim_ref = $2, state = $3, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $4`, id, providerClaimRef, string(to), expectVersion)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// SetApprovedAmount records the provider-approved amount + moves to APPROVED.
func (r *Repository) SetApprovedAmount(ctx context.Context, id string, approvedKobo int64, expectVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_claim
		SET approved_amount_kobo = $2, state = $3, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $4`, id, approvedKobo, string(StateApproved), expectVersion)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// SetSettled records the payout ledger ref + moves to SETTLED atomically.
func (r *Repository) SetSettled(ctx context.Context, id, payoutLedgerRef string, expectVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_claim
		SET payout_ledger_ref = $2, state = $3, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $4`, id, payoutLedgerRef, string(StateSettled), expectVersion)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// --- evidence ---

// AddEvidence records an evidence object reference on a claim.
func (r *Repository) AddEvidence(ctx context.Context, e *Evidence) (*Evidence, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_claim_evidence (claim_id, file_name, content_type, storage_ref)
		VALUES ($1,$2,$3,$4)
		RETURNING id, claim_id, file_name, content_type, storage_ref, created_at`,
		e.ClaimID, e.FileName, e.ContentType, e.StorageRef)
	var out Evidence
	if err := row.Scan(&out.ID, &out.ClaimID, &out.FileName, &out.ContentType, &out.StorageRef, &out.CreatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListEvidence returns the evidence refs for a claim.
func (r *Repository) ListEvidence(ctx context.Context, claimID string) ([]Evidence, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, claim_id, file_name, content_type, storage_ref, created_at
		FROM public.insurance_claim_evidence WHERE claim_id = $1 ORDER BY created_at`, claimID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Evidence
	for rows.Next() {
		var e Evidence
		if err := rows.Scan(&e.ID, &e.ClaimID, &e.FileName, &e.ContentType, &e.StorageRef, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- payouts ---

// InsertPayout records a claim payout money move. UNIQUE(idempotency_key) makes a
// retried settlement a safe no-op at the DB layer (ON CONFLICT DO NOTHING).
func (r *Repository) InsertPayout(ctx context.Context, p Payout) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.insurance_claim_payout
			(claim_id, wallet_ledger_ref, idempotency_key, amount_kobo, status)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		p.ClaimID, p.WalletLedgerRef, p.IdempotencyKey, p.AmountKobo, p.Status)
	return err
}

// PayoutExists reports whether a payout has already been posted for an
// idempotency key (the claim-level payout guard).
func (r *Repository) PayoutExists(ctx context.Context, idempotencyKey string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM public.insurance_claim_payout WHERE idempotency_key = $1)`,
		idempotencyKey).Scan(&exists)
	return exists, err
}
