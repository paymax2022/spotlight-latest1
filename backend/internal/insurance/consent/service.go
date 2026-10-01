package consent

import (
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"time"
)

const (
	keyError = "error"
)

// CurrentNDPAVersion is the active NDPA consent text version. Bumping this forces
// users to re-consent before the next provider data-share. It is recorded on
// every consent row so an audit can show exactly which version a user accepted.
const CurrentNDPAVersion = "ndpa-v1"

// Record is a versioned NDPA consent record. A consent gates ANY provider PII
// share (quote/bind that sends user data to MyCover/Octamile) — no consent on the
// current version, no data-share.
type Record struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	ProductCode string    `json:"product_code"`
	Version     string    `json:"version"`
	Scope       string    `json:"scope"` // e.g. "provider_data_share"
	GrantedAt   time.Time `json:"granted_at"`
}

// Service manages NDPA consent records. Parameterized queries throughout.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs the consent service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Grant records a consent for the current NDPA version. Idempotent: re-granting
// the same (user, product, version, scope) is a no-op.
func (s *Service) Grant(ctx context.Context, userID, productCode, scope string) (*Record, error) {
	if s.db == nil {
		return nil, fmt.Errorf("consent: nil pool")
	}
	if scope == "" {
		scope = "provider_data_share"
	}
	var r Record
	err := s.db.QueryRow(ctx, `
		INSERT INTO public.insurance_consent (user_id, product_code, version, scope)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, product_code, version, scope) DO UPDATE
		  SET granted_at = public.insurance_consent.granted_at
		RETURNING id, user_id, product_code, version, scope, granted_at`,
		userID, productCode, CurrentNDPAVersion, scope,
	).Scan(&r.ID, &r.UserID, &r.ProductCode, &r.Version, &r.Scope, &r.GrantedAt)
	if err != nil {
		return nil, fmt.Errorf("consent: grant: %w", err)
	}
	return &r, nil
}

// HasCurrent returns true if the user has granted consent for the CURRENT NDPA
// version for this product + scope. This is the gate the policy saga calls BEFORE
// any provider data-share.
func (s *Service) HasCurrent(ctx context.Context, userID, productCode, scope string) (bool, error) {
	if s.db == nil {
		return false, fmt.Errorf("consent: nil pool")
	}
	if scope == "" {
		scope = "provider_data_share"
	}
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.insurance_consent
			WHERE user_id = $1 AND product_code = $2 AND version = $3 AND scope = $4
		)`, userID, productCode, CurrentNDPAVersion, scope).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("consent: check: %w", err)
	}
	return exists, nil
}

// ErrConsentRequired is returned by callers when the NDPA gate is not satisfied.
var ErrConsentRequired = fmt.Errorf("consent: NDPA consent required before provider data-share")

// Handler exposes member consent routes.
type Handler struct{ svc *Service }

// NewHandler constructs the consent handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Grant (member): POST /consent {product_code, scope?}
// Records NDPA consent for the current version before any provider data-share.
func (h *Handler) Grant(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var body struct {
		ProductCode string `json:"product_code" binding:"required"`
		Scope       string `json:"scope"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}
	rec, err := h.svc.Grant(c.Request.Context(), userID, body.ProductCode, body.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// Status (member): GET /consent?product_code=&scope=
// Reports whether the caller has granted consent for the current NDPA version.
func (h *Handler) Status(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	productCode := c.Query("product_code")
	scope := c.Query("scope")
	ok, err := h.svc.HasCurrent(c.Request.Context(), userID, productCode, scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"product_code": productCode,
		"version":      CurrentNDPAVersion,
		"granted":      ok,
	}})
}
