package spotlightwealth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Spotlight Wealth member API. user_id is set on the gin
// context by the auth middleware (c.GetString("user_id")). Responses are the raw
// payload (no envelope) to match the mobile api wrapper's
// unwrap(res.data?.data ?? res.data), mirroring the invest module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return c.GetString("user_id") }

func idemKey(c *gin.Context) string { return strings.TrimSpace(c.GetHeader("Idempotency-Key")) }

func httpErr(c *gin.Context, err error) {
	switch err {
	case ErrNotFound:
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case ErrForbidden:
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case ErrBadInput:
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case ErrChallengeEnded, ErrAlreadyJoined:
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "something went wrong"})
	}
}

// GetVideos — GET /videos?topic=
func (h *Handler) GetVideos(c *gin.Context) {
	vids, err := h.svc.ListVideos(c.Request.Context(), c.Query("topic"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, vids)
}

// GetChallenges — GET /challenges
func (h *Handler) GetChallenges(c *gin.Context) {
	out, err := h.svc.ListChallenges(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetChallenge — GET /challenges/:id
func (h *Handler) GetChallenge(c *gin.Context) {
	ch, err := h.svc.GetChallenge(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}

// JoinChallenge — POST /challenges/:id/join
func (h *Handler) JoinChallenge(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	ch, err := h.svc.JoinChallenge(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}

// CompleteChallenge — POST /challenges/:id/complete (money mutation; needs Idempotency-Key)
func (h *Handler) CompleteChallenge(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key required"})
		return
	}
	wallet, err := h.svc.CompleteChallenge(c.Request.Context(), uid, c.Param("id"), key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, wallet)
}

// GetLeaderboard — GET /leaderboard?metric=learning_points
func (h *Handler) GetLeaderboard(c *gin.Context) {
	out, err := h.svc.Leaderboard(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetRewardWallet — GET /reward-wallet
func (h *Handler) GetRewardWallet(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	w, err := h.svc.RewardWallet(c.Request.Context(), uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}

// GetCampaigns — GET /campaigns
func (h *Handler) GetCampaigns(c *gin.Context) {
	out, err := h.svc.ListCampaigns(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetCampaign — GET /campaigns/:id
func (h *Handler) GetCampaign(c *gin.Context) {
	ch, err := h.svc.GetCampaign(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}
