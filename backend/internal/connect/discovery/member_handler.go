package connectdiscovery

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// MemberHandler exposes the mobile-aligned member discovery surface
// (stack / swipe / likes-you / nearby / rewind / boosts). All responses are
// camelCase and NEVER carry raw coordinates. It wraps the shared discovery
// Service (ranking + privacy), a LikeRecorder (the mutual-match transaction), and
// the boost money service.
type MemberHandler struct {
	svc   *Service
	liker LikeRecorder
	boost *BoostService
}

// NewMemberHandler builds the member discovery handler. boost may be nil (boost
// routes are then skipped by the wiring), but svc and liker are required.
func NewMemberHandler(svc *Service, liker LikeRecorder, boost *BoostService) *MemberHandler {
	return &MemberHandler{svc: svc, liker: liker, boost: boost}
}

func memberUID(c *gin.Context) string  { return c.GetString("user_id") }
func memberIdem(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// mapDiscoveryError converts service errors to HTTP status codes, mirroring the
// gifting/voting money-error shape so the money path reports consistently.
func mapDiscoveryError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNoProfile):
		c.JSON(http.StatusBadRequest, gin.H{"error": "create your profile first"})
	case errors.Is(err, ErrSelfSwipe):
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot swipe your own profile"})
	case errors.Is(err, ErrInvalidSwipe):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTargetNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "target profile not found"})
	case errors.Is(err, ErrNothingToUndo):
		c.JSON(http.StatusConflict, gin.H{"error": "no recent swipe to undo"})
	case errors.Is(err, ErrBoostMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrBoostInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"), strings.Contains(msg, "disabled"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "discovery request failed"})
		}
	}
}

func memberLimit(c *gin.Context, def int) int {
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// Stack — GET /discovery/stack?limit=&<filters> → { profiles: [ProfileCard...] }.
func (h *MemberHandler) Stack(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	f := StackFilters{
		Mode:         c.Query("mode"),
		VerifiedOnly: c.Query("verified") == "true" || c.Query("verifiedOnly") == "true",
		Intent:       c.Query("intent"),
		Limit:        memberLimit(c, 20),
	}
	if v := c.Query("maxDistanceKm"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.MaxDistKm = n
		}
	}
	cards, err := h.svc.Stack(c.Request.Context(), uid, f)
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": cards})
}

// SwipeRequest is the POST /discovery/swipe body.
type SwipeRequest struct {
	TargetID  string `json:"targetId" binding:"required"`
	Direction string `json:"direction" binding:"required"` // like | pass | superlike
}

// Swipe — POST /discovery/swipe → { match: bool, matchId?: string }.
func (h *MemberHandler) Swipe(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req SwipeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	matched, matchID, err := h.svc.Swipe(c.Request.Context(), uid, req.TargetID, req.Direction, h.liker)
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	resp := gin.H{"match": matched}
	if matchID != "" {
		resp["matchId"] = matchID
	}
	c.JSON(http.StatusOK, resp)
}

// LikesYou — GET /discovery/likes-you → { profiles: [...] } (reverse-likes).
func (h *MemberHandler) LikesYou(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	cards, err := h.svc.LikesYou(c.Request.Context(), uid, memberLimit(c, 50))
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": cards})
}

// Nearby — GET /discovery/nearby → { profiles: [{ ...card, distanceBucket }] }.
// Bucketed distance ONLY; raw coordinates never leave the service.
func (h *MemberHandler) Nearby(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	cards, err := h.svc.Nearby(c.Request.Context(), uid, memberLimit(c, 50))
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": cards})
}

// Rewind — POST /discovery/rewind → { undone: profileId } (premium action).
func (h *MemberHandler) Rewind(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	undone, err := h.svc.Rewind(c.Request.Context(), uid)
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"undone": undone})
}

// BoostInfo — GET /discovery/boosts → { activeBoost?, priceKobo, durationMinutes }.
func (h *MemberHandler) BoostInfo(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	info, err := h.boost.Info(c.Request.Context(), uid)
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

// BuyBoostRequest is the POST /discovery/boosts body. durationMinutes is optional
// and validated against config server-side (a client cannot buy an arbitrary window).
type BuyBoostRequest struct {
	DurationMinutes int `json:"durationMinutes"`
}

// BuyBoost — POST /discovery/boosts (Idempotency-Key required) → { boost: Boost }.
// MONEY PATH: charges priceKobo via the ledger (balanced double-entry), tier-checked
// fail-closed, audited. The Idempotency-Key dedups the charge.
func (h *MemberHandler) BuyBoost(c *gin.Context) {
	uid := memberUID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req BuyBoostRequest
	// Body is optional; ignore bind errors on an empty body.
	_ = c.ShouldBindJSON(&req)
	b, err := h.boost.Purchase(c.Request.Context(), uid, memberIdem(c), req.DurationMinutes)
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"boost": b})
}
