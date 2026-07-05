package maplerad

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx (service_role) data layer for the Maplerad domain. It
// owns the additive integration tables only:
//   - provider_customers   (1 user ↔ 1 provider customer)
//   - provider_reference   (client-ref idempotency + money-op state row)
//   - webhook_event        (event-id dedupe)
//   - reconciliation_drift (ledger-vs-custody quarantine)
//
// It NEVER touches the ledger tables (that is the ledger package's job) and
// NEVER UPDATEs a balance. Writes are service_role over the pgx pool.
type Repository struct {
	db       *pgxpool.Pool
	provider string // "maplerad"
}

// NewRepository builds the Maplerad repository over the shared pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db, provider: "maplerad"}
}

// ── provider_customers ───────────────────────────────────────────────────────

// CustomerRow is the persisted user↔provider-customer mapping.
type CustomerRow struct {
	UserID     string
	CustomerID string
	Status     string
}

// GetCustomer returns the provider customer mapping for a user, or
// (nil, nil) when none exists (so the service can create one).
func (r *Repository) GetCustomer(ctx context.Context, userID string) (*CustomerRow, error) {
	const q = `
		SELECT user_id, customer_id, status
		FROM provider_customers
		WHERE user_id = $1 AND provider = $2`
	var c CustomerRow
	err := r.db.QueryRow(ctx, q, userID, r.provider).Scan(&c.UserID, &c.CustomerID, &c.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("maplerad repo: get customer: %w", err)
	}
	return &c, nil
}

// InsertCustomer persists a user↔provider-customer mapping. Idempotent: on a
// (user_id, provider) conflict it returns the EXISTING row (re-entrant
// EnsureCustomer never creates a duplicate).
func (r *Repository) InsertCustomer(ctx context.Context, userID, customerID, status string) (*CustomerRow, error) {
	if status == "" {
		status = "active"
	}
	const ins = `
		INSERT INTO provider_customers (user_id, provider, customer_id, status)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, provider) DO NOTHING
		RETURNING user_id, customer_id, status`
	var c CustomerRow
	err := r.db.QueryRow(ctx, ins, userID, r.provider, customerID, status).
		Scan(&c.UserID, &c.CustomerID, &c.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost the race / already present — return the existing mapping.
		return r.GetCustomer(ctx, userID)
	}
	if err != nil {
		return nil, fmt.Errorf("maplerad repo: insert customer: %w", err)
	}
	return &c, nil
}

// ── provider_reference (money-op idempotency + state) ────────────────────────

// RefRow is the domain view of a provider_reference row.
type RefRow struct {
	Ref           string
	Provider      string
	ProviderRef   string
	OpType        string
	Status        OpStatus
	UserID        string
	AmountKobo    int64
	Currency      string
	Counterparty  map[string]string
	FailureReason string
}

// Counterparty for a transfer: bank_code, account_number_last4, account_name.
func counterpartyJSON(cp map[string]string) ([]byte, error) {
	if cp == nil {
		cp = map[string]string{}
	}
	return json.Marshal(cp)
}

// InsertReference persists a money-op reference at status INITIATED BEFORE the
// provider call. The `ref` column is UNIQUE: on conflict it returns the EXISTING
// row (and inserted=false) so a retry with the same ref is idempotent and the
// caller short-circuits to the stored outcome.
func (r *Repository) InsertReference(ctx context.Context, row RefRow) (stored *RefRow, inserted bool, err error) {
	cp, err := counterpartyJSON(row.Counterparty)
	if err != nil {
		return nil, false, fmt.Errorf("maplerad repo: marshal counterparty: %w", err)
	}
	const ins = `
		INSERT INTO provider_reference (ref, provider, op_type, status, user_id, amount_kobo, currency, counterparty)
		VALUES ($1, $2, $3, 'INITIATED', $4, $5, COALESCE(NULLIF($6,''),'NGN'), $7)
		ON CONFLICT (ref) DO NOTHING
		RETURNING ref, provider, COALESCE(provider_ref,''), op_type, status, COALESCE(user_id::text,''), COALESCE(amount_kobo,0), currency, COALESCE(failure_reason,'')`
	got, err := r.scanRef(r.db.QueryRow(ctx, ins,
		row.Ref, r.provider, row.OpType, row.UserID, row.AmountKobo, row.Currency, cp))
	if errors.Is(err, pgx.ErrNoRows) {
		// Existing ref — idempotent replay. Return the stored row.
		existing, gerr := r.GetByRef(ctx, row.Ref)
		if gerr != nil {
			return nil, false, gerr
		}
		return existing, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("maplerad repo: insert reference: %w", err)
	}
	return got, true, nil
}

