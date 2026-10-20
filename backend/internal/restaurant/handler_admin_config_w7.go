package restaurant

// Read/config endpoints backing the Wave 7 admin console pages: refund tiers,
// consent audit, permit expiry. (Commission, zones and payout approvals already
// had routes.) All routes are wired in app/finance_routes.go.

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// RefundTierRow is one refund_tier_config row (newest effective first).
type RefundTierRow struct {
	ID            string    `json:"id"`
	ThresholdKobo int64     `json:"threshold_kobo"`
	EffectiveFrom time.Time `json:"effective_from"`
	CreatedBy     *string   `json:"created_by,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// AdminListRefundTiers → GET /api/restaurant/admin/refund-tiers.
func (h *Handler) AdminListRefundTiers(c *gin.Context) {
	rows, err := h.svc.db.Query(c.Request.Context(),
		`SELECT id::text, threshold_kobo, effective_from, created_by::text, created_at
		   FROM refund_tier_config ORDER BY effective_from DESC, created_at DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	defer rows.Close()
	out := []RefundTierRow{}
	for rows.Next() {
		var r RefundTierRow
		if err := rows.Scan(&r.ID, &r.ThresholdKobo, &r.EffectiveFrom, &r.CreatedBy, &r.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"tiers": out, "current_threshold_kobo": h.svc.RefundThresholdKobo(c.Request.Context())})
}

// AdminSetRefundTier → PUT /api/restaurant/admin/refund-tiers {threshold_kobo}. Appends a
// new row effective now (history is kept; the newest wins) and audits the change.
func (h *Handler) AdminSetRefundTier(c *gin.Context) {
	var body struct {
		ThresholdKobo *int64 `json:"threshold_kobo" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || *body.ThresholdKobo < 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: "threshold_kobo must be a non-negative integer (kobo)"})
		return
	}
	prev := h.svc.RefundThresholdKobo(c.Request.Context())
	adminID := ginutil.UserID(c)
	if _, err := h.svc.db.Exec(c.Request.Context(),
		`INSERT INTO refund_tier_config (threshold_kobo, created_by) VALUES ($1, $2::uuid)`, *body.ThresholdKobo, adminID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	if h.svc.audit != nil {
		h.svc.audit.LogAction(adminID, "", "restaurant.refund_tier.updated", "restaurant", "refund_tier_config", "",
			map[string]any{"threshold_kobo": prev}, map[string]any{"threshold_kobo": *body.ThresholdKobo}, "", "", "warning")
	}
	c.JSON(http.StatusOK, gin.H{"updated": true, "threshold_kobo": *body.ThresholdKobo})
}

// ConsentAuditRow is one append-only user_consents row (ip is already hashed).
type ConsentAuditRow struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Kind      string    `json:"kind"`
	Status    string    `json:"status"`
	Source    *string   `json:"source,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// AdminListConsents → GET /api/restaurant/admin/consents?kind=&user_id=&limit=&offset=.
func (h *Handler) AdminListConsents(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	rows, err := h.svc.db.Query(c.Request.Context(),
		`SELECT id::text, user_id::text, kind, status, source, created_at FROM user_consents
		  WHERE ($1='' OR kind=$1) AND ($2='' OR user_id::text=$2)
		  ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
		strings.ToLower(strings.TrimSpace(c.Query("kind"))), strings.TrimSpace(c.Query("user_id")), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	defer rows.Close()
	out := []ConsentAuditRow{}
	for rows.Next() {
		var r ConsentAuditRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Kind, &r.Status, &r.Source, &r.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"consents": out})
}

// PermitRow is a restaurant with its permit expiry / hold state.
type PermitRow struct {
	RestaurantID         string     `json:"restaurant_id"`
	Name                 string     `json:"name"`
	IsOpen               bool       `json:"is_open"`
	PermitExpiresAt      *time.Time `json:"permit_expires_at,omitempty"`
	ComplianceHoldReason *string    `json:"compliance_hold_reason,omitempty"`
}

// AdminListPermits → GET /api/restaurant/admin/permits?filter=missing|expired|expiring|all&limit=&offset=.
// "expiring" = within 30 days.
func (h *Handler) AdminListPermits(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	var where string
	switch c.DefaultQuery("filter", "all") {
	case "missing":
		where = "permit_expires_at IS NULL"
	case "expired":
		where = "permit_expires_at < now()"
	case "expiring":
		where = "permit_expires_at >= now() AND permit_expires_at < now() + interval '30 days'"
	default:
		where = "TRUE"
	}
	rows, err := h.svc.db.Query(c.Request.Context(),
		`SELECT id::text, name, is_open, permit_expires_at, compliance_hold_reason FROM restaurants
		  WHERE `+where+` ORDER BY permit_expires_at ASC NULLS FIRST, name LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	defer rows.Close()
	out := []PermitRow{}
	for rows.Next() {
		var r PermitRow
		if err := rows.Scan(&r.RestaurantID, &r.Name, &r.IsOpen, &r.PermitExpiresAt, &r.ComplianceHoldReason); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"permits": out})
}
