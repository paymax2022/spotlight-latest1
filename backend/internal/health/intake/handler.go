package healthintake

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

// GetSchema — GET /intake/:schemaId
func (h *Handler) GetSchema(c *gin.Context) {
	sc, err := h.svc.GetSchema(c.Request.Context(), c.Param("schemaId"))
	if err != nil {
		fail(c, http.StatusNotFound, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "schema": sc})
}

// Submit — POST /intake/:schemaId/responses
func (h *Handler) Submit(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Answers map[string]any `json:"answers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	r, err := h.svc.Submit(c.Request.Context(), id, c.Param("schemaId"), req.Answers)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "response": r})
}

// PublishSchema — POST /admin .../intake/schemas  (RBAC: health.admin.intake)
func (h *Handler) PublishSchema(c *gin.Context) {
	var req struct {
		Slug    string  `json:"slug"`
		Version int     `json:"version"`
		Kind    string  `json:"kind"`
		Fields  []Field `json:"fields"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	sc, err := h.svc.PublishSchema(c.Request.Context(), req.Slug, req.Version, req.Kind, req.Fields)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "schema": sc})
}