// GetByRef returns a provider_reference row by client reference, or ErrNotFound.
func (r *Repository) GetByRef(ctx context.Context, ref string) (*RefRow, error) {
	const q = `
		SELECT ref, provider, COALESCE(provider_ref,''), op_type, status, COALESCE(user_id::text,''), COALESCE(amount_kobo,0), currency, COALESCE(failure_reason,'')
		FROM provider_reference
		WHERE ref = $1`
	got, err := r.scanRef(r.db.QueryRow(ctx, q, ref))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("maplerad repo: get by ref: %w", err)
	}
	return got, nil
}

// GetByProviderRef returns a provider_reference row by the provider-side
// reference (used to route inbound transfer webhooks), or ErrNotFound.
func (r *Repository) GetByProviderRef(ctx context.Context, providerRef string) (*RefRow, error) {
	const q = `
		SELECT ref, provider, COALESCE(provider_ref,''), op_type, status, COALESCE(user_id::text,''), COALESCE(amount_kobo,0), currency, COALESCE(failure_reason,'')
		FROM provider_reference
		WHERE provider = $1 AND provider_ref = $2
		LIMIT 1`
	got, err := r.scanRef(r.db.QueryRow(ctx, q, r.provider, providerRef))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("maplerad repo: get by provider_ref: %w", err)
	}
	return got, nil
}

