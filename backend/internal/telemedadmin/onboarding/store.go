package onboarding

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// store is the data layer the service depends on (satisfied by *pgStore); an
// interface so the service and handlers are unit-testable without a database.
type store interface {
	List(ctx context.Context, q ListQuery) (*ApplicationList, error)
	Detail(ctx context.Context, userID string) (*ApplicationDetail, error)
	LatestVerification(ctx context.Context, userID string) (id, status string, err error)
	RecordDecision(ctx context.Context, rec decisionRecord) error
}

// decisionRecord is what gets written, in one transaction, after the MDCN review
// service has applied the verdict: the merchant-upgrade state and the audit row.
type decisionRecord struct {
	ReviewerID     string
	UserID         string
	VerificationID string
	Action         string
	NewStatus      string
	Notes          string
}

// dbtx is the slice of pgx the store needs; both *pgxpool.Pool and pgx.Tx satisfy
// it, which lets the live-DB tests run entirely inside a rolled-back transaction.
type dbtx interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

type pgStore struct{ db dbtx }

// appsCTE derives one row per provider account with the stage computed in SQL so
// list filtering, counts and detail all agree. The stage precedence mirrors the
// real lifecycle: a suspended licence beats everything, then the latest MDCN
// verification verdict, then how far the applicant got through the mobile flow.
const appsCTE = `
WITH apps AS (
  SELECT
    p.user_id::text AS user_id,
    COALESCE(NULLIF(p.name, ''),
             NULLIF(TRIM(CONCAT_WS(' ',
               p.profile_draft->'draft'->'personalInfo'->>'firstName',
               p.profile_draft->'draft'->'personalInfo'->>'lastName')), ''), '') AS name,
    p.email, p.phone, p.provider_type,
    p.profile_draft->>'providerType' AS selected_type,
    m.state AS upgrade_state,
    v.id::text AS verification_id, v.status AS verification_status, v.submitted_at,
    COALESCE(NULLIF(v.mdcn_number, ''), NULLIF(p.mdcn_number, ''),
             NULLIF(p.profile_draft->'draft'->'licence'->>'licenceNumber', '')) AS mdcn_number,
    (SELECT COUNT(DISTINCT c.consent_kind) FROM doctor_legal_consents c
       WHERE c.user_id = p.user_id AND c.accepted AND c.consent_kind = ANY($1)) AS consents_accepted,
    (SELECT COUNT(*) FROM doctor_app_permissions ap
       WHERE ap.user_id = p.user_id AND ap.state = 'granted') AS permissions_granted,
    CASE WHEN jsonb_typeof(p.completed_steps) = 'array'
         THEN jsonb_array_length(p.completed_steps) ELSE 0 END AS steps_completed,
    p.is_published, p.specialty_id, p.hospital, p.completed_steps,
    GREATEST(p.updated_at, COALESCE(m.updated_at, p.updated_at), COALESCE(v.updated_at, p.updated_at)) AS updated_at,
    CASE
      WHEN p.verification = 'suspended' THEN 'suspended'
      WHEN v.status = 'approved'   THEN 'approved'
      WHEN v.status = 'rejected'   THEN 'rejected'
      WHEN v.status = 'needs_info' THEN 'needs_info'
      WHEN v.status = 'pending'    THEN 'pending_review'
      WHEN (CASE WHEN jsonb_typeof(p.completed_steps) = 'array'
                 THEN jsonb_array_length(p.completed_steps) ELSE 0 END) > 0
           OR m.state IN ('in_progress', 'requested', 'submitted') THEN 'in_progress'
      WHEN p.profile_draft->>'providerType' IS NOT NULL THEN 'type_selected'
      ELSE 'started'
    END AS stage
  FROM doctor_profiles p
  LEFT JOIN LATERAL (
    SELECT state, updated_at FROM doctor_merchant_upgrades
    WHERE user_id = p.user_id ORDER BY created_at DESC LIMIT 1) m ON true
  LEFT JOIN LATERAL (
    SELECT id, status, submitted_at, mdcn_number, updated_at FROM doctor_verifications
    WHERE user_id = p.user_id ORDER BY created_at DESC LIMIT 1) v ON true
)`

