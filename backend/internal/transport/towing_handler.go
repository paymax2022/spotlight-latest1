package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Towing customer handlers ────────────────────────────────────────────────

// TowingEstimate returns callout + distance fare.
func (h *Handler) TowingEstimate(c *gin.Context) {
	var req TowingEstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	est, err := h.svc.EstimateTowing(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, est)
}

// TowingBook books + escrows a towing job.
func (h *Handler) TowingBook(c *gin.Context) {
	userID := c.GetString("user_id")
	var req TowingBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.BookTowing(c.Request.Context(), userID, req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, j)
}

// TowingGet returns a job detail.
func (h *Handler) TowingGet(c *gin.Context) {
	userID := c.GetString("user_id")
	j, err := h.svc.TowingDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// TowingList returns the user's jobs.
func (h *Handler) TowingList(c *gin.Context) {
	userID := c.GetString("user_id")
	js, err := h.svc.ListTowing(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": js})
}

// TowingCancel refunds + cancels a job.
func (h *Handler) TowingCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelTowing(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled"})
}

// ─── Towing operator (driver) handlers ───────────────────────────────────────

// TowingRequests returns open operator requests.
func (h *Handler) TowingRequests(c *gin.Context) {
	userID := c.GetString("user_id")
	reqs, err := h.svc.OpenTowingRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// TowingAccept assigns the operator.
func (h *Handler) TowingAccept(c *gin.Context) {
	userID := c.GetString("user_id")
	j, err := h.svc.AcceptTowing(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// TowingEnRoute marks the operator en route.
func (h *Handler) TowingEnRoute(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.TowingEnRoute(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "operator_en_route"})
}

// TowingVerifyPin verifies the operator PIN.
func (h *Handler) TowingVerifyPin(c *gin.Context) {
	userID := c.GetString("user_id")
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.VerifyTowingPin(c.Request.Context(), c.Param("id"), userID, req.Pin); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "pin_verified"})
}

// TowingStart starts the job.
func (h *Handler) TowingStart(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.StartTowing(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "in_progress"})
}

// TowingComplete completes + settles the job.
func (h *Handler) TowingComplete(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.CompleteTowing(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "completed"})
}
