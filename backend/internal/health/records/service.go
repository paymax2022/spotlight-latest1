package healthrecords

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// ConsentChecker is the HL-8 cross-vertical gate — satisfied by health/consent.
// It returns the matching active consent id when a non-owner may read.
type ConsentChecker interface {
	HasActiveGrant(ctx context.Context, granteeID, subjectOwnerID, scope string) (string, bool, error)
}

// Record is patient/pet vault metadata. The clinical body is minimised; binary
// documents live in R2 and are exposed only as signed-URL refs (HL-8).
type Record struct {
	ID          string     `json:"id"`
	SubjectType string     `json:"subject_type"` // PATIENT | PET
	OwnerUserID string     `json:"owner_user_id"`
	PetRef      *string    `json:"pet_ref,omitempty"`
	RecordType  string     `json:"record_type"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	Erased      bool       `json:"erased"`
	CreatedBy   *string    `json:"created_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	Docs        []Document `json:"docs,omitempty"`
}

// Document is a signed-URL ref to an R2 object — never an inlined blob (HL-8).
type Document struct {
	ID          string    `json:"id"`
	RecordID    string    `json:"record_id"`
	StorageKey  string    `json:"-"` // never serialised raw; resolved to a signed URL on read
	SignedURL   string    `json:"signed_url,omitempty"`
	ContentType string    `json:"content_type"`
	Label       string    `json:"label"`
	CreatedAt   time.Time `json:"created_at"`
}

// Signer turns an R2 storage key into a short-lived signed URL (HL-8 delivery).
// Satisfied by the existing presigned-URL helper; nil leaves SignedURL empty.
type Signer interface {
	SignGet(ctx context.Context, storageKey string) (string, error)
}

// Service is the NDPA-controlled vault. EVERY read goes through Get, which (a)
// enforces object-level authZ / consent (HL-8), (b) appends an immutable access
// log row (HL-8/HL-12) BEFORE returning data, and (c) resolves documents to signed
// URLs only. Raw storage keys and bodies are never logged.
type Service struct {
	db      *pgxpool.Pool
	consent ConsentChecker
	signer  Signer
	audit   Auditor
}

func NewService(db *pgxpool.Pool, consent ConsentChecker, signer Signer, audit Auditor) *Service {
	return &Service{db: db, consent: consent, signer: signer, audit: audit}
}

