package healthscheduling

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }
func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// Request — POST /appointments
func (h *Handler) Request(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		ProviderID  string    `json:"provider_id"`
		SubjectType string    `json:"subject_type"`
		VisitType   string    `json:"visit_type"`
		SlotStart   time.Time `json:"slot_start"`
		SlotEnd     time.Time `json:"slot_end"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	a, err := h.svc.Request(c.Request.Context(), id, req.ProviderID, req.SubjectType, req.VisitType, req.SlotStart, req.SlotEnd)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "appointment": a})
}

// List — GET /appointments
func (h *Handler) List(c *gin.Context) {
	out, err := h.svc.ListForPatient(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": out})
}

// Transition — POST /appointments/:id/transition  { state }
func (h *Handler) Transition(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		State string `json:"state"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	a, err := h.svc.Transition(c.Request.Context(), id, c.Param("id"), State(req.State))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Reschedule — POST /appointments/:id/reschedule  { slot_start, slot_end }
func (h *Handler) Reschedule(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		SlotStart time.Time `json:"slot_start"`
		SlotEnd   time.Time `json:"slot_end"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	a, err := h.svc.Reschedule(c.Request.Context(), id, c.Param("id"), req.SlotStart, req.SlotEnd)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}
