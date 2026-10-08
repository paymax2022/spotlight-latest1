package healthconsent

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keySuccess = "success"
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
		return nil, errors.New("consent: grantor and grantee required")
	}
	if !validScope(scope) {
		return nil, errors.New("consent: invalid scope")
	}
	if subjectOwnerID == "" {
		subjectOwnerID = grantorID // default: subject consents about own records
	}
	// Only the data subject may consent over their own records. A caller-
	// supplied subject_owner_id naming someone else minted a self-forged grant
	// that HasActiveGrant honoured — an IDOR over PHI (wave-6 prod probe).
	if subjectOwnerID != grantorID {
		return nil, errors.New("consent: only the data subject may grant over their own records")
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
		return errors.New("consent: not revocable (missing, not yours, or already revoked)")
	}
	s.audited(grantorID, "", "health.consent.revoke", consentID,
		map[string]any{"state": "ACTIVE"}, map[string]any{"state": "REVOKED"})
	return nil
}

// hasActiveGrantQuery fetches the grantee's grants over this subject; the
// canonical active-grant rule (grantActive) is applied in Go — one source of
// truth for active/scope/expiry, shared with the unit tests. Most-recent first
// so a fresh grant is preferred; a revoked/expired/narrower grant is skipped.
// `grantor_id = subject_owner_id` is the defense-in-depth twin of the Grant
// guard: a row can only confer access when the SUBJECT granted it, so forged
// grants (grantor ≠ subject — e.g. rows minted before the Grant guard, or via
// direct SQL) are invisible to every consent-gated read.
const hasActiveGrantQuery = `SELECT id, scope, state, expires_at FROM health_consents
	           WHERE grantee_id=$1 AND subject_owner_id=$2
	             AND grantor_id = subject_owner_id
	           ORDER BY granted_at DESC`

// HasActiveGrant returns true when granteeID currently holds an ACTIVE, unexpired
// consent over subjectOwnerID's data for the given scope (or ALL). This is the
// HL-8 cross-vertical read gate used by the records service.
func (s *Service) HasActiveGrant(ctx context.Context, granteeID, subjectOwnerID, scope string) (string, bool, error) {
	rows, err := s.db.Query(ctx, hasActiveGrantQuery, granteeID, subjectOwnerID)
	if err != nil {
		return "", false, nil // fail closed, not an error
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var id, gScope, state string
		var expires *time.Time
		if err := rows.Scan(&id, &gScope, &state, &expires); err != nil {
			return "", false, nil
		}
		if grantActive(state, gScope, expires, scope, now) {
			return id, true, nil
		}
	}
	return "", false, nil
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

// grantActive is the canonical rule for whether a consent grant currently permits
// a read of `wantScope` at `now`. It is the single source of truth enforced by
// HasActiveGrant (HL-8 cross-vertical gate):
//   - the grant must be ACTIVE — a REVOKED grant never permits access, so
//     withdrawal stops further sharing immediately (AC-008);
//   - the grant's scope must cover the requested scope (exact match, or the
//     catch-all "ALL") — a narrower grant cannot be escalated (AC-004);
//   - the grant must be unexpired — expiry is half-open, so a grant expiring
//     exactly at `now` no longer permits access (AC-004).
func grantActive(state, grantScope string, expiresAt *time.Time, wantScope string, now time.Time) bool {
	if state != "ACTIVE" {
		return false
	}
	if grantScope != wantScope && grantScope != "ALL" {
		return false
	}
	if expiresAt != nil && !expiresAt.After(now) {
		return false
	}
	return true
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Grant / Revoke — POST /consent  (action discriminator in body)
func (h *Handler) Grant(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Action         string     `json:"action"` // grant | revoke
		ConsentID      string     `json:"consent_id"`
		GranteeID      string     `json:"grantee_id"`
		SubjectOwnerID string     `json:"subject_owner_id"`
		Scope          string     `json:"scope"`
		ExpiresAt      *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Action == "revoke" {
		if err := h.svc.Revoke(c.Request.Context(), id, req.ConsentID); err != nil {
			ginutil.FailOK(c, http.StatusConflict, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{keySuccess: true})
		return
	}
	out, err := h.svc.Grant(c.Request.Context(), id, req.GranteeID, req.SubjectOwnerID, req.Scope, req.ExpiresAt)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{keySuccess: true, "consent": out})
}

// List — GET /consent
func (h *Handler) List(c *gin.Context) {
	out, err := h.svc.ListForGrantor(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "consents": out})
}
