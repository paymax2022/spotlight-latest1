package healthconsent

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

// Grant / Revoke — POST /consent  (action discriminator in body)
func (h *Handler) Grant(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Action         string     `json:"action"` // grant | revoke
		ConsentID      string     `json:"consent_id"`
		GranteeID      string     `json:"grantee_id"`
		SubjectOwnerID string     `json:"subject_owner_id"`
		Scope          string     `json:"scope"`
		ExpiresAt      *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Action == "revoke" {
		if err := h.svc.Revoke(c.Request.Context(), id, req.ConsentID); err != nil {
			fail(c, http.StatusConflict, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}
	out, err := h.svc.Grant(c.Request.Context(), id, req.GranteeID, req.SubjectOwnerID, req.Scope, req.ExpiresAt)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "consent": out})
}

// List — GET /consent
func (h *Handler) List(c *gin.Context) {
	out, err := h.svc.ListForGrantor(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "consents": out})
}
