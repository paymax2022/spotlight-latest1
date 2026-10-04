package connectonboarding

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/timeutil"
	connectsafety "spotlight/backend/internal/connect/safety"
	"spotlight/backend/internal/otp"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

// Service runs the age gate and routes suspected minors to the underage queue.
type Service struct {
	db     *pgxpool.Pool
	safety *connectsafety.Service
}

func NewService(db *pgxpool.Pool, safety *connectsafety.Service) *Service {
	return &Service{db: db, safety: safety}
}

// AgeGate evaluates a DOB fail-closed. On an unparseable/future date it blocks
// without asserting minority; on age < 18 it flags the user for admin review.
// The decision is the source of truth — audit writes are best-effort and never
// flip a block to a pass.
func (s *Service) AgeGate(ctx context.Context, userID, dobStr, ip string) (AgeGateResult, error) {
	now := time.Now().UTC()
	dob, err := timeutil.ParseDate(dobStr)
	if err != nil || dob.IsZero() || dob.After(now) {
		_ = s.audit(ctx, userID, "connect.agegate.invalid", ip, map[string]any{"dob": dobStr})
		return AgeGateResult{Allowed: false, Reason: "invalid_dob"}, nil
	}

	age := ComputeAge(dob, now)
	if age < MinAdultAge {
		// Fail-closed critical write: the user MUST land in the review queue.
		const ins = `INSERT INTO connect_underage_flags (user_id, reason, dob, status)
			VALUES ($1, $2, $3, 'queued')
			ON CONFLICT (user_id) DO NOTHING`
		if _, err := s.db.Exec(ctx, ins, userID, "under_18_at_age_gate", dob); err != nil {
			return AgeGateResult{}, fmt.Errorf("connect: enqueue underage flag: %w", err)
		}
		_ = s.audit(ctx, userID, "connect.agegate.blocked_minor", ip, map[string]any{"age": age})
		return AgeGateResult{Allowed: false, Reason: "under_18", Age: age}, nil
	}

	// Persist the passed gate into the onboarding state (best-effort; the gate
	// decision itself is already final and is returned regardless).
	_ = s.markAgeVerified(ctx, userID)
	_ = s.audit(ctx, userID, "connect.agegate.passed", ip, map[string]any{"age": age})
	return AgeGateResult{Allowed: true, Age: age}, nil
}

func (s *Service) audit(ctx context.Context, userID, action, ip string, payload map[string]any) error {
	return s.safety.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    userID,
		Action:     action,
		EntityType: "connect_age_gate",
		EntityID:   userID,
		IP:         ip,
		NewValue:   payload,
	})
}

// MinAdultAge is the hard minimum. No teen/under-18 mode ever exists.
const MinAdultAge = 18

// ComputeAge returns full years elapsed between dob and now. A dob in the
// future yields a negative result (handled fail-closed by callers).
func ComputeAge(dob, now time.Time) int {
	years := now.Year() - dob.Year()
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		years--
	}
	return years
}

// IsAdult reports whether dob corresponds to an age >= 18 at now.
func IsAdult(dob, now time.Time) bool {
	return ComputeAge(dob, now) >= MinAdultAge
}

// AgeGateRequest is the body for POST /api/v1/connect/onboarding/age-gate.
// DOB is an ISO date string (YYYY-MM-DD).
type AgeGateRequest struct {
	DOB string `json:"dob" binding:"required"`
}

// AgeGateResult is the gate decision returned to the client.
type AgeGateResult struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"` // invalid_dob | under_18
	Age     int    `json:"age,omitempty"`
}

// RequiredConsents maps each required consent kind to its current version.
// Onboarding completes only when all are accepted at these versions.
var RequiredConsents = map[string]string{
	"terms":                "v1",
	"privacy":              "v1",
	"community_guidelines": "v1",
}

// ValidConsentKind reports whether k is a recognised consent kind.
func ValidConsentKind(k string) bool {
	_, ok := RequiredConsents[k]
	return ok
}

// ConsentRequest is the body for POST /api/v1/connect/onboarding/consent.
type ConsentRequest struct {
	Kind    string `json:"kind" binding:"required"`
	Version string `json:"version"`
}

// OnboardingStatus is the combined gate state for a user.
type OnboardingStatus struct {
	AgeVerified      bool     `json:"age_verified"`
	PhoneVerified    bool     `json:"phone_verified"`
	ConsentsAccepted bool     `json:"consents_accepted"`
	Status           string   `json:"status"` // pending | complete
	MissingConsents  []string `json:"missing_consents"`
}

