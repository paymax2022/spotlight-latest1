package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Car hire customer handlers ──────────────────────────────────────────────

// CarHireQuote returns fare + deposit.
func (h *Handler) CarHireQuote(c *gin.Context) {
	var req CarHireQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	q, err := h.svc.QuoteCarHire(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

// CarHireBook escrows fare + deposit.
func (h *Handler) CarHireBook(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CarHireBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.BookCarHire(c.Request.Context(), userID, req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

// CarHireGet returns a booking detail.
func (h *Handler) CarHireGet(c *gin.Context) {
	userID := c.GetString("user_id")
	b, err := h.svc.CarHireDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// CarHireList returns the user's bookings.
func (h *Handler) CarHireList(c *gin.Context) {
	userID := c.GetString("user_id")
	bs, err := h.svc.ListCarHire(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bs})
}

// CarHireActivate moves a confirmed booking to active.
func (h *Handler) CarHireActivate(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.ActivateCarHire(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "active"})
}

// CarHireExtend escrows the delta for extra hours.
func (h *Handler) CarHireExtend(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CarHireExtendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := idemKey(c)
	if key == "" {
		key = req.IdempotencyKey
	}
	b, err := h.svc.ExtendCarHire(c.Request.Context(), c.Param("id"), userID, req.ExtraHours, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// CarHireComplete settles driver split + releases deposit.
func (h *Handler) CarHireComplete(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.CompleteCarHire(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "completed"})
}

// CarHireCancel refunds all escrow.
func (h *Handler) CarHireCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelCarHire(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled"})
}
