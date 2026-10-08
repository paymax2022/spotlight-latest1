package providerimport

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// Handler exposes the provider-policy mirror to the admin console.
type Handler struct{ svc *Service }

// NewHandler constructs the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register mounts the routes on the insurance admin group.
//
//	GET  /provider-policies         (insurance.reconciliation.view)
//	POST /provider-policies/sync    (insurance.reconciliation.resolve)
func Register(admin *gin.RouterGroup, h *Handler, guard func(permission string) gin.HandlerFunc) {
	g := admin.Group("/provider-policies")
	g.GET("", guard("insurance.reconciliation.view"), h.List)
	g.POST("/sync", guard("insurance.reconciliation.resolve"), h.Sync)
}

// List: GET /provider-policies?in_paymax=true|false&limit=&offset=
func (h *Handler) List(c *gin.Context) {
	var inPaymax *bool
	if v := c.Query("in_paymax"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "in_paymax must be true or false"})
			return
		}
		inPaymax = &b
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rows, ov, err := h.svc.List(c.Request.Context(), inPaymax, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"overview": ov, "policies": rows}})
}

// Sync: POST /provider-policies/sync
func (h *Handler) Sync(c *gin.Context) {
	actor := c.GetString("user_id")
	res, err := h.svc.Sync(c.Request.Context(), actor)
	if err != nil {
		if errors.Is(err, ErrNotConfigured) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "provider_not_configured"})
			return
		}
		// A provider/network failure is the provider's, not ours: 502, with what
		// was written before it broke so the operator can see partial progress.
		c.JSON(http.StatusBadGateway, gin.H{"error": httperr.Msg(c, http.StatusBadGateway, err), "data": res})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}
