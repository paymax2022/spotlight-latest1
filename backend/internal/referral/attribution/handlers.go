package attribution

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes attribution endpoints (member my-attribution + claim, admin
// reassignment queue + apply).
type Handler struct {
	svc *Service
	db  *pgxpool.Pool
}

func NewHandler(svc *Service, db *pgxpool.Pool) *Handler {
	return &Handler{svc: svc, db: db}
}

// MyAttribution handles GET /api/finance/referral/my-attribution.
func (h *Handler) MyAttribution(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	att, err := h.svc.GetByReferred(c.Request.Context(), userID)
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "no attribution"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, att)
}

// ClaimCode handles POST /api/finance/referral/claim-code (§7A.3 late claim).
func (h *Handler) ClaimCode(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code required"})
		return
	}
	att, err := h.svc.ClaimCode(c.Request.Context(), userID, body.Code)
	if err != nil {
		// Every failure carries a machine-readable `reason` alongside the human
		// message. Status alone is ambiguous: a closed grace window, an existing
		// non-house referrer and a missing attribution row are three different
		// situations that all answer 409, and a client mapping on status can only
		// show one message for all three — telling a user with no attribution at
		// all that they "already claimed" one.
		switch {
		case errors.Is(err, ErrWindowClosed):
			c.JSON(http.StatusConflict, gin.H{
				"error": "grace window closed", "reason": "window_closed"})
		case errors.Is(err, ErrSelfClaim):
			c.JSON(http.StatusForbidden, gin.H{
				"error": "self-referral cannot be claimed", "reason": "self_referral"})
		case errors.Is(err, ErrInvalidCode):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid code", "reason": "invalid_code"})
		case errors.Is(err, ErrNotHouse):
			c.JSON(http.StatusConflict, gin.H{
				"error": "attribution already assigned to a referrer", "reason": "already_claimed"})
		case errors.Is(err, ErrNoAttribution):
			c.JSON(http.StatusConflict, gin.H{
				"error": "no attribution to claim", "reason": "no_attribution"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, att)
}

// ListReassignments handles GET /api/referral/admin/reassignments — the queue.
func (h *Handler) ListReassignments(c *gin.Context) {
	const q = `
		SELECT id, attribution_id, from_party, to_party, reason, requested_by,
		       cosigned_by, benefits_house, status, created_at, decided_at
		FROM referral_reassignments
		ORDER BY created_at DESC
		LIMIT 200`
	rows, err := h.db.Query(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var (
			id, attrID                        string
			fromP, toP, reason, reqBy, cosign *string
			benefitsHouse                     bool
			status                            string
			createdAt, decidedAt              any
		)
		if err := rows.Scan(&id, &attrID, &fromP, &toP, &reason, &reqBy, &cosign,
			&benefitsHouse, &status, &createdAt, &decidedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out = append(out, gin.H{
			"id":             id,
			"attribution_id": attrID,
			"from_party":     fromP,
			"to_party":       toP,
			"reason":         reason,
			"requested_by":   reqBy,
			"cosigned_by":    cosign,
			"benefits_house": benefitsHouse,
			"status":         status,
			"created_at":     createdAt,
			"decided_at":     decidedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"reassignments": out})
}

// Reassign handles POST /api/referral/admin/reassignments (apply, co-signed when
// the change benefits the house). requested_by is the calling admin.
func (h *Handler) Reassign(c *gin.Context) {
	requestedBy := c.GetString("user_id")
	var body struct {
		AttributionID string `json:"attribution_id"`
		ToParty       string `json:"to_party"`
		Reason        string `json:"reason"`
		CosignedBy    string `json:"cosigned_by"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AttributionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "attribution_id required"})
		return
	}
	att, err := h.svc.Reassign(c.Request.Context(), ReassignInput{
		AttributionID: body.AttributionID,
		ToParty:       body.ToParty,
		Reason:        body.Reason,
		RequestedBy:   requestedBy,
		CosignedBy:    body.CosignedBy,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrCosignRequired):
			c.JSON(http.StatusForbidden, gin.H{"error": "house-benefiting reassignment requires a distinct co-signer"})
		case errors.Is(err, ErrNoAttribution):
			c.JSON(http.StatusNotFound, gin.H{"error": "attribution not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, att)
}
