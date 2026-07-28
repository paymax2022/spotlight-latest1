package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Parcel customer handlers ────────────────────────────────────────────────

// ParcelEstimate returns a parcel fare estimate.
func (h *Handler) ParcelEstimate(c *gin.Context) {
	var req ParcelEstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	est, err := h.svc.EstimateParcel(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, est)
}

// ParcelBook books + escrows a parcel.
func (h *Handler) ParcelBook(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ParcelBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.BookParcel(c.Request.Context(), userID, req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}

// ParcelGet returns a parcel detail.
func (h *Handler) ParcelGet(c *gin.Context) {
	userID := c.GetString("user_id")
	p, err := h.svc.ParcelDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ParcelList returns the sender's parcels.
func (h *Handler) ParcelList(c *gin.Context) {
	userID := c.GetString("user_id")
	ps, err := h.svc.ListParcels(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": ps})
}

// ParcelCancel refunds + cancels a parcel.
func (h *Handler) ParcelCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelParcel(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled"})
}

// ─── Parcel courier (driver) handlers ────────────────────────────────────────

// ParcelRequests returns open courier requests.
func (h *Handler) ParcelRequests(c *gin.Context) {
	userID := c.GetString("user_id")
	reqs, err := h.svc.OpenParcelRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// ParcelAccept assigns the courier.
func (h *Handler) ParcelAccept(c *gin.Context) {
	userID := c.GetString("user_id")
	p, err := h.svc.AcceptParcel(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ParcelVerifyPickupPin verifies the pickup PIN.
func (h *Handler) ParcelVerifyPickupPin(c *gin.Context) {
	userID := c.GetString("user_id")
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.VerifyParcelPickupPin(c.Request.Context(), c.Param("id"), userID, req.Pin); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "pickup_pin_verified"})
}

// ParcelPickedUp confirms pickup with a photo.
func (h *Handler) ParcelPickedUp(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ParcelPickedUpRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.MarkParcelPickedUp(c.Request.Context(), c.Param("id"), userID, req.PhotoURL); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "in_transit"})
}

// ParcelVerifyDropoff verifies dropoff PIN + proof, settles courier.
func (h *Handler) ParcelVerifyDropoff(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ParcelVerifyDropoffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.VerifyParcelDropoff(c.Request.Context(), c.Param("id"), userID, req.Pin, req.ProofURL); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "delivered"})
}
