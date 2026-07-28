package consent

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member NDPA consent routes for Stays.
type Handler struct {
	svc *Service
}

// NewHandler constructs the consent handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return c.GetString("user_id") }

// Status (member): GET /consent?scope= — has the guest granted current consent?
func (h *Handler) Status(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	scope := c.DefaultQuery("scope", DefaultScope)
	ok, err := h.svc.HasCurrent(c.Request.Context(), uid, scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"granted": ok, "version": CurrentNDPAVersion, "scope": scope}})
}

// Grant (member): POST /consent {scope} — record consent for the current version.
func (h *Handler) Grant(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		Scope string `json:"scope"`
	}
	_ = c.ShouldBindJSON(&body)
	r, err := h.svc.Grant(c.Request.Context(), uid, body.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": r})
}
