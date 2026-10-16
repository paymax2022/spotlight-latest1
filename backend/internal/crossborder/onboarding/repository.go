package onboarding

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/platform/crypto"
)

// ErrStaleStatus means the compare-and-set on the account status lost: the
// stored status was no longer the expected `from` (concurrent/stale transition).
var ErrStaleStatus = errors.New("onboarding: account status changed concurrently (stale from)")

// ErrAccountConflict means the insert hit a uniqueness constraint (e.g. the
// provider company id is already bound to another user) and no existing
// account for this user could be returned.
var ErrAccountConflict = errors.New("onboarding: account conflicts with an existing record")

// ErrIllegalTransition is returned for a from→to pair the state machine forbids.
var ErrIllegalTransition = errors.New("onboarding: illegal status transition")

// Repository is the pgx (service_role) data layer for Global Account
// onboarding. It owns provider_accounts, provider_wallets, funding_details,
// onboarding_submissions and onboarding_consents only. Account numbers are
// encrypted at rest with the shared AES-256-GCM PII cipher.
type Repository struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewRepository builds the repository over the shared pgx pool and PII cipher.
func NewRepository(db *pgxpool.Pool, cipher *crypto.Cipher) *Repository {
	return &Repository{db: db, cipher: cipher}
}

// StatusUpdate carries the optional columns set alongside a status change.
type StatusUpdate struct {
	RejectionReason string
	PriorStatus     Status
	SubmittedAt     *time.Time
	ApprovedAt      *time.Time
	TnCAcceptedAt   *time.Time
}

const accountCols = `id, user_id, provider, subject_type, COALESCE(provider_company_id,''), status,
	COALESCE(prior_status,''), COALESCE(rejection_reason,''), created_at, submitted_at, approved_at,
	tnc_accepted_at, updated_at`

func scanAccount(row pgx.Row) (*GlobalAccount, error) {
	var a GlobalAccount
	var st, prior, subj string
	if err := row.Scan(&a.ID, &a.UserID, &a.Provider, &subj, &a.ProviderCompanyID, &st, &prior,
		&a.RejectionReason, &a.CreatedAt, &a.SubmittedAt, &a.ApprovedAt, &a.TnCAcceptedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	a.SubjectType, a.Status, a.PriorStatus = SubjectType(subj), Status(st), Status(prior)
	return &a, nil
}

// CreateAccount inserts an account. Idempotent: if the idempotency key or a
// live (user, provider) account already exists, the EXISTING row is returned.
func (r *Repository) CreateAccount(ctx context.Context, a *GlobalAccount, idempotencyKey string, tier int) (*GlobalAccount, error) {
	if idempotencyKey == "" {
		return nil, errors.New("onboarding repo: idempotency key required")
	}
	status := a.Status
	if status == "" {
		status = StatusNotStarted
	}
	q := `
		INSERT INTO provider_accounts
			(user_id, provider, subject_type, provider_company_id, status, tier_at_activation, idempotency_key, submitted_at)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8)
		ON CONFLICT DO NOTHING
		RETURNING ` + accountCols
	out, err := scanAccount(r.db.QueryRow(ctx, q, a.UserID, a.Provider, string(a.SubjectType),
		a.ProviderCompanyID, string(status), tier, idempotencyKey, a.SubmittedAt))
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("onboarding repo: create account: %w", err)
	}
	// Lost to an existing row: same idempotency key first, else the live account.
	existing, err := scanAccount(r.db.QueryRow(ctx,
		`SELECT `+accountCols+` FROM provider_accounts WHERE idempotency_key = $1`, idempotencyKey))
	if errors.Is(err, pgx.ErrNoRows) {
		live, lerr := r.GetAccountByUser(ctx, a.UserID, a.Provider)
		if lerr != nil {
			return nil, lerr
		}
		if live == nil {
			return nil, ErrAccountConflict
		}
		return live, nil
	}
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: create account lookup: %w", err)
	}
	return existing, nil
}

// GetAccountByUser returns the user's most relevant account for a provider
// (live first, then newest), or (nil, nil) when none exists.
func (r *Repository) GetAccountByUser(ctx context.Context, userID, provider string) (*GlobalAccount, error) {
	a, err := scanAccount(r.db.QueryRow(ctx, `
		SELECT `+accountCols+` FROM provider_accounts
		WHERE user_id = $1 AND provider = $2
		ORDER BY (status <> 'REJECTED') DESC, created_at DESC LIMIT 1`, userID, provider))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: get by user: %w", err)
	}
	return a, nil
}

