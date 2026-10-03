package consent

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	keyError = "error"
)

// NDPA consent for the Stays module. A consent gates ANY guest-PII share with a
// supplier/hotel (the Book leg forwards lead-guest name/email/phone to the rail) —
// no consent on the current version, no data-share (PRD §22, §21). Mirrors the
// insurance consent service.

// CurrentNDPAVersion is the active NDPA consent text version. Bumping this forces
// guests to re-consent before the next supplier data-share.
const CurrentNDPAVersion = "stays-ndpa-v1"

// DefaultScope is the consent scope the booking saga checks.
const DefaultScope = "supplier_data_share"

// Record is a versioned NDPA consent record.
type Record struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Scope     string    `json:"scope"`
	Version   string    `json:"version"`
	GrantedAt time.Time `json:"granted_at"`
}

// ErrConsentRequired is returned when the NDPA gate is not satisfied.
var ErrConsentRequired = fmt.Errorf("consent: NDPA consent required before supplier data-share")

// Service manages NDPA consent records. Parameterized queries throughout.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs the consent service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Grant records a consent for the current NDPA version. Idempotent: re-granting the
// same (user, scope, version) is a no-op.
func (s *Service) Grant(ctx context.Context, userID, scope string) (*Record, error) {
	if s.db == nil {
		return nil, fmt.Errorf("consent: nil pool")
	}
	if scope == "" {
		scope = DefaultScope
	}
	var r Record
	err := s.db.QueryRow(ctx, `
		INSERT INTO public.stays_consent (user_id, scope, version)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, scope, version) DO UPDATE
		  SET granted_at = public.stays_consent.granted_at
		RETURNING id, user_id, scope, version, granted_at`,
		userID, scope, CurrentNDPAVersion,
	).Scan(&r.ID, &r.UserID, &r.Scope, &r.Version, &r.GrantedAt)
	if err != nil {
		return nil, fmt.Errorf("consent: grant: %w", err)
	}
	return &r, nil
}

// HasCurrent returns true if the user has granted consent for the CURRENT NDPA
// version + scope. This is the gate the booking saga calls BEFORE any supplier
// data-share.
func (s *Service) HasCurrent(ctx context.Context, userID, scope string) (bool, error) {
	if s.db == nil {
		return false, fmt.Errorf("consent: nil pool")
	}
	if scope == "" {
		scope = DefaultScope
	}
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.stays_consent
			WHERE user_id = $1 AND scope = $2 AND version = $3
		)`, userID, scope, CurrentNDPAVersion).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("consent: check: %w", err)
	}
	return exists, nil
}

// Handler exposes the member NDPA consent routes for Stays.
type Handler struct {
	svc *Service
}

// NewHandler constructs the consent handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Status (member): GET /consent?scope= — has the guest granted current consent?
func (h *Handler) Status(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "unauthenticated"})
		return
	}
	scope := c.DefaultQuery("scope", DefaultScope)
	ok, err := h.svc.HasCurrent(c.Request.Context(), uid, scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"granted": ok, "version": CurrentNDPAVersion, "scope": scope}})
}

// Grant (member): POST /consent {scope} — record consent for the current version.
func (h *Handler) Grant(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "unauthenticated"})
		return
	}
	var body struct {
		Scope string `json:"scope"`
	}
	_ = c.ShouldBindJSON(&body)
	r, err := h.svc.Grant(c.Request.Context(), uid, body.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": r})
}