// Create writes a record for ownerID. createdBy may be a clinician acting on the
// subject's behalf; ownerID is always the data subject (object-level authZ anchor).
func (s *Service) Create(ctx context.Context, ownerID, createdBy, subjectType, recordType, title, body string, petRef *string) (*Record, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("records: owner required")
	}
	if subjectType != "PATIENT" && subjectType != "PET" {
		return nil, fmt.Errorf("records: invalid subject_type")
	}
	r := &Record{
		ID:          uuid.New().String(),
		SubjectType: subjectType,
		OwnerUserID: ownerID,
		PetRef:      petRef,
		RecordType:  recordType,
		Title:       title,
		Body:        body,
		CreatedAt:   time.Now(),
	}
	var cb any
	if createdBy != "" {
		cb = createdBy
		r.CreatedBy = &createdBy
	}
	const ins = `
		INSERT INTO health_records (id, subject_type, owner_user_id, pet_ref, record_type, title, body, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, ins, r.ID, r.SubjectType, r.OwnerUserID, petRef, r.RecordType, r.Title, r.Body, cb); err != nil {
		return nil, fmt.Errorf("records: insert: %w", err)
	}
	// HL-8: do NOT log body/title (PII). Only id + type.
	s.audited(createdBy, ownerID, "health.record.create", r.ID, nil,
		map[string]any{"record_type": recordType, "subject_type": subjectType})
	return r, nil
}

// AddDocument attaches a signed-URL ref. The blob must already be in R2 (HL-8 —
// the vault never stores blobs).
func (s *Service) AddDocument(ctx context.Context, accessorID, recordID, storageKey, contentType, label string) (*Document, error) {
	owner, _, err := s.recordOwner(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if owner != accessorID { // only the data subject attaches docs to own record
		return nil, fmt.Errorf("records: forbidden")
	}
	if storageKey == "" {
		return nil, fmt.Errorf("records: storage_key required")
	}
	d := &Document{ID: uuid.New().String(), RecordID: recordID, StorageKey: storageKey, ContentType: contentType, Label: label, CreatedAt: time.Now()}
	if d.ContentType == "" {
		d.ContentType = "application/pdf"
	}
	const ins = `INSERT INTO health_record_docs (id, record_id, storage_key, content_type, label) VALUES ($1,$2,$3,$4,$5)`
	if _, err := s.db.Exec(ctx, ins, d.ID, d.RecordID, d.StorageKey, d.ContentType, d.Label); err != nil {
		return nil, fmt.Errorf("records: insert doc: %w", err)
	}
	s.audited(accessorID, owner, "health.record.doc.add", d.ID, nil, map[string]any{"record_id": recordID})
	return d, nil
}

// Get returns a record + signed-URL docs, enforcing the HL-8 access discipline:
//
//  1. authorize: owner reads own; otherwise an ACTIVE consent grant is required;
//     admin reads via isAdmin. No grant ⇒ fail closed (forbidden).
//  2. APPEND an immutable access-log row recording who/why BEFORE returning data.
//  3. resolve documents to short-lived signed URLs (never raw storage keys/blobs).
//
// Erased records (right-to-erasure) are not returned.
func (s *Service) Get(ctx context.Context, accessorID, recordID string, isAdmin bool) (*Record, error) {
	owner, erased, err := s.recordOwner(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if erased {
		return nil, fmt.Errorf("records: erased")
	}

	// Resolve consent for a non-owner/non-admin BEFORE the decision so authorizeRead
	// stays pure and deterministic.
	var consentID *string
	hasConsent := false
	if accessorID != "" && !isAdmin && accessorID != owner && s.consent != nil {
		if cid, ok, _ := s.consent.HasActiveGrant(ctx, accessorID, owner, "RECORDS"); ok {
			hasConsent, consentID = true, &cid
		}
	}
	basis, allowed := authorizeRead(accessorID, owner, isAdmin, hasConsent)

	// Every PHI access is audited — including DENIED cross-patient attempts (SC-005,
	// §4.6). The denied attempt is appended to the immutable read trail and emitted
	// to the audit sink so IDOR probing is attributable; logging is best-effort and
	// never converts a denial into a leak.
	if !allowed {
		_ = s.logAccess(ctx, recordID, accessorID, string(BasisDenied), nil)
		s.audited(accessorID, owner, "health.record.access_denied", recordID, nil,
			map[string]any{"basis": string(BasisDenied)})
		return nil, fmt.Errorf("records: forbidden")
	}

	// 2) Append the immutable access log row BEFORE handing back any data (HL-8/HL-12).
	if err := s.logAccess(ctx, recordID, accessorID, string(basis), consentID); err != nil {
		return nil, err
	}

	// Load the record + its document refs.
	r, err := s.loadRecord(ctx, recordID)
	if err != nil {
		return nil, err
	}
	docs, err := s.loadDocs(ctx, recordID)
	if err != nil {
		return nil, err
	}
	// 3) Resolve each doc to a signed URL; never expose the storage key.
	for i := range docs {
		if s.signer != nil {
			if url, serr := s.signer.SignGet(ctx, docs[i].StorageKey); serr == nil {
				docs[i].SignedURL = url
			}
		}
		docs[i].StorageKey = "" // belt-and-braces: never serialise the raw key
	}
	r.Docs = docs
	return r, nil
}

// Erase performs right-to-erasure (HL-8). Tombstones the record (additive flag) so
// the immutable access log + audit trail remain intact for accountability.
func (s *Service) Erase(ctx context.Context, ownerID, recordID string) error {
	owner, _, err := s.recordOwner(ctx, recordID)
	if err != nil {
		return err
	}
	if owner != ownerID {
		return fmt.Errorf("records: forbidden")
	}
	const q = `UPDATE health_records SET erased=true, erased_at=now(), body='', title='' WHERE id=$1 AND erased=false`
	if _, err := s.db.Exec(ctx, q, recordID); err != nil {
		return fmt.Errorf("records: erase: %w", err)
	}
	s.audited(ownerID, ownerID, "health.record.erase", recordID, nil, map[string]any{"erased": true})
	return nil
}

// AccessLog returns the read trail for a record (owner/admin only). HL-8/HL-12.
func (s *Service) AccessLog(ctx context.Context, requesterID, recordID string, isAdmin bool) ([]map[string]any, error) {
	owner, _, err := s.recordOwner(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if !isAdmin && requesterID != owner {
		return nil, fmt.Errorf("records: forbidden")
	}
	const q = `SELECT id, accessor_id, access_basis, consent_id, accessed_at
	           FROM health_record_access_log WHERE record_id=$1 ORDER BY accessed_at DESC`
	rows, err := s.db.Query(ctx, q, recordID)
	if err != nil {
		return nil, fmt.Errorf("records: access log: %w", err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, accessor, basis string
		var consentID *string
		var at time.Time
		if err := rows.Scan(&id, &accessor, &basis, &consentID, &at); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "accessor_id": accessor, "access_basis": basis, "consent_id": consentID, "accessed_at": at})
	}
	return out, nil
}

// --- internals ---

func (s *Service) logAccess(ctx context.Context, recordID, accessorID, basis string, consentID *string) error {
	const q = `INSERT INTO health_record_access_log (record_id, accessor_id, access_basis, consent_id) VALUES ($1,$2,$3,$4)`
	if _, err := s.db.Exec(ctx, q, recordID, accessorID, basis, consentID); err != nil {
		return fmt.Errorf("records: access log append: %w", err)
	}
	return nil
}

func (s *Service) recordOwner(ctx context.Context, recordID string) (string, bool, error) {
	var owner string
	var erased bool
	err := s.db.QueryRow(ctx, `SELECT owner_user_id, erased FROM health_records WHERE id=$1`, recordID).Scan(&owner, &erased)
	if err == pgx.ErrNoRows {
		return "", false, fmt.Errorf("records: not found")
	}
	if err != nil {
		return "", false, err
	}
	return owner, erased, nil
}

func (s *Service) loadRecord(ctx context.Context, recordID string) (*Record, error) {
	var r Record
	const q = `SELECT id, subject_type, owner_user_id, pet_ref, record_type, title, body, erased, created_by, created_at
	           FROM health_records WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, recordID).Scan(&r.ID, &r.SubjectType, &r.OwnerUserID, &r.PetRef,
		&r.RecordType, &r.Title, &r.Body, &r.Erased, &r.CreatedBy, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Service) loadDocs(ctx context.Context, recordID string) ([]Document, error) {
	const q = `SELECT id, record_id, storage_key, content_type, label, created_at FROM health_record_docs WHERE record_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, recordID)
	if err != nil {
		return nil, fmt.Errorf("records: load docs: %w", err)
	}
	defer rows.Close()
	var out []Document
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.RecordID, &d.StorageKey, &d.ContentType, &d.Label, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_record", resourceID, oldV, newV, "", "", "info")
}