const appCols = `user_id, name, email, phone, provider_type, selected_type, stage, upgrade_state,
  verification_status, verification_id, mdcn_number, consents_accepted, permissions_granted,
  steps_completed, submitted_at, updated_at`

func searchClause(n int) string {
	return fmt.Sprintf(`(($%[1]d)::text = '' OR name ILIKE '%%' || ($%[1]d)::text || '%%' OR email ILIKE '%%' || ($%[1]d)::text || '%%'
	  OR phone ILIKE '%%' || ($%[1]d)::text || '%%' OR mdcn_number ILIKE '%%' || ($%[1]d)::text || '%%')`, n)
}

func (s *pgStore) List(ctx context.Context, q ListQuery) (*ApplicationList, error) {
	out := &ApplicationList{Items: []Application{}, Counts: map[string]int{}}
	for _, st := range allStages {
		out.Counts[string(st)] = 0
	}

	// Per-stage counts honour the search term but not the stage filter, so the
	// filter chips always show how many applications each stage holds.
	crows, err := s.db.Query(ctx, appsCTE+` SELECT stage, COUNT(*) FROM apps WHERE `+searchClause(2)+` GROUP BY stage`,
		RequiredConsents, q.Q)
	if err != nil {
		return nil, fmt.Errorf("onboarding: stage counts: %w", err)
	}
	defer crows.Close()
	for crows.Next() {
		var stage string
		var n int
		if err := crows.Scan(&stage, &n); err != nil {
			return nil, fmt.Errorf("onboarding: scan stage counts: %w", err)
		}
		out.Counts[stage] = n
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}
	crows.Close()

	const order = ` ORDER BY (stage = 'pending_review') DESC, submitted_at ASC NULLS LAST, updated_at DESC`
	rows, err := s.db.Query(ctx,
		appsCTE+` SELECT `+appCols+`, COUNT(*) OVER () FROM apps
		 WHERE (($2)::text = '' OR stage = ($2)::text) AND `+searchClause(3)+order+` LIMIT $4 OFFSET $5`,
		RequiredConsents, q.Stage, q.Q, q.Limit, q.Offset)
	if err != nil {
		return nil, fmt.Errorf("onboarding: list: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var a Application
		var stage string
		var total int
		if err := rows.Scan(&a.UserID, &a.Name, &a.Email, &a.Phone, &a.ProviderType, &a.SelectedType, &stage,
			&a.UpgradeState, &a.VerificationStatus, &a.VerificationID, &a.MDCNNumber, &a.ConsentsAccepted,
			&a.PermissionsGranted, &a.StepsCompleted, &a.SubmittedAt, &a.UpdatedAt, &total); err != nil {
			return nil, fmt.Errorf("onboarding: scan list: %w", err)
		}
		a.Stage = Stage(stage)
		a.ConsentsRequired = len(RequiredConsents)
		out.Total = total
		out.Items = append(out.Items, a)
	}
	return out, rows.Err()
}

func (s *pgStore) Detail(ctx context.Context, userID string) (*ApplicationDetail, error) {
	row := s.db.QueryRow(ctx,
		appsCTE+` SELECT `+appCols+`, is_published, specialty_id, hospital, completed_steps FROM apps WHERE user_id = $2`,
		RequiredConsents, userID)
	var d ApplicationDetail
	var stage string
	var steps []byte
	if err := row.Scan(&d.UserID, &d.Name, &d.Email, &d.Phone, &d.ProviderType, &d.SelectedType, &stage,
		&d.UpgradeState, &d.VerificationStatus, &d.VerificationID, &d.MDCNNumber, &d.ConsentsAccepted,
		&d.PermissionsGranted, &d.StepsCompleted, &d.SubmittedAt, &d.UpdatedAt,
		&d.IsPublished, &d.Specialty, &d.Hospital, &steps); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("onboarding: detail: %w", err)
	}
	d.Stage = Stage(stage)
	d.ConsentsRequired = len(RequiredConsents)
	d.CompletedSteps = stepNames(steps)

	if err := s.loadConsents(ctx, userID, &d); err != nil {
		return nil, err
	}
	if err := s.loadPermissions(ctx, userID, &d); err != nil {
		return nil, err
	}
	if err := s.loadVerifications(ctx, userID, &d); err != nil {
		return nil, err
	}
	if err := s.loadDocuments(ctx, userID, &d); err != nil {
		return nil, err
	}
	if err := s.loadAudit(ctx, userID, &d); err != nil {
		return nil, err
	}
	d.CanDecide = d.VerificationStatus != nil && CanDecide(*d.VerificationStatus)
	if d.VerificationID != nil {
		d.ReviewPath = "/admin/health/doctor/verification"
	}
	return &d, nil
}

