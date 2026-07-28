package investai

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the InvestAI education API. user_id is set on the gin context by
// the auth middleware (c.GetString("user_id")) — the same OLA convention the learn
// and invest modules use. Responses are returned as the raw payload (no envelope)
// to match the mobile api wrapper's unwrap(res.data?.data ?? res.data).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return c.GetString("user_id") }

func httpErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "something went wrong"})
	}
}

// Chat — POST /chat  { prompt, context?, session_id? } → { session_id, text, refused, disclaimer }
func (h *Handler) Chat(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	res, err := h.svc.Chat(c.Request.Context(), uid, req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ExplainAsset — POST /explain-asset  { symbol } → { symbol, text, disclaimer }
func (h *Handler) ExplainAsset(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req ExplainAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	res, err := h.svc.ExplainAsset(c.Request.Context(), req.Symbol)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListSessions — GET /sessions → [ ChatSession ]
func (h *Handler) ListSessions(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	sessions, err := h.svc.ListSessions(c.Request.Context(), uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sessions)
}

// GetHistory — GET /sessions/:id/messages → [ ChatMessage ] (owner-scoped)
func (h *Handler) GetHistory(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	msgs, err := h.svc.GetHistory(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, msgs)
}
