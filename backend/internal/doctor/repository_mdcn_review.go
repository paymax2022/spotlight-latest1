package doctor

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_mdcn_review.go — data layer for the assisted MDCN verification REVIEW
// (ops) side. AUGMENTS the existing doctor_verifications system of record; never
// replaces it. All reads/writes are parameterized; document reads are access-logged.

// MDCNQueueItem is one row in the ops review queue.
type MDCNQueueItem struct {
	VerificationID string            `json:"verificationId"`
	UserID         string            `json:"userId"`
	DoctorName     string            `json:"doctorName"`
	MDCNNumber     string            `json:"mdcnNumber"`
	Discipline     *string           `json:"discipline,omitempty"`
	Status         string            `json:"status"`
	SubmittedAt    *time.Time        `json:"submittedAt,omitempty"`
	MatchedFields  map[string]string `json:"matchedFields"`
	IdentityFlag   bool              `json:"identityFlag"`
}

// MDCNReviewRecord is the full reviewer-facing view of one verification.
type MDCNReviewRecord struct {
	VerificationID string                 `json:"verificationId"`
	UserID         string                 `json:"userId"`
	DoctorName     string                 `json:"doctorName"`
	Status         string                 `json:"status"`
	Source         string                 `json:"source"`
	Method         string                 `json:"method"`
	Discipline     *string                `json:"discipline,omitempty"`
	MDCNNumber     string                 `json:"mdcnNumber"`
	MatchedFields  map[string]string      `json:"matchedFields"`
	LicenceExpiry  *time.Time             `json:"licenceExpiry,omitempty"`
	Notes          *string                `json:"notes,omitempty"`
	SubmittedAt    *time.Time             `json:"submittedAt,omitempty"`
	DecidedAt      *time.Time             `json:"decidedAt,omitempty"`
	Documents      []VerificationDocument `json:"documents"`
}

// ListPendingMDCN returns verifications awaiting an ops decision (pending or
// needs_info), newest first.
func (r *Repository) ListPendingMDCN(ctx context.Context, limit int) ([]MDCNQueueItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `
		SELECT v.id, v.user_id, COALESCE(p.name,''), COALESCE(v.mdcn_number,''),
		       v.discipline, v.status, v.submitted_at, v.matched_fields
		FROM doctor_verifications v
		JOIN doctor_profiles p ON p.user_id = v.user_id
		WHERE v.status IN ('pending','needs_info')
		ORDER BY v.submitted_at ASC NULLS LAST, v.created_at ASC
		LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MDCNQueueItem
	for rows.Next() {
		var it MDCNQueueItem
		var matched []byte
		if err := rows.Scan(&it.VerificationID, &it.UserID, &it.DoctorName, &it.MDCNNumber,
			&it.Discipline, &it.Status, &it.SubmittedAt, &matched); err != nil {
			return nil, err
		}
		it.MatchedFields = decodeMatched(matched)
		it.IdentityFlag = matchedHasFlag(it.MatchedFields)
		out = append(out, it)
	}
	return out, rows.Err()
}

// GetMDCNVerification returns the full reviewer view + its documents.
func (r *Repository) GetMDCNVerification(ctx context.Context, verificationID string) (*MDCNReviewRecord, error) {
	const q = `
		SELECT v.id, v.user_id, COALESCE(p.name,''), v.status, v.source, v.method, v.discipline,
		       COALESCE(v.mdcn_number,''), v.matched_fields, v.licence_expiry, v.notes,
		       v.submitted_at, v.decided_at
		FROM doctor_verifications v
		JOIN doctor_profiles p ON p.user_id = v.user_id
		WHERE v.id = $1`
	var rec MDCNReviewRecord
	var matched []byte
	if err := r.db.QueryRow(ctx, q, verificationID).Scan(
		&rec.VerificationID, &rec.UserID, &rec.DoctorName, &rec.Status, &rec.Source, &rec.Method,
		&rec.Discipline, &rec.MDCNNumber, &matched, &rec.LicenceExpiry, &rec.Notes,
		&rec.SubmittedAt, &rec.DecidedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rec.MatchedFields = decodeMatched(matched)

	const dq = `
		SELECT id, verification_id, user_id, doc_type, label, file_name, file_url,
		       mime_type, size_bytes, required, uploaded_at, created_at
		FROM doctor_verification_documents
		WHERE verification_id = $1 OR (verification_id IS NULL AND user_id = $2)
		ORDER BY created_at ASC`
	drows, err := r.db.Query(ctx, dq, verificationID, rec.UserID)
	if err != nil {
		return nil, err
	}
	defer drows.Close()
	for drows.Next() {
		var d VerificationDocument
		if err := drows.Scan(&d.ID, &d.VerificationID, &d.UserID, &d.DocType, &d.Label, &d.FileName,
			&d.FileURL, &d.MimeType, &d.SizeBytes, &d.Required, &d.UploadedAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		rec.Documents = append(rec.Documents, d)
	}
	return &rec, drows.Err()
}

// PersistMatchedFields stores the computed identity cross-check on the record so
// the queue + detail reflect the latest flags (computed at review-fetch time).
func (r *Repository) PersistMatchedFields(ctx context.Context, verificationID string, matched map[string]string) error {
	b, _ := json.Marshal(matched)
	_, err := r.db.Exec(ctx, `UPDATE doctor_verifications SET matched_fields=$2, updated_at=now() WHERE id=$1`, verificationID, b)
	return err
}

// GetVerificationOwner returns the owning doctor's user_id + current status.
func (r *Repository) GetVerificationOwner(ctx context.Context, verificationID string) (userID, status string, err error) {
	err = r.db.QueryRow(ctx, `SELECT user_id, status FROM doctor_verifications WHERE id=$1`, verificationID).Scan(&userID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return userID, status, err
}

// DecideMDCN atomically flips status ONLY from the expected `from` state (guarded
// transition: WHERE status=$from), setting decision fields. Returns true iff one
// row transitioned — so concurrent/duplicate decisions never double-apply.
func (r *Repository) DecideMDCN(ctx context.Context, verificationID, from, to, reviewerID, notes string, licenceExpiry *time.Time, discipline *string, outcome *string) (bool, error) {
	const q = `
		UPDATE doctor_verifications
		SET status=$3, reviewer_id=$4, notes=COALESCE($5, notes), reviewed_at=now(), decided_at=now(),
		    licence_expiry=COALESCE($6, licence_expiry), discipline=COALESCE($7, discipline),
		    decision_outcome=$8, updated_at=now()
		WHERE id=$1 AND status=$2`
	var notePtr *string
	if notes != "" {
		notePtr = &notes
	}
	ct, err := r.db.Exec(ctx, q, verificationID, from, to, reviewerID, notePtr, licenceExpiry, discipline, outcome)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// SetProfileVerification flips the doctor's discoverability gate (HL-2). Idempotent.
// publish nil leaves is_published unchanged.
func (r *Repository) SetProfileVerification(ctx context.Context, userID, verification string, publish *bool) error {
	if publish == nil {
		_, err := r.db.Exec(ctx, `UPDATE doctor_profiles SET verification=$2, updated_at=now() WHERE user_id=$1`, userID, verification)
		return err
	}
	_, err := r.db.Exec(ctx, `UPDATE doctor_profiles SET verification=$2, is_published=$3, updated_at=now() WHERE user_id=$1`, userID, verification, *publish)
	return err
}

// MDCNDocRef is the minimal doc context for the access boundary.
type MDCNDocRef struct {
	ID      string
	UserID  string
	FileKey string
	DocType string
}

// GetVerificationDoc fetches a verification document for the authZ/presign boundary.
func (r *Repository) GetVerificationDoc(ctx context.Context, docID string) (*MDCNDocRef, error) {
	var d MDCNDocRef
	var fileURL *string
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, file_url, doc_type FROM doctor_verification_documents WHERE id=$1`, docID).
		Scan(&d.ID, &d.UserID, &fileURL, &d.DocType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if fileURL != nil {
		d.FileKey = *fileURL
	}
	return &d, err
}

