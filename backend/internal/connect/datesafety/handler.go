package connectdatesafety

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the date-safety center endpoints (all member-scoped).
type Handler struct{ svc *Service }

// NewHandler wires the date-safety handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) (string, bool) {
	id := c.GetString("user_id")
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return "", false
	}
	return id, true
}

func statusFor(err error) int {
	if errors.Is(err, ErrNotFound) {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

// AddContact — POST /api/v1/connect/safety/trusted-contacts
func (h *Handler) AddContact(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	var req TrustedContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.AddContact(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not add contact"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": t})
}

// ListContacts — GET /api/v1/connect/safety/trusted-contacts
func (h *Handler) ListContacts(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	list, err := h.svc.ListContacts(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// DeleteContact — DELETE /api/v1/connect/safety/trusted-contacts/:id
func (h *Handler) DeleteContact(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteContact(c.Request.Context(), userID, c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// CreatePlan — POST /api/v1/connect/date-plans
func (h *Handler) CreatePlan(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	var req CreateDatePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.CreatePlan(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// Share — POST /api/v1/connect/date-plans/:id/share
func (h *Handler) Share(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	var req ShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Share(c.Request.Context(), userID, c.Param("id"), req)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// CheckIn — POST /api/v1/connect/date-plans/:id/checkin
func (h *Handler) CheckIn(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	p, err := h.svc.CheckIn(c.Request.Context(), userID, c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// Feedback — POST /api/v1/connect/date-plans/:id/feedback
func (h *Handler) Feedback(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	var req FeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Feedback(c.Request.Context(), userID, c.Param("id"), req)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}
