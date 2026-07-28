package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Driver-facing handlers ──────────────────────────────────────────────────

// OnboardingSubmit moves a driver to verification_status submitted.
func (h *Handler) OnboardingSubmit(c *gin.Context) {
	userID := c.GetString("user_id")
	var req OnboardingSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.SubmitOnboarding(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// AddDocument uploads a driver document.
func (h *Handler) AddDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	var req DocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	doc, err := h.svc.AddDocument(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, doc)
}

// AddVehicle registers a vehicle for the driver.
func (h *Handler) AddVehicle(c *gin.Context) {
	userID := c.GetString("user_id")
	var req VehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.AddVehicle(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

// DriverMe returns the full driver profile.
func (h *Handler) DriverMe(c *gin.Context) {
	userID := c.GetString("user_id")
	d, err := h.svc.DriverMeFull(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// DriverStatus toggles online/offline + updates location (approved-only online).
func (h *Handler) DriverStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	var req DriverStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetDriverOnline(c.Request.Context(), userID, req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

// DriverRequests returns open ride requests near the driver.
func (h *Handler) DriverRequests(c *gin.Context) {
	userID := c.GetString("user_id")
	reqs, err := h.svc.OpenRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// DriverAccept accepts a request at the standing fare.
func (h *Handler) DriverAccept(c *gin.Context) {
	userID := c.GetString("user_id")
	detail, err := h.svc.DriverAccept(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// DriverCounter records a driver counter-offer.
func (h *Handler) DriverCounter(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CounterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fo, err := h.svc.DriverCounter(c.Request.Context(), c.Param("id"), userID, req.CounterKobo)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, fo)
}

// DriverArrive: driver_assigned → driver_arriving.
func (h *Handler) DriverArrive(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.DriverArrive(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhaseDriverArriving)})
}

// VerifyPin: driver_arriving → pin_verified.
func (h *Handler) VerifyPin(c *gin.Context) {
	userID := c.GetString("user_id")
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.VerifyPin(c.Request.Context(), c.Param("id"), userID, req.Pin); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhasePinVerified)})
}

// StartTrip: pin_verified → in_progress.
func (h *Handler) StartTrip(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.StartTrip(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhaseInProgress)})
}

// CompleteTrip: in_progress → completed, settles the split.
func (h *Handler) CompleteTrip(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.CompleteTrip(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "phase": string(PhaseCompleted)})
}

// DriverEarnings returns the driver economic dashboard.
func (h *Handler) DriverEarnings(c *gin.Context) {
	userID := c.GetString("user_id")
	e, err := h.svc.Earnings(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, e)
}

// DriverSOS creates a driver-side safety incident.
func (h *Handler) DriverSOS(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SOSRequest
	_ = c.ShouldBindJSON(&req)
	inc, err := h.svc.CreateIncident(c.Request.Context(), userID, "sos", req.TripID, req.Lat, req.Lng, req.Description, "critical")
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, inc)
}
