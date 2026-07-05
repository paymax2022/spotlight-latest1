package healthconsult

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }
func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// Notes — POST /consults/:id/notes  (in-call clinical note while in progress)
func (h *Handler) AddNote(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var n ClinicalNote
	if err := c.ShouldBindJSON(&n); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.AddNote(c.Request.Context(), id, c.Param("id"), n)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "note": out})
}

// Lobby — GET /consults/:id/lobby  (AV join token; provider/patient only)
func (h *Handler) Lobby(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	tok, err := h.svc.IssueLobbyToken(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "av": tok})
}

// Start — POST /consults/:id/start
func (h *Handler) Start(c *gin.Context) {
	out, err := h.svc.Start(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "consult": out})
}

// Complete — POST /consults/:id/complete  (persists clinical note)
func (h *Handler) Complete(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var n ClinicalNote
	if err := c.ShouldBindJSON(&n); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	cs, note, err := h.svc.Complete(c.Request.Context(), id, c.Param("id"), n)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "consult": cs, "note": note})
}
