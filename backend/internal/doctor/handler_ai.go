package doctor

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// failAI maps AI-specific errors (the per-doctor rate guard → 429) before falling
// back to the shared handler error mapping.
func (h *AIHandler) failAI(c *gin.Context, err error) {
	if errors.Is(err, ErrAIRateLimited) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "AI assist rate limit exceeded, please retry shortly"})
		return
	}
	h.fail(c, err)
}

// handler_ai.go — Wave 5 (AI-assist) Gin handlers.
//
// AIHandler EMBEDS *Handler so it reuses the shared helpers (userID, fail, idemKey,
// rawBody) without redeclaring them, exactly like the Wave 4 handlers reuse them.
// It adds an *AIService for the AI-specific business logic.
//
// The generate endpoints return HTTP 200 with an AiEnvelope in EITHER the "ready"
// or "error" state (the UI drives generating→ready→error from the status field) —
// a disabled LLM or model failure is a 200 error-envelope, NOT an HTTP 5xx, and it
// carries NO fabricated medical content. A missing Idempotency-Key is a hard 400.
// The accept endpoint persists to the clinical note and returns 200.

// AIHandler exposes the doctor AI-assist endpoints.
type AIHandler struct {
	*Handler
	ai *AIService
}

// NewAIHandler builds the AI handler. base supplies the shared helpers (and the
// underlying *Service used by the accept path); aiSvc supplies the LLM-backed logic.
func NewAIHandler(base *Handler, aiSvc *AIService) *AIHandler {
	return &AIHandler{Handler: base, ai: aiSvc}
}

// POST /ai/note-summary — generate a SOAP/visit summary draft.
func (h *AIHandler) GenerateNoteSummary(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.ai.GenerateNoteSummary(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.failAI(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// POST /ai/note-summary/accept — persist the accepted summary onto the clinical note.
func (h *AIHandler) AcceptNoteSummary(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.ai.AcceptNoteSummary(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// POST /ai/rx-safety — analyse a prescription draft for safety findings.
func (h *AIHandler) CheckPrescriptionSafety(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.ai.CheckPrescriptionSafety(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.failAI(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// POST /ai/lab-explanation — plain-language explanation of a lab result.
func (h *AIHandler) ExplainLabResult(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.ai.ExplainLabResult(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.failAI(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
