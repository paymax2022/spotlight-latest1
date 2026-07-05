package policy

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for policies, premium transactions
// and beneficiaries. It NEVER mutates wallet balances — money moves via the
// finance ledger/wallet service; this repo only records the insurance-domain rows
// that reference the ledger entries.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the policy repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const policyCols = `id, policyholder_user_id, product_code, provider, provider_policy_ref,
	underwriter, binding_mode, state, sum_insured_kobo, premium_amount_kobo, currency,
	commission_kobo, certificate_ref, effective_at, expires_at, source_event_id,
	created_at, updated_at, version`

func scanPolicy(row interface {
	Scan(dest ...any) error
}) (*Policy, error) {
	var p Policy
	if err := row.Scan(
		&p.ID, &p.PolicyholderID, &p.ProductCode, &p.Provider, &p.ProviderPolicyRef,
		&p.Underwriter, &p.BindingMode, &p.State, &p.SumInsuredKobo, &p.PremiumKobo, &p.Currency,
		&p.CommissionKobo, &p.CertificateRef, &p.EffectiveAt, &p.ExpiresAt, &p.SourceEventID,
		&p.CreatedAt, &p.UpdatedAt, &p.Version,
	); err != nil {
		return nil, err
	}
	return &p, nil
}

// Create inserts a policy in QUOTED (direct) state.
func (r *Repository) Create(ctx context.Context, p *Policy) (*Policy, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_policy
			(policyholder_user_id, product_code, provider, underwriter, binding_mode,
			 state, sum_insured_kobo, premium_amount_kobo, currency, source_event_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING `+policyCols,
		p.PolicyholderID, p.ProductCode, p.Provider, p.Underwriter, p.BindingMode,
		string(p.State), p.SumInsuredKobo, p.PremiumKobo, p.Currency, p.SourceEventID,
	)
	return scanPolicy(row)
}

// Get returns a policy by id (no ownership filter; callers enforce object-level
// authZ in the service).
func (r *Repository) Get(ctx context.Context, id string) (*Policy, error) {
	row := r.db.QueryRow(ctx, `SELECT `+policyCols+` FROM public.insurance_policy WHERE id = $1`, id)
	p, err := scanPolicy(row)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// ListByUser returns the policy wallet for a user, newest first.
func (r *Repository) ListByUser(ctx context.Context, userID string, limit, offset int) ([]Policy, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+policyCols+` FROM public.insurance_policy
		WHERE policyholder_user_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Policy
	for rows.Next() {
		p, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// SearchAdmin returns policies across all users for admin search.
func (r *Repository) SearchAdmin(ctx context.Context, state, productCode string, limit, offset int) ([]Policy, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + policyCols + ` FROM public.insurance_policy WHERE 1=1`
	args := []any{}
	n := 0
	if state != "" {
		n++
		q += fmt.Sprintf(" AND state = $%d", n)
		args = append(args, state)
	}
	if productCode != "" {
		n++
		q += fmt.Sprintf(" AND product_code = $%d", n)
		args = append(args, productCode)
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", n+1, n+2)
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Policy
	for rows.Next() {
		p, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// SetState performs an optimistic-version guarded state write. expectVersion must
// match the row's current version or the update is a no-op (ErrConflict). This
// guards the saga against concurrent transitions.
func (r *Repository) SetState(ctx context.Context, id string, to State, expectVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_policy
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

// SetBound records the provider policy ref + disclosure + cert on a successful
// bind and moves to ACTIVE atomically (version-guarded).
func (r *Repository) SetBound(ctx context.Context, id string, providerPolicyRef, underwriter string, commissionKobo int64, certRef *string, effectiveAt, expiresAt *time.Time, expectVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_policy
		SET state = $2, provider_policy_ref = $3, underwriter = COALESCE(NULLIF($4,''), underwriter),
		    commission_kobo = $5, certificate_ref = $6, effective_at = $7, expires_at = $8,
		    version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $9`,
		id, string(StateActive), providerPolicyRef, underwriter, commissionKobo, certRef, effectiveAt, expiresAt, expectVersion)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// --- premium transactions ---

// PremiumTx is the insurance-domain record of a premium money move. It references
// the ledger entry (wallet_ledger_ref) and carries the idempotency key (UNIQUE).
type PremiumTx struct {
	ID                   string
	PolicyID             string
	WalletLedgerRef      string
	IdempotencyKey       string
	AmountKobo           int64
	Direction            string // DEBIT | REVERSAL
	Status               string // posted | reversed
	ProviderRemittanceRef *string
}

// InsertPremiumTx records a premium money move. UNIQUE(idempotency_key) makes a
// retried debit a safe no-op at the DB layer (ON CONFLICT DO NOTHING).
func (r *Repository) InsertPremiumTx(ctx context.Context, tx PremiumTx) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.insurance_premium_transaction
			(policy_id, wallet_ledger_ref, idempotency_key, amount_kobo, direction, status)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		tx.PolicyID, tx.WalletLedgerRef, tx.IdempotencyKey, tx.AmountKobo, tx.Direction, tx.Status)
	return err
}

// --- beneficiaries ---

// AddBeneficiary inserts a beneficiary on a policy.
func (r *Repository) AddBeneficiary(ctx context.Context, b *Beneficiary) (*Beneficiary, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_beneficiary (policy_id, full_name, relationship, share_percent, phone)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, policy_id, full_name, relationship, share_percent, phone`,
		b.PolicyID, b.FullName, b.Relationship, b.SharePercent, b.Phone)
	var out Beneficiary
	if err := row.Scan(&out.ID, &out.PolicyID, &out.FullName, &out.Relationship, &out.SharePercent, &out.Phone); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListBeneficiaries returns the beneficiaries of a policy.
func (r *Repository) ListBeneficiaries(ctx context.Context, policyID string) ([]Beneficiary, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, policy_id, full_name, relationship, share_percent, phone
		FROM public.insurance_beneficiary WHERE policy_id = $1 ORDER BY share_percent DESC`, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Beneficiary
	for rows.Next() {
		var b Beneficiary
		if err := rows.Scan(&b.ID, &b.PolicyID, &b.FullName, &b.Relationship, &b.SharePercent, &b.Phone); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Sentinel errors.
var (
	ErrConflict = fmt.Errorf("policy: version conflict (concurrent transition)")
)
