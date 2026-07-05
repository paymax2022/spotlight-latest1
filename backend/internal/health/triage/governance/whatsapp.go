package governance

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ── SC-8: a medical disclaimer + a one-tap emergency line MUST be appended to
// EVERY channel message. These constants are the canonical footer; appendSafety
// guarantees they are present on every WhatsApp reply. ──

const (
	// DisclaimerText — the symptom checker triages & navigates; it never diagnoses.
	DisclaimerText = "Note: This is general guidance for triage, not a medical diagnosis. Always consult a qualified health professional."
	// EmergencyLine — the one-tap emergency escalation shown on every message.
	EmergencyLine = "EMERGENCY? Reply 999 or call 112 now for an ambulance."
)

// appendSafety appends the SC-8 disclaimer + one-tap emergency line to a reply,
// idempotently (it won't double-append if a line is already present). Every
// outbound WhatsApp message passes through here.
func appendSafety(reply string) string {
	reply = strings.TrimRight(reply, "\n ")
	if !strings.Contains(reply, DisclaimerText) {
		reply += "\n\n" + DisclaimerText
	}
	if !strings.Contains(reply, EmergencyLine) {
		reply += "\n" + EmergencyLine
	}
	return reply
}

// TriageDriver is the injected port the WhatsApp handler maps a message onto. The
// core triage service adapts to it: given an external (channel) id + the user's
// text + language, it starts or continues a triage session and returns the reply,
// whether the disposition is an emergency, and any error. Keeping this an interface
// means the governance package never imports/edits the protected core service.
type TriageDriver interface {
	StartOrContinue(ctx context.Context, externalID, text, language string) (reply string, emergency bool, err error)
}

// WhatsAppHandler is the signed inbound WhatsApp webhook. It HMAC-verifies the raw
// body, idempotently resolves the external id → channel session (so a redelivered
// webhook never starts a duplicate triage), drives the TriageDriver, and returns a
// reply that ALWAYS carries the SC-8 disclaimer + one-tap emergency line.
type WhatsAppHandler struct {
	repo    *Repository
	secret  string
	driver  TriageDriver
	enabled bool
}

// NewWhatsAppHandler builds the handler. enabled mirrors the
// FeatureHealthTriageWhatsAppEnabled flag — when false the route is inert.
func NewWhatsAppHandler(repo *Repository, secret string, driver TriageDriver, enabled bool) *WhatsAppHandler {
	return &WhatsAppHandler{repo: repo, secret: secret, driver: driver, enabled: enabled}
}

const channelWhatsApp = "whatsapp"

// verifySignature does a constant-time HMAC-SHA256 check of the raw body against
// the configured secret. The signature header may be "sha256=<hex>" or bare hex.
func (h *WhatsAppHandler) verifySignature(body []byte, sig string) bool {
	if h.secret == "" || sig == "" {
		return false
	}
	sig = strings.TrimPrefix(strings.TrimSpace(sig), "sha256=")
	mac := hmac.New(sha256.New, []byte(h.secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(sig))
}

// inboundMessage is the minimal shape we read from a WhatsApp inbound payload.
// MessageID is the idempotency key (the provider's unique per-message id); From is
// the wa_id used as the external session id.
type inboundMessage struct {
	MessageID string `json:"message_id"`
	From      string `json:"from"`
	Text      string `json:"text"`
	Language  string `json:"language"`
}

// Handle handles POST /internal/webhooks/triage/whatsapp.
func (h *WhatsAppHandler) Handle(c *gin.Context) {
	if !h.enabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "whatsapp triage disabled"})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	sig := c.GetHeader("X-Hub-Signature-256")
	if sig == "" {
		sig = c.GetHeader("X-Signature")
	}
	if !h.verifySignature(body, sig) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	var msg inboundMessage
	if err := json.Unmarshal(body, &msg); err != nil || msg.From == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if msg.Language == "" {
		msg.Language = "en"
	}

	ctx := c.Request.Context()

	// Idempotency: key on the provider message id (unique per message). If we've
	// already processed this exact message, ack without re-driving the triage.
	idemKey := msg.MessageID
	if idemKey == "" {
		idemKey = msg.From // degrade gracefully; still de-dupes per sender turn
	}
	_, inserted, err := h.repo.UpsertChannelSession(ctx, channelWhatsApp, idemKey, nil)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	if !inserted {
		// Redelivery: already handled. Re-emit a safe ack (still SC-8 compliant).
		c.JSON(http.StatusOK, gin.H{"reply": appendSafety("We already received that message."), "duplicate": true})
		return
	}

	// Drive the core triage via the injected adapter, keyed by the sender wa_id.
	reply, emergency, derr := h.driver.StartOrContinue(ctx, msg.From, msg.Text, msg.Language)
	if derr != nil {
		// Even on error, return an SC-8-compliant safe message (emergency line always present).
		c.JSON(http.StatusOK, gin.H{
			"reply": appendSafety("Sorry, we hit a problem. If this is urgent, please seek care now."),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"reply":     appendSafety(reply),
		"emergency": emergency,
	})
}
