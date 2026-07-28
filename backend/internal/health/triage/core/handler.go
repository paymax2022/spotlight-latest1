package core

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// parseDOB parses a YYYY-MM-DD date of birth; an empty/invalid value yields nil so
// the engine simply runs without an age band (it never receives the raw string).
func parseDOB(s string) *time.Time {
	if s == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil
	}
	return &t
}

// handler.go — gin handlers for the AI Symptom Checker. The acting user id is
// ALWAYS taken from c.GetString("user_id") (mirrored by the finance auth chain) so
// a caller can never act as another identity (object-level authZ). Every response
// carries the SC-1 framing (possible causes, not diagnosis) via the service view.
type Handler struct{ svc *SessionService }

// NewHandler builds the handler.
func NewHandler(svc *SessionService) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// --- profiles ---

// ListProfiles — GET /health/triage/profiles
func (h *Handler) ListProfiles(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	out, err := h.svc.ListProfiles(c.Request.Context(), id)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profiles": out})
}

// CreateProfile — POST /health/triage/profiles
func (h *Handler) CreateProfile(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		Sex        string `json:"sex"`
		DOB        string `json:"dob"` // YYYY-MM-DD
		IsPregnant bool   `json:"is_pregnant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	dob := parseDOB(req.DOB)
	p, err := h.svc.CreateProfile(c.Request.Context(), id, req.Kind, req.Name, req.Sex, dob, req.IsPregnant)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "profile": p})
}

// --- sessions ---

// StartSession — POST /health/triage/sessions
func (h *Handler) StartSession(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req StartParams
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	sess, err := h.svc.StartSession(c.Request.Context(), id, req)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	// SC-8: surface the mandatory disclaimer from the first response onward.
	c.JSON(http.StatusCreated, gin.H{"success": true, "session": sess, "disclaimer": Disclaimer})
}

// SubmitIntake — POST /health/triage/sessions/:id/intake
func (h *Handler) SubmitIntake(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req IntakeParams
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	view, err := h.svc.SubmitIntake(c.Request.Context(), id, c.Param("id"), req)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": view})
}

// Answer — POST /health/triage/sessions/:id/answer
func (h *Handler) Answer(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Code  string `json:"code"`
		Value string `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	view, err := h.svc.Answer(c.Request.Context(), id, c.Param("id"), req.Code, req.Value)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": view})
}

// GetSession — GET /health/triage/sessions/:id
func (h *Handler) GetSession(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	view, err := h.svc.GetSession(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": view})
}
