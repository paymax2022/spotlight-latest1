package webhooks

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the provider webhook ingestion routes. These routes are
// UNAUTHENTICATED (the provider calls them directly) but every request is
// signature-verified via the adapter before any state change.
type Handler struct {
	svc *Service
}

// NewHandler constructs the webhooks handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// MyCover (webhook): POST /internal/webhooks/mycover
func (h *Handler) MyCover(c *gin.Context) { h.ingest(c, "mycover") }

// Octamile (webhook): POST /internal/webhooks/octamile
func (h *Handler) Octamile(c *gin.Context) { h.ingest(c, "octamile") }

// ingest reads the raw body, pulls the signature header and hands off to the
// service. The raw body is never logged.
//
// The signature header name comes from the ADAPTER, not from the URL slug.
// Deriving it from the slug is what broke this before: MyCover is mounted at
// /internal/webhooks/mycover but signs with "x-mycoverai-signature", so a
// derived "X-mycover-Signature" never matched, the signature arrived empty, and
// every genuine delivery was rejected with a 401 that named no cause. Generic
// header names remain as fallbacks for adapters that declare none.
func (h *Handler) ingest(c *gin.Context, provider string) {
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}
	signature := ""
	if hdr := h.svc.SignatureHeaderFor(provider); hdr != "" {
		signature = c.GetHeader(hdr)
	}
	signature = firstNonEmpty(
		signature,
		c.GetHeader("X-Signature"),
		c.GetHeader("X-Webhook-Signature"),
	)
	out, err := h.svc.Ingest(c.Request.Context(), provider, payload, signature)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnknownProvider):
			c.JSON(http.StatusNotFound, gin.H{"error": "unknown provider"})
		case errors.Is(err, ErrBadSignature):
			// Reject unverified events (do NOT 200 — provider must retry/alert).
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	// Always 200 once verified + recorded (duplicates included) so the provider
	// stops retrying.
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