// stepNames flattens profile_completed_steps, which the mobile builder writes as
// an array of strings (or of objects carrying a key/step).
func stepNames(raw []byte) []string {
	out := []string{}
	var arr []json.RawMessage
	if json.Unmarshal(raw, &arr) != nil {
		return out
	}
	for _, e := range arr {
		var s string
		if json.Unmarshal(e, &s) == nil {
			out = append(out, s)
			continue
		}
		var o map[string]any
		if json.Unmarshal(e, &o) == nil {
			for _, k := range []string{"key", "step", "id", "name"} {
				if v, ok := o[k].(string); ok {
					out = append(out, v)
					break
				}
			}
		}
	}
	return out
}

func (s *pgStore) loadConsents(ctx context.Context, userID string, d *ApplicationDetail) error {
	rows, err := s.db.Query(ctx, `
		SELECT consent_kind, version, accepted, accepted_at FROM doctor_legal_consents
		WHERE user_id = $1 ORDER BY consent_kind, version`, userID)
	if err != nil {
		return fmt.Errorf("onboarding: consents: %w", err)
	}
	defer rows.Close()
	d.Consents = []Consent{}
	for rows.Next() {
		var c Consent
		if err := rows.Scan(&c.Kind, &c.Version, &c.Accepted, &c.AcceptedAt); err != nil {
			return err
		}
		d.Consents = append(d.Consents, c)
	}
	return rows.Err()
}

func (s *pgStore) loadPermissions(ctx context.Context, userID string, d *ApplicationDetail) error {
	rows, err := s.db.Query(ctx, `
		SELECT permission_kind, state, decided_at FROM doctor_app_permissions
		WHERE user_id = $1 ORDER BY permission_kind`, userID)
	if err != nil {
		return fmt.Errorf("onboarding: permissions: %w", err)
	}
	defer rows.Close()
	d.Permissions = []Permission{}
	for rows.Next() {
		var p Permission
		if err := rows.Scan(&p.Kind, &p.State, &p.DecidedAt); err != nil {
			return err
		}
		d.Permissions = append(d.Permissions, p)
	}
	return rows.Err()
}

func (s *pgStore) loadVerifications(ctx context.Context, userID string, d *ApplicationDetail) error {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, status, kind, mdcn_number, discipline, to_char(licence_expiry, 'YYYY-MM-DD'),
		       submitted_at, decided_at, notes, rejection_reason
		FROM doctor_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, userID)
	if err != nil {
		return fmt.Errorf("onboarding: verifications: %w", err)
	}
	defer rows.Close()
	d.Verifications = []Verification{}
	for rows.Next() {
		var v Verification
		if err := rows.Scan(&v.ID, &v.Status, &v.Kind, &v.MDCNNumber, &v.Discipline, &v.LicenceExpiry,
			&v.SubmittedAt, &v.DecidedAt, &v.Notes, &v.RejectionReason); err != nil {
			return err
		}
		d.Verifications = append(d.Verifications, v)
	}
	return rows.Err()
}

