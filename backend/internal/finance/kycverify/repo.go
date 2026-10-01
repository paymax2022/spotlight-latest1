package kycverify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/platform/crypto"
	"spotlight/backend/internal/provider"
)

// Repository is the pgx (service_role) data layer for the KYC verification
// domain. It owns the additive verification tables only:
//   - verification_session   (one per user tier-upgrade attempt)
//   - verification_check      (normalized per-check result; UNIQUE client_ref)
//   - kyc_routing_rule        (admin-editable capability routing)
//   - webhook_event           (event-id dedupe, REUSED across providers)
//
// It NEVER touches user_profiles balances or the ledger. Writes are service_role
// over the pgx pool. Consent + PII live in their own stores in this file.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the KYC verification repository over the shared pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// CreateSession inserts a new session at UNVERIFIED and returns it.
func (r *Repository) CreateSession(ctx context.Context, userID string, targetTier int) (*Session, error) {
	const ins = `
		INSERT INTO verification_session (user_id, target_tier, status)
		VALUES ($1::uuid, $2, 'UNVERIFIED')
		RETURNING id, user_id::text, target_tier, status, created_at, updated_at`
	var s Session
	var status string
	err := r.db.QueryRow(ctx, ins, userID, targetTier).
		Scan(&s.ID, &s.UserID, &s.TargetTier, &status, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: create session: %w", err)
	}
	s.Status = SessionStatus(status)
	return &s, nil
}

// GetSession returns a session by id, or ErrNotFound.
func (r *Repository) GetSession(ctx context.Context, id string) (*Session, error) {
	const q = `
		SELECT id, user_id::text, target_tier, status, created_at, updated_at
		FROM verification_session WHERE id = $1`
	var s Session
	var status string
	err := r.db.QueryRow(ctx, q, id).
		Scan(&s.ID, &s.UserID, &s.TargetTier, &status, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: get session: %w", err)
	}
	s.Status = SessionStatus(status)
	return &s, nil
}