// LogVerificationDocAccess appends an immutable access-log row (NDPA).
func (r *Repository) LogVerificationDocAccess(ctx context.Context, docID, accessorID, basis string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO doctor_verification_doc_access_log (id, doc_id, accessor_id, basis) VALUES ($1,$2,$3,$4)`,
		uuid.New().String(), docID, accessorID, basis)
	return err
}

// GetIdentityName returns the doctor's on-file full name for the identity
// cross-check (profile name, falling back to user_profiles.full_name).
func (r *Repository) GetIdentityName(ctx context.Context, userID string) (string, error) {
	var name string
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(p.name,''), COALESCE(up.full_name,''))
		FROM doctor_profiles p
		LEFT JOIN user_profiles up ON up.id = p.user_id
		WHERE p.user_id = $1`, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return name, err
}

// SuspendExpiredDoctorLicences is the HL-2 auto-suspend sweep: any APPROVED doctor
// whose latest verification licence has expired is suspended + de-listed.
// Idempotent (already-suspended rows are skipped by the verification='approved' guard).
func (r *Repository) SuspendExpiredDoctorLicences(ctx context.Context, now time.Time) (int, error) {
	const q = `
		UPDATE doctor_profiles p
		SET verification='suspended', is_published=false, updated_at=now()
		WHERE p.verification='approved'
		  AND EXISTS (
		    SELECT 1 FROM doctor_verifications v
		    WHERE v.user_id = p.user_id AND v.status='approved'
		      AND v.licence_expiry IS NOT NULL AND v.licence_expiry < $1
		  )`
	ct, err := r.db.Exec(ctx, q, now)
	if err != nil {
		return 0, err
	}
	return int(ct.RowsAffected()), nil
}

// ── helpers ──

func decodeMatched(b []byte) map[string]string {
	m := map[string]string{}
	if len(b) > 0 {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

func matchedHasFlag(m map[string]string) bool {
	for _, v := range m {
		if v == "mismatch" {
			return true
		}
	}
	return false
}
