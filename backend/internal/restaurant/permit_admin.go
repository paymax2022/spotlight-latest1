package restaurant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// FOOD-UAT-H-002 — business-permit expiry + compliance hold.
//
// restaurants.permit_expires_at NULL = no permit on file. A store may only be
// OPENED while the permit is in the future; the sweeper (SweepPermitExpiry)
// closes any open store whose permit lapsed and stamps compliance_hold_reason.
// An admin lifting the hold does so by recording a new future date
// (PUT /restaurant/admin/:id/permit). The gate sits in route middleware
// (RequirePermitValidToOpen) because service.go / SetAvailability are owned by
// another change set; closing is never blocked.

// ErrPermitExpired — sibling of ErrKYBNotApproved (kyb.go).
var ErrPermitExpired = errors.New("restaurant: business permit is missing or expired; ask an admin to renew it before opening for orders")

const complianceHoldPermit = "permit_expired"

// PermitValidFor reports whether the restaurant's permit is on file and unexpired.
func (s *Service) PermitValidFor(ctx context.Context, restaurantID string, now time.Time) (bool, error) {
	var exp *time.Time
	err := s.db.QueryRow(ctx, `SELECT permit_expires_at FROM restaurants WHERE id=$1`, restaurantID).Scan(&exp)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // let SetAvailability produce its own not-found
	}
	if err != nil {
		return false, fmt.Errorf("restaurant: load permit: %w", err)
	}
	return exp != nil && exp.After(now), nil
}

// SweepPermitExpiry closes every open restaurant whose permit has lapsed and
// records a compliance hold + audit event. Idempotent: it only touches rows that
// are still open, so repeated ticks write nothing.
func (s *Service) SweepPermitExpiry(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.Query(ctx, `UPDATE restaurants
	     SET is_open=FALSE, compliance_hold_reason=$2, updated_at=NOW()
	   WHERE permit_expires_at IS NOT NULL AND permit_expires_at < $1 AND is_open=TRUE
	RETURNING id::text, permit_expires_at`, now, complianceHoldPermit)
	if err != nil {
		return 0, fmt.Errorf("restaurant: permit expiry sweep: %w", err)
	}
	type closed struct {
		id  string
		exp time.Time
	}
	var done []closed
	for rows.Next() {
		var c closed
		if err := rows.Scan(&c.id, &c.exp); err != nil {
			rows.Close()
			return len(done), err
		}
		done = append(done, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return len(done), err
	}
	for _, c := range done {
		if s.audit != nil {
			s.audit.LogAction("system:permit-sweeper", "", "restaurant.permit.expired", "restaurant", "restaurant", c.id,
				map[string]any{"is_open": true},
				map[string]any{"is_open": false, "permit_expires_at": c.exp, "compliance_hold_reason": complianceHoldPermit},
				"", "", "warning")
		}
	}
	return len(done), nil
}

// SetPermit records a (new) permit expiry and lifts a permit compliance hold when
// the date is in the future. It does NOT re-open the store; the owner does that.
func (s *Service) SetPermit(ctx context.Context, restaurantID, adminID string, expiresAt time.Time, documentURL string) error {
	var prev *time.Time
	if err := s.db.QueryRow(ctx, `SELECT permit_expires_at FROM restaurants WHERE id=$1`, restaurantID).Scan(&prev); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("restaurant: not found")
		}
		return err
	}
	_, err := s.db.Exec(ctx, `UPDATE restaurants
	     SET permit_expires_at=$2,
	         permit_document_url=COALESCE(NULLIF($3,''), permit_document_url),
	         compliance_hold_reason=CASE WHEN $2 > NOW() AND compliance_hold_reason=$4 THEN NULL ELSE compliance_hold_reason END,
	         updated_at=NOW()
	   WHERE id=$1`, restaurantID, expiresAt, documentURL, complianceHoldPermit)
	if err != nil {
		return fmt.Errorf("restaurant: set permit: %w", err)
	}
	if s.audit != nil {
		s.audit.LogAction(adminID, "", "restaurant.permit.updated", "restaurant", "restaurant", restaurantID,
			map[string]any{"permit_expires_at": prev},
			map[string]any{"permit_expires_at": expiresAt, "document_url": documentURL}, "", "", "warning")
	}
	return nil
}

// AdminSetPermit → PUT /api/restaurant/admin/:id/permit {expires_at, document_url?}
// (restaurant.admin.onboarding).
func (h *Handler) AdminSetPermit(c *gin.Context) {
	var body struct {
		ExpiresAt   time.Time `json:"expires_at" binding:"required"`
		DocumentURL string    `json:"document_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.SetPermit(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.ExpiresAt, strings.TrimSpace(body.DocumentURL)); err != nil {
		st := ownerErrStatus(err)
		c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"restaurant_id": c.Param("id"), "permit_expires_at": body.ExpiresAt})
}

// RequirePermitValidToOpen guards the availability PATCH routes: an attempt to set
// is_open=true needs a valid permit (ErrPermitExpired → 403). Closing, and any
// malformed body, passes through untouched so the real handler owns validation.
func (h *Handler) RequirePermitValidToOpen() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{keyError: "unreadable request body"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))
		var body struct {
			IsOpen *bool `json:"is_open"`
		}
		if json.Unmarshal(raw, &body) != nil || body.IsOpen == nil || !*body.IsOpen {
			c.Next()
			return
		}
		ok, err := h.svc.PermitValidFor(c.Request.Context(), c.Param("id"), time.Now())
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, ErrPermitExpired)})
			return
		}
		c.Next()
	}
}