type Handler struct {
	svc      *Service
	phoneOTP *otp.Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// AgeGate — POST /api/v1/connect/onboarding/age-gate (authenticated).
// 200 = adult; 403 = under 18 (queued for review); 400 = invalid DOB.
func (h *Handler) AgeGate(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req AgeGateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	res, err := h.svc.AgeGate(c.Request.Context(), userID, req.DOB, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}

	switch {
	case res.Reason == "invalid_dob":
		c.JSON(http.StatusBadRequest, res)
	case !res.Allowed:
		c.JSON(http.StatusForbidden, res)
	default:
		c.JSON(http.StatusOK, res)
	}
}

// Consent — POST /api/v1/connect/onboarding/consent (authenticated).
func (h *Handler) Consent(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req ConsentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	st, err := h.svc.RecordConsent(c.Request.Context(), userID, req.Kind, req.Version, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, st)
}

// Status — GET /api/v1/connect/onboarding/status (authenticated).
func (h *Handler) Status(c *gin.Context) {
	st, err := h.svc.GetStatus(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, st)
}

// recomputeStatus flips status to 'complete' once all three gate steps are done,
// stamping completed_at on the first completion.
const recomputeStatus = `UPDATE connect_onboarding
	SET status = CASE WHEN age_verified AND phone_verified AND consents_accepted THEN 'complete' ELSE 'pending' END,
	    completed_at = CASE WHEN age_verified AND phone_verified AND consents_accepted AND completed_at IS NULL
	                        THEN now() ELSE completed_at END
	WHERE user_id = $1`

// markAgeVerified records a passed 18+ gate and recomputes onboarding status.
func (s *Service) markAgeVerified(ctx context.Context, userID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_onboarding (user_id, age_verified) VALUES ($1, true)
		 ON CONFLICT (user_id) DO UPDATE SET age_verified = true`, userID); err != nil {
		return fmt.Errorf("connect: mark age_verified: %w", err)
	}
	if _, err := tx.Exec(ctx, recomputeStatus, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RecordConsent stores an acceptance, recomputes whether all required consents
// are in, updates onboarding status, and audits — all transactionally.
func (s *Service) RecordConsent(ctx context.Context, userID, kind, version, ip string) (OnboardingStatus, error) {
	if !ValidConsentKind(kind) {
		return OnboardingStatus{}, fmt.Errorf("connect: invalid consent kind %q", kind)
	}
	if version == "" {
		version = RequiredConsents[kind]
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return OnboardingStatus{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_consents (user_id, consent_kind, version, accepted, accepted_at)
		 VALUES ($1, $2, $3, true, now())
		 ON CONFLICT (user_id, consent_kind, version)
		 DO UPDATE SET accepted = true, accepted_at = now()`,
		userID, kind, version); err != nil {
		return OnboardingStatus{}, fmt.Errorf("connect: record consent: %w", err)
	}

	allIn, err := allRequiredConsents(ctx, tx, userID)
	if err != nil {
		return OnboardingStatus{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_onboarding (user_id, consents_accepted) VALUES ($1, $2)
		 ON CONFLICT (user_id) DO UPDATE SET consents_accepted = EXCLUDED.consents_accepted`,
		userID, allIn); err != nil {
		return OnboardingStatus{}, err
	}
	if _, err := tx.Exec(ctx, recomputeStatus, userID); err != nil {
		return OnboardingStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OnboardingStatus{}, err
	}

	_ = s.safety.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    userID,
		Action:     "connect.consent.accepted",
		EntityType: "connect_consent",
		EntityID:   userID,
		IP:         ip,
		NewValue:   map[string]any{"kind": kind, "version": version},
	})

	return s.GetStatus(ctx, userID)
}

// GetStatus returns the combined onboarding gate state, defaulting to pending
// when no row exists yet.
func (s *Service) GetStatus(ctx context.Context, userID string) (OnboardingStatus, error) {
	st := OnboardingStatus{Status: "pending"}
	const q = `SELECT age_verified, phone_verified, consents_accepted, status
	           FROM connect_onboarding WHERE user_id = $1`
	err := s.db.QueryRow(ctx, q, userID).Scan(&st.AgeVerified, &st.PhoneVerified, &st.ConsentsAccepted, &st.Status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OnboardingStatus{}, fmt.Errorf("connect: read onboarding: %w", err)
	}

	missing, err := missingConsents(ctx, s.db, userID)
	if err != nil {
		return OnboardingStatus{}, err
	}
	st.MissingConsents = missing
	return st, nil
}

// querier is satisfied by both *pgxpool.Pool and pgx.Tx.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const acceptedRequiredQuery = `SELECT consent_kind FROM connect_consents
	WHERE user_id = $1 AND accepted = true
	  AND ((consent_kind = 'terms' AND version = $2)
	    OR (consent_kind = 'privacy' AND version = $3)
	    OR (consent_kind = 'community_guidelines' AND version = $4))`

func allRequiredConsents(ctx context.Context, q querier, userID string) (bool, error) {
	accepted, err := acceptedSet(ctx, q, userID)
	if err != nil {
		return false, err
	}
	return len(accepted) == len(RequiredConsents), nil
}

func missingConsents(ctx context.Context, q querier, userID string) ([]string, error) {
	accepted, err := acceptedSet(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	var missing []string
	for kind := range RequiredConsents {
		if !accepted[kind] {
			missing = append(missing, kind)
		}
	}
	sort.Strings(missing)
	return missing, nil
}

func acceptedSet(ctx context.Context, q querier, userID string) (map[string]bool, error) {
	rows, err := q.Query(ctx, acceptedRequiredQuery, userID,
		RequiredConsents["terms"], RequiredConsents["privacy"], RequiredConsents["community_guidelines"])
	if err != nil {
		return nil, fmt.Errorf("connect: read consents: %w", err)
	}
	defer rows.Close()
	set := make(map[string]bool)
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			return nil, err
		}
		set[kind] = true
	}
	return set, rows.Err()
}
