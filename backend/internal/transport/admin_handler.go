package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminHandler serves the admin transport endpoints. Every mutation is audited
// in the underlying AdminService.
type AdminHandler struct{ svc *AdminService }

func NewAdminHandler(svc *AdminService) *AdminHandler { return &AdminHandler{svc: svc} }

// Dashboard returns mobility KPIs.
func (h *AdminHandler) Dashboard(c *gin.Context) {
	d, err := h.svc.Dashboard(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// ListDrivers returns the driver list / verification queue.
func (h *AdminHandler) ListDrivers(c *gin.Context) {
	ds, err := h.svc.ListDrivers(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"drivers": ds})
}

// DriverDetail returns a driver + docs + vehicle.
func (h *AdminHandler) DriverDetail(c *gin.Context) {
	d, err := h.svc.DriverDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// SetVerification is the guarded driver-verification transition.
func (h *AdminHandler) SetVerification(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req VerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetVerification(c.Request.Context(), adminID, c.Param("id"), req.Status, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "verification_status": req.Status})
}

// ListVehicles returns the vehicle compliance list.
func (h *AdminHandler) ListVehicles(c *gin.Context) {
	vs, err := h.svc.ListVehicles(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"vehicles": vs})
}

// SetVehicleStatus updates a vehicle compliance record.
func (h *AdminHandler) SetVehicleStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req VehicleStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetVehicleStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListTrips returns trips, optionally filtered by phase.
func (h *AdminHandler) ListTrips(c *gin.Context) {
	ts, err := h.svc.ListTrips(c.Request.Context(), c.Query("phase"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": ts})
}

// DispatchLive returns the live dispatch view.
func (h *AdminHandler) DispatchLive(c *gin.Context) {
	d, err := h.svc.DispatchLive(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// ManualAssign assigns a driver to a trip.
func (h *AdminHandler) ManualAssign(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req AssignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ManualAssign(c.Request.Context(), adminID, c.Param("trip_id"), req.DriverID, ""); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetPricing returns pricing config.
func (h *AdminHandler) GetPricing(c *gin.Context) {
	cfg, err := h.svc.GetPricing(c.Request.Context(), c.Query("zone"), c.Query("service_type"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// PatchPricing updates pricing config (audited).
func (h *AdminHandler) PatchPricing(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req PricingPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cfg, err := h.svc.PatchPricing(c.Request.Context(), adminID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// ListCommission returns commission tiers.
func (h *AdminHandler) ListCommission(c *gin.Context) {
	cs, err := h.svc.ListCommission(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tiers": cs})
}

// PatchCommission updates a commission tier (audited).
func (h *AdminHandler) PatchCommission(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CommissionPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cfg, err := h.svc.PatchCommission(c.Request.Context(), adminID, c.Param("tier"), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// ListIncidents returns the safety center feed.
func (h *AdminHandler) ListIncidents(c *gin.Context) {
	is, err := h.svc.ListIncidents(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"incidents": is})
}

// PatchIncident updates a safety case (audited).
func (h *AdminHandler) PatchIncident(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req SafetyIncidentPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchIncident(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ReportsSummary returns revenue/commission rollups.
func (h *AdminHandler) ReportsSummary(c *gin.Context) {
	r, err := h.svc.ReportsSummary(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// AuditFeed returns the transport audit log.
func (h *AdminHandler) AuditFeed(c *gin.Context) {
	a, err := h.svc.AuditFeed(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"audit": a})
}
