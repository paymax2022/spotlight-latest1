package kycverify

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/platform/crypto"
)

// PIIStore is the encrypted-at-rest store for raw provider payloads (selfies,
// full bio-data, document images). Plaintext is AES-256-GCM sealed BEFORE it
// touches the DB; the check id is used as AES additional-authenticated-data
// (AAD) so a blob cannot be silently relinked to a different check. Access is
// service-role only (RLS denies authenticated/anon on kyc_pii_blob).
//
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
		return "", fmt.Errorf("kycverify: PII encryption key not configured — refusing to store raw payload")
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
		return nil, fmt.Errorf("kycverify: PII encryption key not configured")
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

// ── Consent repository (NDPA / CBN) ──────────────────────────────────────────

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
