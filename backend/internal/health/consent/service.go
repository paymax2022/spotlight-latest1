package healthconsent

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Consent is a granular, revocable cross-vertical sharing grant (HL-8).
type Consent struct {
	ID             string     `json:"id"`
	GrantorID      string     `json:"grantor_id"`       // data subject who consents
	GranteeID      string     `json:"grantee_id"`       // vet/pharmacy/lab/owner who may read
	SubjectOwnerID string     `json:"subject_owner_id"` // record-owner scope
	Scope          string     `json:"scope"`            // RECORDS | PRESCRIPTIONS | LAB_RESULTS | ALL
	State          string     `json:"state"`            // ACTIVE | REVOKED
	GrantedAt      time.Time  `json:"granted_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

// Service manages consent grants. It exposes HasActiveGrant which the records
// service calls before any cross-vertical read (HL-8 gate).
type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service {
	return &Service{db: db, audit: audit}
}

// Grant creates an ACTIVE consent from grantor (the acting data subject) to grantee.
func (s *Service) Grant(ctx context.Context, grantorID, granteeID, subjectOwnerID, scope string, expiresAt *time.Time) (*Consent, error) {
	if grantorID == "" || granteeID == "" {
		return nil, fmt.Errorf("consent: grantor and grantee required")
	}
	if !validScope(scope) {
		return nil, fmt.Errorf("consent: invalid scope")
	}
	if subjectOwnerID == "" {
		subjectOwnerID = grantorID // default: subject consents about own records
	}
	c := &Consent{
		ID:             uuid.New().String(),
		GrantorID:      grantorID,
		GranteeID:      granteeID,
		SubjectOwnerID: subjectOwnerID,
		Scope:          scope,
		State:          "ACTIVE",
		GrantedAt:      time.Now(),
		ExpiresAt:      expiresAt,
	}
	const ins = `
		INSERT INTO health_consents (id, grantor_id, grantee_id, subject_owner_id, scope, state, expires_at)
		VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6)`
	if _, err := s.db.Exec(ctx, ins, c.ID, c.GrantorID, c.GranteeID, c.SubjectOwnerID, c.Scope, nullTime(expiresAt)); err != nil {
		return nil, fmt.Errorf("consent: insert: %w", err)
	}
	s.audited(grantorID, granteeID, "health.consent.grant", c.ID, nil,
		map[string]any{"scope": scope, "grantee": granteeID})
	return c, nil
}

// Revoke flips an ACTIVE grant to REVOKED. Only the grantor may revoke (authZ).
func (s *Service) Revoke(ctx context.Context, grantorID, consentID string) error {
	const q = `UPDATE health_consents SET state='REVOKED', revoked_at=now()
	           WHERE id=$1 AND grantor_id=$2 AND state='ACTIVE'`
	ct, err := s.db.Exec(ctx, q, consentID, grantorID)
	if err != nil {
		return fmt.Errorf("consent: revoke: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("consent: not revocable (missing, not yours, or already revoked)")
	}
	s.audited(grantorID, "", "health.consent.revoke", consentID,
		map[string]any{"state": "ACTIVE"}, map[string]any{"state": "REVOKED"})
	return nil
}

// HasActiveGrant returns true when granteeID currently holds an ACTIVE, unexpired
// consent over subjectOwnerID's data for the given scope (or ALL). This is the
// HL-8 cross-vertical read gate used by the records service.
func (s *Service) HasActiveGrant(ctx context.Context, granteeID, subjectOwnerID, scope string) (string, bool, error) {
	const q = `
		SELECT id FROM health_consents
		WHERE grantee_id=$1 AND subject_owner_id=$2 AND state='ACTIVE'
		  AND (scope=$3 OR scope='ALL')
		  AND (expires_at IS NULL OR expires_at > now())
		LIMIT 1`
	var id string
	err := s.db.QueryRow(ctx, q, granteeID, subjectOwnerID, scope).Scan(&id)
	if err != nil {
		return "", false, nil // no active grant — fail closed, not an error
	}
	return id, true, nil
}

// ListForGrantor returns the acting subject's own grants.
func (s *Service) ListForGrantor(ctx context.Context, grantorID string) ([]Consent, error) {
	const q = `SELECT id, grantor_id, grantee_id, subject_owner_id, scope, state, granted_at, revoked_at, expires_at
	           FROM health_consents WHERE grantor_id=$1 ORDER BY granted_at DESC`
	rows, err := s.db.Query(ctx, q, grantorID)
	if err != nil {
		return nil, fmt.Errorf("consent: list: %w", err)
	}
	defer rows.Close()
	var out []Consent
	for rows.Next() {
		var c Consent
		if err := rows.Scan(&c.ID, &c.GrantorID, &c.GranteeID, &c.SubjectOwnerID, &c.Scope,
			&c.State, &c.GrantedAt, &c.RevokedAt, &c.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_consent", resourceID, oldV, newV, "", "", "info")
}

func validScope(s string) bool {
	switch s {
	case "RECORDS", "PRESCRIPTIONS", "LAB_RESULTS", "ALL":
		return true
	}
	return false
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}