// UpdateSessionStatus persists a new session status. The guarded transition is
// applied by the orchestrator BEFORE this call.
func (r *Repository) UpdateSessionStatus(ctx context.Context, id string, status SessionStatus) error {
	const upd = `UPDATE verification_session SET status = $2, updated_at = NOW() WHERE id = $1`
	ct, err := r.db.Exec(ctx, upd, id, string(status))
	if err != nil {
		return fmt.Errorf("kycverify repo: update session status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// InsertCheck idempotently creates a check row keyed by client_ref. On a
// client_ref conflict it returns the EXISTING row with inserted=false (a retry
// with the same idempotency key never double-runs the provider). New rows land at
// status INITIATED.
func (r *Repository) InsertCheck(ctx context.Context, ch Check) (stored *Check, inserted bool, err error) {
	const ins = `
		INSERT INTO verification_check (session_id, user_id, type, client_ref, status)
		VALUES ($1::uuid, $2::uuid, $3, $4, 'INITIATED')
		ON CONFLICT (client_ref) DO NOTHING
		RETURNING id`
	var id string
	err = r.db.QueryRow(ctx, ins, ch.SessionID, ch.UserID, string(ch.Type), ch.ClientRef).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Existing client_ref — idempotent replay. Return the stored row.
		existing, gerr := r.GetCheckByClientRef(ctx, ch.ClientRef)
		if gerr != nil {
			return nil, false, gerr
		}
		return existing, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("kycverify repo: insert check: %w", err)
	}
	got, gerr := r.GetCheck(ctx, id)
	if gerr != nil {
		return nil, false, gerr
	}
	return got, true, nil
}

// UpdateCheckResult persists the normalized outcome of a check (provider, status,
// match/confidence, extracted fields, reason, PII ref). The status guard is
// applied by the service/orchestrator BEFORE this call.
func (r *Repository) UpdateCheckResult(ctx context.Context, ch *Check) error {
	fields, err := json.Marshal(nonNilMap(ch.ExtractedFields))
	if err != nil {
		return fmt.Errorf("kycverify repo: marshal extracted fields: %w", err)
	}
	const upd = `
		UPDATE verification_check
		SET provider        = NULLIF($2,''),
		    provider_ref     = NULLIF($3,''),
		    status           = $4,
		    match            = $5,
		    confidence       = $6,
		    extracted_fields = $7::jsonb,
		    reason           = NULLIF($8,''),
		    raw_payload_ref  = NULLIF($9,'')::uuid,
		    updated_at       = NOW()
		WHERE id = $1`
	ct, err := r.db.Exec(ctx, upd,
		ch.ID, ch.Provider, ch.ProviderRef, string(ch.Status), ch.Match, ch.Confidence,
		fields, ch.Reason, ch.RawPayloadRef)
	if err != nil {
		return fmt.Errorf("kycverify repo: update check result: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetCheckStatus advances just the status column (used by admin review resolve
// and webhook terminal transitions). The guard is applied by the caller.
func (r *Repository) SetCheckStatus(ctx context.Context, id string, status provider.KycCheckStatus, reason string) error {
	const upd = `
		UPDATE verification_check
		SET status = $2, reason = COALESCE(NULLIF($3,''), reason), updated_at = NOW()
		WHERE id = $1`
	ct, err := r.db.Exec(ctx, upd, id, string(status), reason)
	if err != nil {
		return fmt.Errorf("kycverify repo: set check status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetCheck returns a check by id, or ErrNotFound.
func (r *Repository) GetCheck(ctx context.Context, id string) (*Check, error) {
	return r.scanCheckRow(r.db.QueryRow(ctx, checkSelect+` WHERE id = $1`, id))
}

// GetCheckByClientRef returns a check by its idempotency key, or ErrNotFound.
func (r *Repository) GetCheckByClientRef(ctx context.Context, clientRef string) (*Check, error) {
	return r.scanCheckRow(r.db.QueryRow(ctx, checkSelect+` WHERE client_ref = $1`, clientRef))
}

// ListChecksForSession returns all checks for a session (creation order).
func (r *Repository) ListChecksForSession(ctx context.Context, sessionID string) ([]Check, error) {
	rows, err := r.db.Query(ctx, checkSelect+` WHERE session_id = $1 ORDER BY created_at ASC`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: list checks: %w", err)
	}
	defer rows.Close()
	return r.scanChecks(rows)
}

// StatusByType returns the best-known status per check type for a session. When a
// type has multiple checks (retries), the most recent status wins.
func (r *Repository) StatusByType(ctx context.Context, sessionID string) (map[provider.KycCheckType]provider.KycCheckStatus, error) {
	const q = `
		SELECT DISTINCT ON (type) type, status
		FROM verification_check
		WHERE session_id = $1
		ORDER BY type, created_at DESC`
	rows, err := r.db.Query(ctx, q, sessionID)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: status by type: %w", err)
	}
	defer rows.Close()
	out := map[provider.KycCheckType]provider.KycCheckStatus{}
	for rows.Next() {
		var t, st string
		if err := rows.Scan(&t, &st); err != nil {
			return nil, fmt.Errorf("kycverify repo: scan status by type: %w", err)
		}
		out[provider.KycCheckType(t)] = provider.KycCheckStatus(st)
	}
	return out, rows.Err()
}

// ListReviewQueue returns sessions currently awaiting human review, most recent
// first. A session is in the queue when its status is NEEDS_REVIEW.
func (r *Repository) ListReviewQueue(ctx context.Context, limit, offset int) ([]Session, error) {
	if limit <= 0 {
		limit = 100
	}
	const q = `
		SELECT id, user_id::text, target_tier, status, created_at, updated_at
		FROM verification_session
		WHERE status = 'NEEDS_REVIEW'
		ORDER BY updated_at ASC
		LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: list review queue: %w", err)
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var s Session
		var status string
		if err := rows.Scan(&s.ID, &s.UserID, &s.TargetTier, &status, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("kycverify repo: scan review session: %w", err)
		}
		s.Status = SessionStatus(status)
		out = append(out, s)
	}
	return out, rows.Err()
}

// LoadRoutingTable reads all enabled routing rules into a RoutingTable, falling
// back to the ADR default for any check type with no row.
func (r *Repository) LoadRoutingTable(ctx context.Context) (RoutingTable, error) {
	const q = `SELECT check_type, ordered_providers, threshold, enabled FROM kyc_routing_rule`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: load routing: %w", err)
	}
	defer rows.Close()
	t := DefaultRoutingTable()
	for rows.Next() {
		var ct string
		var order []string
		var threshold int
		var enabled bool
		if err := rows.Scan(&ct, &order, &threshold, &enabled); err != nil {
			return nil, fmt.Errorf("kycverify repo: scan routing: %w", err)
		}
		t[provider.KycCheckType(ct)] = RoutingRule{
			CheckType:        provider.KycCheckType(ct),
			OrderedProviders: order,
			Threshold:        threshold,
			Enabled:          enabled,
		}
	}
	return t, rows.Err()
}

// UpsertRoutingRule persists an admin edit to a routing rule (additive: the row
// always exists from the seed migration, so this is an UPDATE).
func (r *Repository) UpsertRoutingRule(ctx context.Context, rule RoutingRule) error {
	const up = `
		INSERT INTO kyc_routing_rule (check_type, ordered_providers, threshold, enabled, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (check_type) DO UPDATE SET
			ordered_providers = EXCLUDED.ordered_providers,
			threshold         = EXCLUDED.threshold,
			enabled           = EXCLUDED.enabled,
			updated_at        = NOW()`
	_, err := r.db.Exec(ctx, up, string(rule.CheckType), rule.OrderedProviders, rule.Threshold, rule.Enabled)
	if err != nil {
		return fmt.Errorf("kycverify repo: upsert routing rule: %w", err)
	}
	return nil
}

// ListRoutingRules returns every routing rule row for the admin console.
func (r *Repository) ListRoutingRules(ctx context.Context) ([]RoutingRule, error) {
	const q = `SELECT check_type, ordered_providers, threshold, enabled FROM kyc_routing_rule ORDER BY check_type`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: list routing rules: %w", err)
	}
	defer rows.Close()
	var out []RoutingRule
	for rows.Next() {
		var ct string
		var rule RoutingRule
		if err := rows.Scan(&ct, &rule.OrderedProviders, &rule.Threshold, &rule.Enabled); err != nil {
			return nil, fmt.Errorf("kycverify repo: scan routing rule: %w", err)
		}
		rule.CheckType = provider.KycCheckType(ct)
		out = append(out, rule)
	}
	return out, rows.Err()
}

// InsertWebhookEvent records a received webhook keyed by (provider, event_id).
// ON CONFLICT DO NOTHING → inserted=true on first delivery, false on redelivery.
func (r *Repository) InsertWebhookEvent(ctx context.Context, providerName, eventID, eventType string, payload []byte) (inserted bool, err error) {
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	const ins = `
		INSERT INTO webhook_event (event_id, provider, type, payload, status)
		VALUES ($1, $2, $3, $4, 'received')
		ON CONFLICT (provider, event_id) DO NOTHING`
	ct, err := r.db.Exec(ctx, ins, eventID, providerName, eventType, payload)
	if err != nil {
		return false, fmt.Errorf("kycverify repo: insert webhook event: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// MarkWebhookProcessed flips a deduped event to a terminal processing status.
func (r *Repository) MarkWebhookProcessed(ctx context.Context, providerName, eventID, status string) error {
	if status == "" {
		status = "processed"
	}
	const upd = `
		UPDATE webhook_event SET status = $3, processed_at = NOW()
		WHERE provider = $1 AND event_id = $2`
	_, err := r.db.Exec(ctx, upd, providerName, eventID, status)
	if err != nil {
		return fmt.Errorf("kycverify repo: mark webhook processed: %w", err)
	}
	return nil
}

const checkSelect = `
	SELECT id, session_id::text, user_id::text, type, COALESCE(provider,''),
	       COALESCE(provider_ref,''), client_ref, status, COALESCE(match,false),
	       COALESCE(confidence,0)::float8, extracted_fields, COALESCE(reason,''),
	       COALESCE(raw_payload_ref::text,''), created_at, updated_at
	FROM verification_check`

func (r *Repository) scanCheckRow(row pgx.Row) (*Check, error) {
	ch, err := scanCheck(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("kycverify repo: scan check: %w", err)
	}
	return ch, nil
}

func (r *Repository) scanChecks(rows pgx.Rows) ([]Check, error) {
	var out []Check
	for rows.Next() {
		ch, err := scanCheck(rows)
		if err != nil {
			return nil, fmt.Errorf("kycverify repo: scan check row: %w", err)
		}
		out = append(out, *ch)
	}
	return out, rows.Err()
}

// scanCheck reads a verification_check row (matching checkSelect column order).
func scanCheck(row pgx.Row) (*Check, error) {
	var ch Check
	var typ, status string
	var fields []byte
	if err := row.Scan(
		&ch.ID, &ch.SessionID, &ch.UserID, &typ, &ch.Provider,
		&ch.ProviderRef, &ch.ClientRef, &status, &ch.Match,
		&ch.Confidence, &fields, &ch.Reason,
		&ch.RawPayloadRef, &ch.CreatedAt, &ch.UpdatedAt,
	); err != nil {
		return nil, err
	}
	ch.Type = provider.KycCheckType(typ)
	ch.Status = provider.KycCheckStatus(status)
	if len(fields) > 0 {
		_ = json.Unmarshal(fields, &ch.ExtractedFields)
	}
	return &ch, nil
}

func nonNilMap(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

// PIIStore is the encrypted-at-rest store for raw provider payloads (selfies,
// full bio-data, document images). Plaintext is AES-256-GCM sealed BEFORE it
// touches the DB; the check id is used as AES additional-authenticated-data
// (AAD) so a blob cannot be silently relinked to a different check. Access is
// service-role only (RLS denies authenticated/anon on kyc_pii_blob).
// NOTHING here logs plaintext. The store never returns plaintext except via an
// explicit, audited Decrypt path used only by privileged reviewers.
type PIIStore struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewPIIStore builds the encrypted PII store. cipher may be nil when
// KYC_PII_ENC_KEY is unset — in that case Put returns an error (fail-closed: we
// never persist raw PII in the clear).
func NewPIIStore(db *pgxpool.Pool, cipher *crypto.Cipher) *PIIStore {
	return &PIIStore{db: db, cipher: cipher}
}

// Put seals raw plaintext with the check id as AAD and inserts one kyc_pii_blob
// row, returning its ref (UUID) for verification_check.raw_payload_ref. An empty
// payload stores nothing and returns "". A nil cipher is a fail-closed error.
func (s *PIIStore) Put(ctx context.Context, checkID, userID, providerName string, raw []byte) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	if s.cipher == nil {
		return "", errors.New("kycverify: PII encryption key not configured — refusing to store raw payload")
	}
	ct, err := s.cipher.Encrypt(raw, []byte(checkID))
	if err != nil {
		return "", fmt.Errorf("kycverify: seal PII blob: %w", err)
	}
	const ins = `
		INSERT INTO kyc_pii_blob (check_id, user_id, provider, ciphertext)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, $3, $4)
		RETURNING ref`
	var ref string
	if err := s.db.QueryRow(ctx, ins, checkID, userID, providerName, ct).Scan(&ref); err != nil {
		return "", fmt.Errorf("kycverify: insert PII blob: %w", err)
	}
	return ref, nil
}

// Get decrypts a stored blob by ref. checkID must equal the AAD used at Put time.
// Privileged (reviewer) path only; callers MUST emit an audit event on every
// read. Never log the returned plaintext.
func (s *PIIStore) Get(ctx context.Context, ref, checkID string) ([]byte, error) {
	if s.cipher == nil {
		return nil, errors.New("kycverify: PII encryption key not configured")
	}
	const q = `SELECT ciphertext FROM kyc_pii_blob WHERE ref = $1`
	var ciphertext string
	if err := s.db.QueryRow(ctx, q, ref).Scan(&ciphertext); err != nil {
		return nil, fmt.Errorf("kycverify: read PII blob: %w", err)
	}
	pt, err := s.cipher.Decrypt(ciphertext, []byte(checkID))
	if err != nil {
		return nil, fmt.Errorf("kycverify: open PII blob: %w", err)
	}
	return pt, nil
}

// ConsentStore records and checks NDPA/CBN consent. Consent is REQUIRED before
// any check runs; the service enforces the gate and this store is its ground
// truth (immutable append-only rows).
type ConsentStore struct {
	db *pgxpool.Pool
}

// NewConsentStore builds the consent repository over the pgx pool.
func NewConsentStore(db *pgxpool.Pool) *ConsentStore {
	return &ConsentStore{db: db}
}

// Record appends an immutable consent row and returns it. Consent rows are never
// updated or deleted (audit trail).
func (c *ConsentStore) Record(ctx context.Context, userID, scope, version, ip string) (*Consent, error) {
	const ins = `
		INSERT INTO kyc_consent (user_id, scope, version, ip)
		VALUES ($1::uuid, $2, $3, NULLIF($4,''))
		RETURNING id, user_id, scope, version, granted_at, COALESCE(ip,'')`
	var out Consent
	err := c.db.QueryRow(ctx, ins, userID, scope, version, ip).
		Scan(&out.ID, &out.UserID, &out.Scope, &out.Version, &out.GrantedAt, &out.IP)
	if err != nil {
		return nil, fmt.Errorf("kycverify: record consent: %w", err)
	}
	return &out, nil
}

// HasConsent reports whether the user has any active consent covering scope. A
// blank scope matches any consent (i.e. "has the user consented at all"). This
// is the gate consulted before every check.
func (c *ConsentStore) HasConsent(ctx context.Context, userID, scope string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM kyc_consent
			WHERE user_id = $1::uuid
			  AND ($2 = '' OR scope = $2)
		)`
	var ok bool
	if err := c.db.QueryRow(ctx, q, userID, scope).Scan(&ok); err != nil {
		return false, fmt.Errorf("kycverify: check consent: %w", err)
	}
	return ok, nil
}

// List returns a user's consent records (most recent first) for the member view.
func (c *ConsentStore) List(ctx context.Context, userID string) ([]Consent, error) {
	const q = `
		SELECT id, user_id, scope, version, granted_at, COALESCE(ip,'')
		FROM kyc_consent
		WHERE user_id = $1::uuid
		ORDER BY granted_at DESC`
	rows, err := c.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("kycverify: list consent: %w", err)
	}
	defer rows.Close()
	var out []Consent
	for rows.Next() {
		var k Consent
		if err := rows.Scan(&k.ID, &k.UserID, &k.Scope, &k.Version, &k.GrantedAt, &k.IP); err != nil {
			return nil, fmt.Errorf("kycverify: scan consent: %w", err)
		}
		out = append(out, k)
	}
	return out, rows.Err()
}
