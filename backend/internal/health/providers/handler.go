package healthproviders

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the provider onboarding routes. The acting user id is always
// taken from c.Get("user_id") (mirrored by the finance auth chain) so a caller can
// never act as another identity (object-level authZ).
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// CreateApplication — POST /providers/applications
func (h *Handler) CreateApplication(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Domain       string `json:"domain"`
		ProviderType string `json:"provider_type"`
		DisplayName  string `json:"display_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	app, err := h.svc.CreateApplication(c.Request.Context(), id, req.Domain, req.ProviderType, req.DisplayName)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "application": app})
}

// AddCredential — POST /providers/applications/:id/credentials
func (h *Handler) AddCredential(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var d CredentialDoc
	if err := c.ShouldBindJSON(&d); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.AddCredential(c.Request.Context(), id, c.Param("id"), d)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "credential": out})
}

// Submit — POST /providers/applications/:id/submit
func (h *Handler) Submit(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	app, err := h.svc.Submit(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "application": app})
}

// Get — GET /providers/applications/:id
func (h *Handler) Get(c *gin.Context) {
	id := uid(c)
	app, err := h.svc.GetApplication(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "application": app})
}

// List — GET /providers/applications
func (h *Handler) List(c *gin.Context) {
	apps, err := h.svc.ListApplications(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "applications": apps})
}

// Decision — POST /admin .../providers/applications/:id/decision  (RBAC: health.admin.providers)
func (h *Handler) Decision(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Action string `json:"action"` // start_review | need_info | approve | reject
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	app, err := h.svc.Decision(c.Request.Context(), id, c.Param("id"), req.Action, req.Note)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "application": app})
}
