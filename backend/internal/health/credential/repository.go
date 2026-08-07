package credential

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a record/doc does not exist.
var ErrNotFound = errors.New("credential: not found")

// Repository is the pgx data layer for verification records + credential-doc
// reads (with access logging). Parameterized queries only.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// CreateRecord inserts a PENDING verification record.
func (r *Repository) CreateRecord(ctx context.Context, rec *VerificationRecord) error {
	rec.ID = uuid.New().String()
	rec.CreatedAt = time.Now()
	const q = `
		INSERT INTO health_verification_records
		  (id, provider_application_id, capability, source, method, status, reg_number,
		   matched_fields, licence_expiry, reviewer_id, notes, evidence_doc_ids, consent_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
	_, err := r.db.Exec(ctx, q,
		rec.ID, rec.ProviderApplicationID, rec.Capability, string(rec.Source), string(rec.Method),
		string(rec.Status), rec.RegNumber, mapToJSON(rec.MatchedFields), rec.LicenceExpiry,
		rec.ReviewerID, rec.Notes, rec.EvidenceDocIDs, rec.ConsentAt, rec.CreatedAt)
	if err != nil {
		return fmt.Errorf("credential: insert record: %w", err)
	}
	return nil
}

func (r *Repository) scanRecord(row pgx.Row) (*VerificationRecord, error) {
	var rec VerificationRecord
	var src, method, status string
	var matched []byte
	if err := row.Scan(&rec.ID, &rec.ProviderApplicationID, &rec.Capability, &src, &method,
		&status, &rec.RegNumber, &matched, &rec.LicenceExpiry, &rec.ReviewerID, &rec.Notes,
		&rec.EvidenceDocIDs, &rec.ConsentAt, &rec.CreatedAt, &rec.DecidedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rec.Source, rec.Method, rec.Status = Source(src), Method(method), Status(status)
	rec.MatchedFields = jsonToMap(matched)
	return &rec, nil
}

const recordCols = `id, provider_application_id, capability, source, method, status, reg_number,
	matched_fields, licence_expiry, reviewer_id, notes, evidence_doc_ids, consent_at, created_at, decided_at`

// GetRecord fetches a record by id.
func (r *Repository) GetRecord(ctx context.Context, id string) (*VerificationRecord, error) {
	return r.scanRecord(r.db.QueryRow(ctx, `SELECT `+recordCols+` FROM health_verification_records WHERE id=$1`, id))
}

// LatestByApplication returns the most recent record for an application.
func (r *Repository) LatestByApplication(ctx context.Context, applicationID string) (*VerificationRecord, error) {
	return r.scanRecord(r.db.QueryRow(ctx,
		`SELECT `+recordCols+` FROM health_verification_records WHERE provider_application_id=$1 ORDER BY created_at DESC LIMIT 1`,
		applicationID))
}

// QueueItem is an admin-queue row: the record joined to its application.
type QueueItem struct {
	Record           *VerificationRecord `json:"record"`
	OwnerUserID      string              `json:"owner_user_id"`
	DisplayName      string              `json:"display_name"`
	ApplicationState string              `json:"application_state"`
	IdentityFlag     bool                `json:"identity_flag"`
}

// ListQueue returns verification records in a given status (default PENDING for
// the UNDER_REVIEW ops queue), newest first.
func (r *Repository) ListQueue(ctx context.Context, status Status, limit int) ([]QueueItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `
		SELECT v.id, v.provider_application_id, v.capability, v.source, v.method, v.status, v.reg_number,
		       v.matched_fields, v.licence_expiry, v.reviewer_id, v.notes, v.evidence_doc_ids, v.consent_at,
		       v.created_at, v.decided_at,
		       a.owner_user_id, a.display_name, a.state
		FROM health_verification_records v
		JOIN health_provider_applications a ON a.id = v.provider_application_id
		WHERE v.status=$1 AND a.provider_type='vet'
		ORDER BY v.created_at ASC
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, string(status), limit)
	if err != nil {
		return nil, fmt.Errorf("credential: list queue: %w", err)
	}
	defer rows.Close()
	var out []QueueItem
	for rows.Next() {
		var rec VerificationRecord
		var src, method, st string
		var matched []byte
		var it QueueItem
		if err := rows.Scan(&rec.ID, &rec.ProviderApplicationID, &rec.Capability, &src, &method, &st,
			&rec.RegNumber, &matched, &rec.LicenceExpiry, &rec.ReviewerID, &rec.Notes, &rec.EvidenceDocIDs,
			&rec.ConsentAt, &rec.CreatedAt, &rec.DecidedAt, &it.OwnerUserID, &it.DisplayName, &it.ApplicationState); err != nil {
			return nil, err
		}
		rec.Source, rec.Method, rec.Status = Source(src), Method(method), Status(st)
		rec.MatchedFields = jsonToMap(matched)
		it.Record = &rec
		it.IdentityFlag = hasIdentityFlag(rec.MatchedFields)
		out = append(out, it)
	}
	return out, rows.Err()
}

