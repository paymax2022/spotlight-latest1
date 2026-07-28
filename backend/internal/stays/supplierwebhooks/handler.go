package supplierwebhooks

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Rail-B supplier webhook endpoint. The raw body is read for
// HMAC verification BEFORE JSON parsing, then the event is ingested idempotently.
type Handler struct {
	svc *Service
}

// NewHandler constructs the webhooks handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires the webhook route onto the webhooks group. The route is unauthen-
// ticated (no member JWT) and verified by HMAC signature instead.
//
//	POST /internal/webhooks/stays-supplier   (header: X-Stays-Signature)
func (h *Handler) Register(g *gin.RouterGroup) {
	g.POST("/stays-supplier", h.Receive)
}

// Receive verifies the signature, parses the event, and ingests it idempotently.
func (h *Handler) Receive(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}
	// Signature verification (fail-closed: no secret configured → reject).
	sig := c.GetHeader("X-Stays-Signature")
	if verr := h.svc.VerifySignature(body, sig); verr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}
	var ev Event
	if err := json.Unmarshal(body, &ev); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	if err := h.svc.Ingest(c.Request.Context(), ev); err != nil {
		if errors.Is(err, ErrDuplicate) {
			// Idempotent replay — acknowledge so the supplier stops retrying.
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "duplicate"}})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "applied"}})
}
