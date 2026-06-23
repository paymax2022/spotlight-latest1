package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Business logistics customer (owner) handlers ────────────────────────────

// BusinessAccountCreate registers a business account for the caller.
func (h *Handler) BusinessAccountCreate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BusinessAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	acct, err := h.svc.CreateBusinessAccount(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, acct)
}

// BusinessAccountGet returns the caller's business account.
func (h *Handler) BusinessAccountGet(c *gin.Context) {
	userID := c.GetString("user_id")
	acct, err := h.svc.BusinessAccountMe(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, acct)
}

// BusinessDeliveryCreate creates a single delivery.
func (h *Handler) BusinessDeliveryCreate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BusinessDeliveryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.CreateDelivery(c.Request.Context(), userID, req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, d)
}

// BusinessBatchCreate creates a batch of deliveries.
func (h *Handler) BusinessBatchCreate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BusinessBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.CreateBatch(c.Request.Context(), userID, req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

// BusinessBatchList lists the owner's batches.
func (h *Handler) BusinessBatchList(c *gin.Context) {
	userID := c.GetString("user_id")
	bs, err := h.svc.ListBatches(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"batches": bs})
}

// BusinessBatchGet returns a batch with its stops.
func (h *Handler) BusinessBatchGet(c *gin.Context) {
	userID := c.GetString("user_id")
	b, err := h.svc.BatchDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// BusinessDeliveryList lists deliveries (tracking), optionally filtered by status.
func (h *Handler) BusinessDeliveryList(c *gin.Context) {
	userID := c.GetString("user_id")
	ds, err := h.svc.ListDeliveries(c.Request.Context(), userID, c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deliveries": ds})
}

// BusinessDeliveryGet returns a delivery detail.
func (h *Handler) BusinessDeliveryGet(c *gin.Context) {
	userID := c.GetString("user_id")
	d, err := h.svc.DeliveryDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// BusinessDeliveryCancel refunds/voids + cancels a delivery.
func (h *Handler) BusinessDeliveryCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelDelivery(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled"})
}

// BusinessInvoiceList lists the owner's invoices.
func (h *Handler) BusinessInvoiceList(c *gin.Context) {
	userID := c.GetString("user_id")
	inv, err := h.svc.ListInvoices(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoices": inv})
}

// BusinessAnalytics returns the owner's logistics analytics.
func (h *Handler) BusinessAnalytics(c *gin.Context) {
	userID := c.GetString("user_id")
	a, err := h.svc.BusinessAnalytics(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

// ─── Business logistics courier (driver) handlers ────────────────────────────

// BusinessRequests returns open delivery requests for couriers.
func (h *Handler) BusinessRequests(c *gin.Context) {
	userID := c.GetString("user_id")
	reqs, err := h.svc.OpenDeliveryRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// BusinessAccept assigns the courier to a delivery.
func (h *Handler) BusinessAccept(c *gin.Context) {
	userID := c.GetString("user_id")
	d, err := h.svc.AcceptDelivery(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// BusinessPickedUp marks the delivery picked up.
func (h *Handler) BusinessPickedUp(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.MarkDeliveryPickedUp(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "picked_up"})
}

// BusinessDeliver completes the delivery with proof (and dropoff PIN if set).
func (h *Handler) BusinessDeliver(c *gin.Context) {
	userID := c.GetString("user_id")
	var req DeliverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.DeliverDelivery(c.Request.Context(), c.Param("id"), userID, req.DropoffPin, req.ProofURL); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "delivered"})
}

// BusinessFail marks the delivery failed with a reason.
func (h *Handler) BusinessFail(c *gin.Context) {
	userID := c.GetString("user_id")
	var req FailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.FailDelivery(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "failed"})
}
