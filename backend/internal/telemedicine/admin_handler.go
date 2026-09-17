package telemedicine

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// admin_handler.go — HTTP layer for the TELEMEDICINE-004 admin console. Routes
// are registered (RBAC-gated) in backend/internal/app/finance_routes.go.

// AdminGetDashboard handles GET /api/v1/telemedicine/admin/dashboard.
func (h *Handler) AdminGetDashboard(c *gin.Context) {
	dash, err := h.svc.GetAdminDashboard(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": dash})
}

// AdminListDoctors handles GET /api/v1/telemedicine/admin/doctors.
func (h *Handler) AdminListDoctors(c *gin.Context) {
	var q AdminDoctorListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, total, err := h.svc.ListAdminDoctors(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": q.Limit, "offset": q.Offset})
}

// AdminListAppointments handles GET /api/v1/telemedicine/admin/appointments.
func (h *Handler) AdminListAppointments(c *gin.Context) {
	var q AdminAppointmentListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, total, err := h.svc.ListAdminAppointments(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": q.Limit, "offset": q.Offset})
}

// AdminVerifyDoctor handles POST /api/v1/telemedicine/admin/doctors/:userId/verify.
func (h *Handler) AdminVerifyDoctor(c *gin.Context) {
	doctorUserID := c.Param("userId")
	reviewerID := c.GetString("user_id")
	var req AdminVerifyDoctorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.svc.VerifyDoctor(c.Request.Context(), reviewerID, doctorUserID, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrVerifyReasonRequired):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrVerifyIllegalTransition):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}