// DecideRecord atomically flips status ONLY from the expected `from` state
// (guarded transition at the DB: WHERE status=$from), setting the decision fields.
// Returns true iff exactly one row transitioned — so concurrent/duplicate
// decisions can never double-apply (idempotent + race-safe).
func (r *Repository) DecideRecord(ctx context.Context, id string, from, to Status, reviewerID, notes string, licenceExpiry *time.Time) (bool, error) {
	const q = `
		UPDATE health_verification_records
		SET status=$3, reviewer_id=$4, notes=$5, licence_expiry=COALESCE($6, licence_expiry), decided_at=now()
		WHERE id=$1 AND status=$2`
	ct, err := r.db.Exec(ctx, q, id, string(from), string(to), reviewerID, notes, licenceExpiry)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// DocRef is a credential doc joined with its owning application (for authZ).
type DocRef struct {
	ID            string
	ApplicationID string
	OwnerUserID   string
	CredType      string
	StorageKey    string
}

// GetDoc fetches a credential doc + its application owner (for object-level authZ
// at the admin/owner read boundary). Reuses the providers vault table.
func (r *Repository) GetDoc(ctx context.Context, docID string) (*DocRef, error) {
	const q = `
		SELECT d.id, d.application_id, a.owner_user_id, d.cred_type, d.storage_key
		FROM health_credential_docs d
		JOIN health_provider_applications a ON a.id = d.application_id
		WHERE d.id=$1`
	var d DocRef
	if err := r.db.QueryRow(ctx, q, docID).Scan(&d.ID, &d.ApplicationID, &d.OwnerUserID, &d.CredType, &d.StorageKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &d, nil
}

// LogDocAccess appends an immutable access-log row (NDPA: every doc read logged).
func (r *Repository) LogDocAccess(ctx context.Context, docID, accessorID, basis string) error {
	const q = `INSERT INTO health_credential_doc_access_log (id, doc_id, accessor_id, basis) VALUES ($1,$2,$3,$4)`
	_, err := r.db.Exec(ctx, q, uuid.New().String(), docID, accessorID, basis)
	return err
}

// SetLicenceExpiryOnDoc mirrors the licence expiry onto the ANNUAL_LICENCE doc so
// the existing providers.SuspendExpired HL-2 sweep auto-suspends on expiry.
func (r *Repository) SetLicenceExpiryOnDoc(ctx context.Context, applicationID string, expiry time.Time) error {
	const q = `UPDATE health_credential_docs SET expires_at=$2, verified=true
	           WHERE application_id=$1 AND cred_type='ANNUAL_LICENCE'`
	_, err := r.db.Exec(ctx, q, applicationID, expiry)
	return err
}

// AppMeta is the minimal application context the reviewer path needs (the owner,
// for the no-self-approve + object-level checks — not owner-scoped like the
// member GetApplication).
type AppMeta struct {
	OwnerUserID  string
	ProviderType string
	State        string
}

// GetApplicationMeta returns owner/type/state for an application id.
func (r *Repository) GetApplicationMeta(ctx context.Context, applicationID string) (*AppMeta, error) {
	var m AppMeta
	err := r.db.QueryRow(ctx,
		`SELECT owner_user_id, provider_type, state FROM health_provider_applications WHERE id=$1`, applicationID).
		Scan(&m.OwnerUserID, &m.ProviderType, &m.State)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

// ---- helpers ----

func normalizeName(s string) string {
	toks := strings.Fields(strings.ToLower(strings.TrimSpace(s)))
	sort.Strings(toks)
	return strings.Join(toks, " ")
}

func mapToJSON(m map[string]string) []byte {
	if m == nil {
		return []byte("{}")
	}
	var b strings.Builder
	b.WriteByte('{')
	first := true
	// stable order for deterministic output
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !first {
			b.WriteByte(',')
		}
		first = false
		b.WriteString(fmt.Sprintf("%q:%q", k, m[k]))
	}
	b.WriteByte('}')
	return []byte(b.String())
}

func jsonToMap(b []byte) map[string]string {
	m := map[string]string{}
	if len(b) == 0 {
		return m
	}
	// minimal flat string-map parse (values are our own controlled tokens)
	s := strings.TrimSpace(string(b))
	s = strings.TrimPrefix(s, "{")
	s = strings.TrimSuffix(s, "}")
	if s == "" {
		return m
	}
	for _, pair := range splitTopLevel(s) {
		kv := strings.SplitN(pair, ":", 2)
		if len(kv) != 2 {
			continue
		}
		m[unquote(kv[0])] = unquote(kv[1])
	}
	return m
}

func splitTopLevel(s string) []string { return strings.Split(s, ",") }
func unquote(s string) string         { return strings.Trim(strings.TrimSpace(s), `"`) }