// loadDocuments returns metadata only. File access goes through the existing
// access-logged signed-URL endpoint of the MDCN review console, never from here.
func (s *pgStore) loadDocuments(ctx context.Context, userID string, d *ApplicationDetail) error {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, doc_type, label, file_name, mime_type, size_bytes, required, uploaded_at
		FROM doctor_verification_documents WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 50`, userID)
	if err != nil {
		return fmt.Errorf("onboarding: documents: %w", err)
	}
	defer rows.Close()
	d.Documents = []Document{}
	for rows.Next() {
		var doc Document
		if err := rows.Scan(&doc.ID, &doc.DocType, &doc.Label, &doc.FileName, &doc.MimeType,
			&doc.SizeBytes, &doc.Required, &doc.UploadedAt); err != nil {
			return err
		}
		d.Documents = append(d.Documents, doc)
	}
	return rows.Err()
}

func (s *pgStore) loadAudit(ctx context.Context, userID string, d *ApplicationDetail) error {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, action, user_id::text, created_at, detail FROM doctor_compliance_audit
		WHERE (user_id = $1 OR entity_id = $2 OR detail->>'doctor_user_id' = $2)
		  AND (action LIKE 'doctor.mdcn.%' OR action LIKE 'doctor.onboarding.%')
		ORDER BY created_at DESC LIMIT 20`, userID, userID)
	if err != nil {
		return fmt.Errorf("onboarding: audit: %w", err)
	}
	defer rows.Close()
	d.Audit = []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		var detail []byte
		if err := rows.Scan(&a.ID, &a.Action, &a.ActorID, &a.CreatedAt, &detail); err != nil {
			return err
		}
		a.Detail = map[string]any{}
		_ = json.Unmarshal(detail, &a.Detail)
		d.Audit = append(d.Audit, a)
	}
	return rows.Err()
}

func (s *pgStore) LatestVerification(ctx context.Context, userID string) (string, string, error) {
	var id, status string
	err := s.db.QueryRow(ctx, `
		SELECT id::text, status FROM doctor_verifications
		WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, userID).Scan(&id, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNoOpenVerification
	}
	return id, status, err
}

// RecordDecision writes the merchant-upgrade outcome and the audit row in ONE
// transaction. If either write fails nothing is recorded and the caller returns
// an error; the verdict itself is idempotent so the reviewer can simply retry.
func (s *pgStore) RecordDecision(ctx context.Context, r decisionRecord) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	review, _ := json.Marshal(map[string]any{
		"action": r.Action, "status": r.NewStatus, "verification_id": r.VerificationID,
		"reviewer_id": r.ReviewerID, "notes": r.Notes,
	})

	if r.Action == "approve" {
		tag, err := tx.Exec(ctx, `
			UPDATE doctor_merchant_upgrades
			SET state = 'completed', completed_at = COALESCE(completed_at, now()),
			    detail = detail || jsonb_build_object('review', $2::jsonb), updated_at = now()
			WHERE id = (SELECT id FROM doctor_merchant_upgrades WHERE user_id = $1
			            ORDER BY created_at DESC LIMIT 1)`, r.UserID, string(review))
		if err != nil {
			return fmt.Errorf("onboarding: complete upgrade: %w", err)
		}
		if tag.RowsAffected() == 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO doctor_merchant_upgrades (user_id, state, completed_at, detail)
				VALUES ($1, 'completed', now(), jsonb_build_object('review', $2::jsonb))`,
				r.UserID, string(review)); err != nil {
				return fmt.Errorf("onboarding: insert completed upgrade: %w", err)
			}
		}
	} else {
		if _, err := tx.Exec(ctx, `
			UPDATE doctor_merchant_upgrades
			SET detail = detail || jsonb_build_object('review', $2::jsonb), updated_at = now()
			WHERE id = (SELECT id FROM doctor_merchant_upgrades WHERE user_id = $1
			            ORDER BY created_at DESC LIMIT 1)`, r.UserID, string(review)); err != nil {
			return fmt.Errorf("onboarding: note upgrade: %w", err)
		}
	}

	audit, _ := json.Marshal(map[string]any{
		"doctor_user_id": r.UserID, "verification_id": r.VerificationID,
		"action": r.Action, "status": r.NewStatus, "notes": r.Notes,
	})
	idem := fmt.Sprintf("onboarding-decision:%s:%s", r.VerificationID, r.NewStatus)
	if _, err := tx.Exec(ctx, `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail, idempotency_key)
		SELECT $1::uuid, 'doctor.onboarding.admin.decided', 'doctor_onboarding', $2, $3::jsonb, $4
		WHERE NOT EXISTS (SELECT 1 FROM doctor_compliance_audit
		                  WHERE action = 'doctor.onboarding.admin.decided' AND idempotency_key = $4)`,
		r.ReviewerID, r.UserID, string(audit), idem); err != nil {
		return fmt.Errorf("onboarding: audit: %w", err)
	}
	return tx.Commit(ctx)
}
