package healthvet

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Admin handlers — RBAC health.vet.* applied at route registration. These are
// admin-basis oversight reads/controls (VCN audit, appointment oversight, e-Rx
// audit, service/fee governance). PII is never surfaced (ids/state only).

// AdminListAppointments — GET /admin/appointments?state=&provider_id=
func (h *Handler) AdminListAppointments(c *gin.Context) {
	rows, err := h.svc.AdminListAppointments(c.Request.Context(), c.Query("state"), c.Query("provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": rows})
}

// AdminVCNAudit — GET /admin/vcn-audit  (VCN credential audit, HL-2/HL-12)
func (h *Handler) AdminVCNAudit(c *gin.Context) {
	rows, err := h.svc.AdminVCNAudit(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "providers": rows})
}

// AdminERxAudit — GET /admin/erx-audit?provider_id=  (e-prescription audit, HL-3/HL-12)
func (h *Handler) AdminERxAudit(c *gin.Context) {
	rows, err := h.svc.AdminERxAudit(c.Request.Context(), c.Query("provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescriptions": rows})
}

// AdminDeactivateService — POST /admin/services/:id/deactivate  (fee governance)
func (h *Handler) AdminDeactivateService(c *gin.Context) {
	if err := h.svc.AdminDeactivateService(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
