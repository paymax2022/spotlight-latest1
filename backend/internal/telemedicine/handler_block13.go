package telemedicine

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ─── Block 13: Availability ──────────────────────────────────────────────────

// GetAvailability handles GET /telemedicine/doctors/:id/availability.
func (h *Handler) GetAvailability(c *gin.Context) {
	slots, err := h.svc.GetAvailability(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": slots})
}

// ─── Block 13: Confirm / Reschedule ──────────────────────────────────────────

// ConfirmAppointment handles POST /telemedicine/appointments/:id/confirm.
func (h *Handler) ConfirmAppointment(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.ConfirmAppointment(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RescheduleAppointment handles POST /telemedicine/appointments/:id/reschedule.
func (h *Handler) RescheduleAppointment(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RescheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RescheduleAppointment(c.Request.Context(), c.Param("id"), userID, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Block 13: Reviews ───────────────────────────────────────────────────────

// AddReview handles POST /telemedicine/appointments/:id/review.
func (h *Handler) AddReview(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SubmitReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.AddReview(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": r})
}

// ListDoctorReviews handles GET /telemedicine/doctors/:id/reviews.
func (h *Handler) ListDoctorReviews(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	reviews, err := h.svc.ListDoctorReviews(c.Request.Context(), c.Param("id"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": reviews})
}

// ─── Block 13: Visit summary ─────────────────────────────────────────────────

// GetVisitSummary handles GET /telemedicine/appointments/:id/summary.
func (h *Handler) GetVisitSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	vs, err := h.svc.GetVisitSummary(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vs})
}
