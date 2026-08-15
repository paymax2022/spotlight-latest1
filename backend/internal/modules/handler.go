package modules

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ─── Client-facing ───────────────────────────────────────────────────────────

// Visibility answers "what may I show?" for the environment this process serves.
// GET /api/v1/modules/visibility
//
// It returns keys only, scoped to this tier — never the full registry. A client
// has no business knowing that a module exists but is unpublished, and leaking
// that from a production deployment would advertise unreleased work.
func (h *Handler) Visibility(c *gin.Context) {
	keys, err := h.svc.VisibleKeys(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load module visibility"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"environment": h.svc.Env(),
		"modules":     keys,
	}})
}

// ─── Admin ───────────────────────────────────────────────────────────────────

// List returns the whole registry with every environment's state.
// GET /api/v1/admin/modules
func (h *Handler) List(c *gin.Context) {
	mods, err := h.svc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"environment": h.svc.Env(),
		"modules":     mods,
	}})
}

type setVisibilityRequest struct {
	Environment string `json:"environment" binding:"required"`
	Status      string `json:"status" binding:"required"`
	Note        string `json:"note"`
}

// SetVisibility publishes or hides a module in one environment.
// PATCH /api/v1/admin/modules/:key/visibility
func (h *Handler) SetVisibility(c *gin.Context) {
	var req setVisibilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	status, err := ParseStatus(req.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.SetVisibility(c.Request.Context(), c.Param("key"),
		Environment(req.Environment), status, req.Note, c.GetString("user_id"))
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

type setLifecycleRequest struct {
	Lifecycle string `json:"lifecycle" binding:"required"`
	Note      string `json:"note"`
}

// SetLifecycle archives or restores a module.
// PATCH /api/v1/admin/modules/:key/lifecycle
func (h *Handler) SetLifecycle(c *gin.Context) {
	var req setLifecycleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	lc, err := ParseLifecycle(req.Lifecycle)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.SetLifecycle(c.Request.Context(), c.Param("key"), lc, req.Note, c.GetString("user_id"))
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// History returns the audit trail for one module.
// GET /api/v1/admin/modules/:key/history
func (h *Handler) History(c *gin.Context) {
	entries, err := h.svc.History(c.Request.Context(), c.Param("key"), 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// writeErr maps domain errors to status codes. A bad request must not read as a
// server fault: the console shows the operator the actual reason.
func (h *Handler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrModuleNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidEnv), errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrInvalidLifecycle):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrArchivedModule):
		// 409: the request is well-formed, it conflicts with the module's state.
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}
