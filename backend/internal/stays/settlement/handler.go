package settlement

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the stays admin settlement/reconciliation/commission control
// plane (complements SA1's admin pages). Every route is RBAC-gated at the router
// (stays.admin.*); this handler performs the parameterized ops.
type Handler struct {
	svc *Service
}

// NewHandler constructs the settlement admin handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrPayoutHeld):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "PAYOUT_HELD"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrBadAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func limitParam(c *gin.Context) int {
	n, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	return n
}

// RegisterAdmin wires the admin settlement routes onto the admin group. guard is the
// per-route RBAC middleware factory the aggregator supplies.
func (h *Handler) RegisterAdmin(g *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	// Payouts.
	g.GET("/payouts", guard("stays.admin.settlement"), h.ListPayouts)
	g.POST("/payouts/queue", guard("stays.admin.settlement"), h.QueuePayout)
	g.POST("/payouts/:id/release", guard("stays.admin.settlement"), h.ReleasePayout)
	// Commission ledger.
	g.GET("/commission", guard("stays.admin.commission"), h.ListCommission)
	g.POST("/commission/accrue", guard("stays.admin.settlement"), h.AccrueCommission)
	g.POST("/commission/reverse", guard("stays.admin.settlement"), h.ReverseCommission)
	// Remittance reconciliation (Rail A).
	g.GET("/remittances", guard("stays.admin.settlement"), h.ListRemittances)
	g.POST("/remittances/ingest", guard("stays.admin.settlement"), h.IngestRemittance)
	g.POST("/remittances/:id/resolve", guard("stays.admin.settlement"), h.ResolveRemittance)
}

// ListPayouts: GET /payouts?status&limit
func (h *Handler) ListPayouts(c *gin.Context) {
	out, err := h.svc.ListPayouts(c.Request.Context(), c.Query("status"), limitParam(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// QueuePayout: POST /payouts/queue {property_id, hotelier_user_id, reservation_id, amount_kobo, idempotency_key}
func (h *Handler) QueuePayout(c *gin.Context) {
	var b struct {
		PropertyID     string `json:"property_id" binding:"required"`
		HotelierUserID string `json:"hotelier_user_id"`
		ReservationID  string `json:"reservation_id"`
		AmountKobo     int64  `json:"amount_kobo" binding:"required"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := b.IdempotencyKey
	if key == "" {
		key = c.GetHeader("Idempotency-Key")
	}
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key required"})
		return
	}
	id, err := h.svc.QueuePayout(c.Request.Context(), b.PropertyID, b.HotelierUserID, b.ReservationID, b.AmountKobo, key)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "status": "HELD"}})
}

// ReleasePayout: POST /payouts/:id/release
func (h *Handler) ReleasePayout(c *gin.Context) {
	p, err := h.svc.ReleasePayout(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// ListCommission: GET /commission?limit
func (h *Handler) ListCommission(c *gin.Context) {
	out, err := h.svc.ListCommission(c.Request.Context(), limitParam(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AccrueCommission: POST /commission/accrue {reservation_id, amount_kobo, idempotency_key}
func (h *Handler) AccrueCommission(c *gin.Context) {
	var b struct {
		ReservationID  string `json:"reservation_id" binding:"required"`
		AmountKobo     int64  `json:"amount_kobo" binding:"required"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.AccrueCommission(c.Request.Context(), b.ReservationID, b.AmountKobo, b.IdempotencyKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// ReverseCommission: POST /commission/reverse {reservation_id, idempotency_key}
func (h *Handler) ReverseCommission(c *gin.Context) {
	var b struct {
		ReservationID  string `json:"reservation_id" binding:"required"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.ReverseCommission(c.Request.Context(), b.ReservationID, b.IdempotencyKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// ListRemittances: GET /remittances?status&limit
func (h *Handler) ListRemittances(c *gin.Context) {
	out, err := h.svc.ListRemittances(c.Request.Context(), c.Query("status"), limitParam(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// IngestRemittance: POST /remittances/ingest {supplier_code, reservation_id, external_ref, remitted_kobo, idempotency_key}
func (h *Handler) IngestRemittance(c *gin.Context) {
	var b struct {
		SupplierCode   string `json:"supplier_code" binding:"required"`
		ReservationID  string `json:"reservation_id"`
		ExternalRef    string `json:"external_ref"`
		RemittedKobo   int64  `json:"remitted_kobo"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, status, err := h.svc.IngestRemittance(c.Request.Context(), b.SupplierCode, b.ReservationID, b.ExternalRef, b.RemittedKobo, b.IdempotencyKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "status": status}})
}

// ResolveRemittance: POST /remittances/:id/resolve {reason}
func (h *Handler) ResolveRemittance(c *gin.Context) {
	var b struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&b)
	if err := h.svc.ResolveRemittance(c.Request.Context(), c.Param("id"), b.Reason); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