// GetAccountByCompanyID returns the account for a provider-side company id, or (nil, nil).
func (r *Repository) GetAccountByCompanyID(ctx context.Context, provider, companyID string) (*GlobalAccount, error) {
	a, err := scanAccount(r.db.QueryRow(ctx, `
		SELECT `+accountCols+` FROM provider_accounts
		WHERE provider = $1 AND provider_company_id = $2`, provider, companyID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: get by company: %w", err)
	}
	return a, nil
}

// UpdateStatus moves an account from→to with a compare-and-set guard
// (WHERE status = from), so a stale or concurrent transition returns
// ErrStaleStatus and monotonicity holds at the database. The state machine is
// consulted first; illegal pairs return ErrIllegalTransition without a write.
func (r *Repository) UpdateStatus(ctx context.Context, id string, from, to Status, u StatusUpdate) error {
	if !CanTransition(from, to) {
		return fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}
	tag, err := r.db.Exec(ctx, `
		UPDATE provider_accounts SET
			status = $3,
			prior_status = COALESCE(NULLIF($4,''), prior_status),
			rejection_reason = CASE WHEN $5 <> '' THEN $5 ELSE rejection_reason END,
			submitted_at = COALESCE($6, submitted_at),
			approved_at = COALESCE($7, approved_at),
			tnc_accepted_at = COALESCE($8, tnc_accepted_at),
			updated_at = now()
		WHERE id = $1 AND status = $2`,
		id, string(from), string(to), string(u.PriorStatus), u.RejectionReason,
		u.SubmittedAt, u.ApprovedAt, u.TnCAcceptedAt)
	if err != nil {
		return fmt.Errorf("onboarding repo: update status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrStaleStatus
	}
	return nil
}

// UpsertWallet inserts a wallet or returns the existing one for (account, currency).
func (r *Repository) UpsertWallet(ctx context.Context, w *ProviderWallet) (*ProviderWallet, error) {
	var out ProviderWallet
	err := r.db.QueryRow(ctx, `
		INSERT INTO provider_wallets (provider_account_id, currency, provider_wallet_id)
		VALUES ($1,$2,$3)
		ON CONFLICT (provider_account_id, currency)
		DO UPDATE SET provider_wallet_id = EXCLUDED.provider_wallet_id
		RETURNING id, provider_account_id, currency, provider_wallet_id, created_at`,
		w.AccountID, w.Currency, w.ProviderWalletID).
		Scan(&out.ID, &out.AccountID, &out.Currency, &out.ProviderWalletID, &out.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: upsert wallet: %w", err)
	}
	return &out, nil
}

// UpsertFundingDetail stores funding instructions for a wallet, encrypting the
// account number (AAD = wallet id). Idempotent per (wallet, rail).
func (r *Repository) UpsertFundingDetail(ctx context.Context, f *FundingDetail) (*FundingDetail, error) {
	enc, err := r.cipher.Encrypt([]byte(f.AccountNumber), []byte(f.WalletID))
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: encrypt account number: %w", err)
	}
	var id string
	var created time.Time
	err = r.db.QueryRow(ctx, `
		INSERT INTO funding_details
			(id, wallet_id, currency, rail, account_name, account_number_enc, bank_code, bank_name, reference_rule)
		VALUES ($1,$2,$3,'default',$4,$5,$6,$7,$8)
		ON CONFLICT (wallet_id, rail) DO UPDATE SET
			currency = EXCLUDED.currency,
			account_name = EXCLUDED.account_name,
			account_number_enc = EXCLUDED.account_number_enc,
			bank_code = EXCLUDED.bank_code,
			bank_name = EXCLUDED.bank_name,
			reference_rule = EXCLUDED.reference_rule,
			updated_at = now()
		RETURNING id, created_at`,
		uuid.NewString(), f.WalletID, f.Currency, f.AccountName, enc, f.BankCode, f.BankName, f.Reference).
		Scan(&id, &created)
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: upsert funding detail: %w", err)
	}
	out := *f
	out.ID, out.CreatedAt = id, created
	return &out, nil
}

// ListFundingDetails returns a wallet's funding details with account numbers decrypted.
func (r *Repository) ListFundingDetails(ctx context.Context, walletID string) ([]FundingDetail, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, wallet_id, currency, account_name, account_number_enc, bank_code, bank_name, reference_rule, created_at
		FROM funding_details WHERE wallet_id = $1 ORDER BY created_at`, walletID)
	if err != nil {
		return nil, fmt.Errorf("onboarding repo: list funding details: %w", err)
	}
	defer rows.Close()
	var out []FundingDetail
	for rows.Next() {
		var f FundingDetail
		var enc string
		if err := rows.Scan(&f.ID, &f.WalletID, &f.Currency, &f.AccountName, &enc, &f.BankCode,
			&f.BankName, &f.Reference, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("onboarding repo: scan funding detail: %w", err)
		}
		pt, err := r.cipher.Decrypt(enc, []byte(f.WalletID))
		if err != nil {
			return nil, fmt.Errorf("onboarding repo: decrypt account number: %w", err)
		}
		f.AccountNumber = string(pt)
		out = append(out, f)
	}
	return out, rows.Err()
}

// RecordSubmission appends a submission attempt. documentsJSON must be valid JSON
// (nil is stored as an empty array). Idempotent per (account, version).
func (r *Repository) RecordSubmission(ctx context.Context, accountID string, version int, payloadRef string, documentsJSON []byte, result string) error {
	if len(documentsJSON) == 0 {
		documentsJSON = []byte("[]")
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO onboarding_submissions (provider_account_id, version, payload_ref, documents_json, result)
		VALUES ($1,$2,$3,$4::jsonb,$5)
		ON CONFLICT (provider_account_id, version) DO UPDATE SET result = EXCLUDED.result`,
		accountID, version, payloadRef, string(documentsJSON), result)
	if err != nil {
		return fmt.Errorf("onboarding repo: record submission: %w", err)
	}
	return nil
}

// RecordConsent appends an immutable consent record.
func (r *Repository) RecordConsent(ctx context.Context, c *Consent) error {
	doc := c.Document
	if doc == "" {
		doc = "tnc"
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO onboarding_consents (provider_account_id, document, tnc_version, accepted_at, ip, device)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		c.AccountID, doc, c.Version, c.AcceptedAt, c.IP, c.Device)
	if err != nil {
		return fmt.Errorf("onboarding repo: record consent: %w", err)
	}
	return nil
}