// SetStatus advances a money-op's status and (optionally) records the
// provider_ref / failure_reason. The state-machine guard is applied by the
// service BEFORE this call; the repo just persists the new terminal/intermediate
// state. provider_reference rows are append-update only on the status column
// (the ledger remains the immutable source of truth).
func (r *Repository) SetStatus(ctx context.Context, ref string, status OpStatus, providerRef, failureReason string) error {
	const upd = `
		UPDATE provider_reference
		SET status = $2,
		    provider_ref = COALESCE(NULLIF($3,''), provider_ref),
		    failure_reason = COALESCE(NULLIF($4,''), failure_reason),
		    updated_at = NOW()
		WHERE ref = $1`
	ct, err := r.db.Exec(ctx, upd, ref, string(status), providerRef, failureReason)
	if err != nil {
		return fmt.Errorf("maplerad repo: set status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListPendingOlderThan returns PENDING money-op references whose last update is
// older than the TTL — orphan candidates for the sweep (re-query + transition).
func (r *Repository) ListPendingOlderThan(ctx context.Context, ttl time.Duration, limit int) ([]RefRow, error) {
	if limit <= 0 {
		limit = 200
	}
	cutoff := time.Now().Add(-ttl)
	const q = `
		SELECT ref, provider, COALESCE(provider_ref,''), op_type, status, COALESCE(user_id::text,''), COALESCE(amount_kobo,0), currency, COALESCE(failure_reason,'')
		FROM provider_reference
		WHERE provider = $1 AND status = 'PENDING' AND updated_at < $2
		ORDER BY updated_at ASC
		LIMIT $3`
	rows, err := r.db.Query(ctx, q, r.provider, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("maplerad repo: list pending: %w", err)
	}
	defer rows.Close()
	var out []RefRow
	for rows.Next() {
		var rr RefRow
		var status, cur string
		if err := rows.Scan(&rr.Ref, &rr.Provider, &rr.ProviderRef, &rr.OpType, &status, &rr.UserID, &rr.AmountKobo, &cur, &rr.FailureReason); err != nil {
			return nil, fmt.Errorf("maplerad repo: scan pending: %w", err)
		}
		rr.Status = OpStatus(status)
		rr.Currency = cur
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ListCustomers returns all user↔customer mappings (reconciliation walks them).
func (r *Repository) ListCustomers(ctx context.Context, limit int) ([]CustomerRow, error) {
	if limit <= 0 {
		limit = 500
	}
	const q = `SELECT user_id, customer_id, status FROM provider_customers WHERE provider = $1 LIMIT $2`
	rows, err := r.db.Query(ctx, q, r.provider, limit)
	if err != nil {
		return nil, fmt.Errorf("maplerad repo: list customers: %w", err)
	}
	defer rows.Close()
	var out []CustomerRow
	for rows.Next() {
		var c CustomerRow
		if err := rows.Scan(&c.UserID, &c.CustomerID, &c.Status); err != nil {
			return nil, fmt.Errorf("maplerad repo: scan customer: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) scanRef(row pgx.Row) (*RefRow, error) {
	var rr RefRow
	var status string
	if err := row.Scan(&rr.Ref, &rr.Provider, &rr.ProviderRef, &rr.OpType, &status, &rr.UserID, &rr.AmountKobo, &rr.Currency, &rr.FailureReason); err != nil {
		return nil, err
	}
	rr.Status = OpStatus(status)
	return &rr, nil
}

// ── webhook_event (dedupe store) ─────────────────────────────────────────────

// InsertWebhookEvent records a received webhook keyed by (provider, event_id).
// ON CONFLICT DO NOTHING → inserted=true on first delivery, false on a
// redelivery. The caller turns this into the pure DedupeDecision.
func (r *Repository) InsertWebhookEvent(ctx context.Context, eventID, eventType string, payload []byte) (inserted bool, err error) {
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	const ins = `
		INSERT INTO webhook_event (event_id, provider, type, payload, status)
		VALUES ($1, $2, $3, $4, 'received')
		ON CONFLICT (provider, event_id) DO NOTHING`
	ct, err := r.db.Exec(ctx, ins, eventID, r.provider, eventType, payload)
	if err != nil {
		return false, fmt.Errorf("maplerad repo: insert webhook event: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// MarkWebhookProcessed flips a deduped event to processed (status terminal).
func (r *Repository) MarkWebhookProcessed(ctx context.Context, eventID, status string) error {
	if status == "" {
		status = "processed"
	}
	const upd = `
		UPDATE webhook_event
		SET status = $3, processed_at = NOW()
		WHERE provider = $1 AND event_id = $2`
	_, err := r.db.Exec(ctx, upd, r.provider, eventID, status)
	if err != nil {
		return fmt.Errorf("maplerad repo: mark webhook processed: %w", err)
	}
	return nil
}

// ── reconciliation_drift (quarantine) ────────────────────────────────────────

// InsertDrift records a ledger-vs-custody mismatch immutably for human review.
// Drift is NEVER auto-corrected — resolution is a separate compensating ledger
// entry recorded out of band.
func (r *Repository) InsertDrift(ctx context.Context, scope, userID string, expectedKobo, providerKobo, diffKobo int64, note string) error {
	const ins = `
		INSERT INTO reconciliation_drift (provider, scope, user_id, expected_kobo, provider_kobo, diff_kobo, status, note)
		VALUES ($1, $2, NULLIF($3,'')::uuid, $4, $5, $6, 'open', $7)`
	_, err := r.db.Exec(ctx, ins, r.provider, scope, userID, expectedKobo, providerKobo, diffKobo, note)
	if err != nil {
		return fmt.Errorf("maplerad repo: insert drift: %w", err)
	}
	return nil
}
