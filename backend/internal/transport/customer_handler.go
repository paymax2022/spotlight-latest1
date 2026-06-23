package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Customer (rider) mobility handlers ──────────────────────────────────────

// Home returns the rider's mobility landing payload.
func (h *Handler) Home(c *gin.Context) {
	userID := c.GetString("user_id")
	active, _ := h.svc.ActiveRide(c.Request.Context(), userID)
	profile, _ := h.svc.GetProfile(c.Request.Context(), userID)
	c.JSON(http.StatusOK, gin.H{
		"active_trip": active,
		"profile":     profile,
		"quick_tiles": []string{"ride", "package", "scheduled"},
		"safety_reminder": "Share your trip and verify the driver PIN before starting.",
	})
}

// ConfigPricing returns the active pricing config for a zone+service_type.
func (h *Handler) ConfigPricing(c *gin.Context) {
	zone := c.Query("zone")
	serviceType := c.Query("service_type")
	cfg, err := h.svc.loadPricingConfig(c.Request.Context(), zone, serviceType)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// Estimate returns a fare estimate + offer range.
func (h *Handler) Estimate(c *gin.Context) {
	var req EstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	est, err := h.svc.EstimateRide(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, est)
}

// RequestRide creates and escrows a ride.
func (h *Handler) RequestRide(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RequestRideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := idemKey(c)
	trip, err := h.svc.RequestRide(c.Request.Context(), userID, req, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, trip)
}

// Offer records a rider offer.
func (h *Handler) Offer(c *gin.Context) {
	userID := c.GetString("user_id")
	var req OfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fo, err := h.svc.RiderOffer(c.Request.Context(), c.Param("id"), userID, req.OfferKobo)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, fo)
}

// AcceptCounter accepts a driver counter-offer.
func (h *Handler) AcceptCounter(c *gin.Context) {
	userID := c.GetString("user_id")
	fo, err := h.svc.AcceptCounter(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, fo)
}

// CancelRide refunds escrow and cancels.
func (h *Handler) CancelRide(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelRide(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhaseCancelled)})
}

// GetRide returns a trip detail (rider view, includes PIN).
func (h *Handler) GetRide(c *gin.Context) {
	userID := c.GetString("user_id")
	detail, err := h.svc.TripDetail(c.Request.Context(), c.Param("id"), userID, true)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// ActiveRide returns the rider's active trip.
func (h *Handler) ActiveRide(c *gin.Context) {
	userID := c.GetString("user_id")
	detail, err := h.svc.ActiveRide(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	if detail == nil {
		c.JSON(http.StatusOK, gin.H{"active_trip": nil})
		return
	}
	c.JSON(http.StatusOK, detail)
}

// ShareRide returns a live-share token.
func (h *Handler) ShareRide(c *gin.Context) {
	userID := c.GetString("user_id")
	token, err := h.svc.ShareToken(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"share_token": token})
}

// SOS creates a safety incident from the rider.
func (h *Handler) SOS(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SOSRequest
	_ = c.ShouldBindJSON(&req)
	tripID := c.Param("id")
	inc, err := h.svc.CreateIncident(c.Request.Context(), userID, "sos", &tripID, req.Lat, req.Lng, req.Description, "critical")
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, inc)
}

// Rate records a rating + tip.
func (h *Handler) Rate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RateTrip(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

// History returns past trips.
func (h *Handler) History(c *gin.Context) {
	userID := c.GetString("user_id")
	trips, err := h.svc.History(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": trips})
}

// GetProfile returns the rider mobility profile.
func (h *Handler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	p, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// UpdateProfile updates the rider mobility profile.
func (h *Handler) UpdateProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	var req UpsertProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.UpsertProfile(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ListContacts returns trusted contacts.
func (h *Handler) ListContacts(c *gin.Context) {
	userID := c.GetString("user_id")
	cs, err := h.svc.ListTrustedContacts(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"contacts": cs})
}

// AddContact adds a trusted contact.
func (h *Handler) AddContact(c *gin.Context) {
	userID := c.GetString("user_id")
	var req TrustedContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ct, err := h.svc.AddTrustedContact(c.Request.Context(), userID, req.Name, req.Phone)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, ct)
}

// DeleteContact removes a trusted contact.
func (h *Handler) DeleteContact(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.DeleteTrustedContact(c.Request.Context(), userID, c.Param("id")); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
