package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Movers customer handlers ────────────────────────────────────────────────

// MoverQuote creates a mover job in quote_requested.
func (h *Handler) MoverQuote(c *gin.Context) {
	userID := c.GetString("user_id")
	var req MoverQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.RequestMoverQuote(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, j)
}

// MoverGet returns a job + bids.
func (h *Handler) MoverGet(c *gin.Context) {
	userID := c.GetString("user_id")
	j, err := h.svc.MoverDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// MoverAcceptBid funds escrow for a chosen bid.
func (h *Handler) MoverAcceptBid(c *gin.Context) {
	userID := c.GetString("user_id")
	var req MoverAcceptBidRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := idemKey(c)
	if key == "" {
		key = req.IdempotencyKey
	}
	j, err := h.svc.AcceptMoverBid(c.Request.Context(), c.Param("id"), userID, req.BidID, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// MoverConfirmCompletion releases escrow → settle provider.
func (h *Handler) MoverConfirmCompletion(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.ConfirmMoverCompletion(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "completion_confirmed"})
}

// MoverCancel refunds + cancels a job.
func (h *Handler) MoverCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelMover(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled"})
}

// ─── Movers provider (driver) handlers ───────────────────────────────────────

// MoverOpen returns jobs open for bidding.
func (h *Handler) MoverOpen(c *gin.Context) {
	userID := c.GetString("user_id")
	jobs, err := h.svc.OpenMoverJobs(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
}

// MoverBid submits a bid.
func (h *Handler) MoverBid(c *gin.Context) {
	userID := c.GetString("user_id")
	var req MoverBidRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	bid, err := h.svc.SubmitMoverBid(c.Request.Context(), c.Param("id"), userID, req.AmountKobo, req.Note)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, bid)
}

// MoverStart starts the job.
func (h *Handler) MoverStart(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.StartMoverJob(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "in_progress"})
}

// MoverComplete signals provider-side completion (awaits customer confirm).
func (h *Handler) MoverComplete(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.CompleteMoverJob(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "awaiting": "customer_confirmation"})
}
