package spotlightwealth

import "github.com/gin-gonic/gin"

// RegisterSpotlightwealth mounts the Spotlight Wealth member routes on the
// provided group. The caller passes a group already scoped to /spotlight and
// already carrying the auth middleware (user_id mirrored onto the gin context),
// matching the mobile base path /api/v1/spotlight/*.
//
//	GET  /videos?topic=              — creator-education videos
//	GET  /challenges                 — learn-and-earn challenges (+ joined state)
//	GET  /challenges/:id             — one challenge
//	POST /challenges/:id/join        — join a challenge
//	POST /challenges/:id/complete    — complete a challenge → wallet credit (Idempotency-Key)
//	GET  /leaderboard                — LEARNING-points leaderboard (never profit)
//	GET  /reward-wallet              — reward credit balance + history
//	GET  /campaigns                  — education/referral programmes
//	GET  /campaigns/:id              — one campaign
func RegisterSpotlightwealth(g *gin.RouterGroup, h *Handler) {
	g.GET("/videos", h.GetVideos)
	g.GET("/challenges", h.GetChallenges)
	g.GET("/challenges/:id", h.GetChallenge)
	g.POST("/challenges/:id/join", h.JoinChallenge)
	g.POST("/challenges/:id/complete", h.CompleteChallenge)
	g.GET("/leaderboard", h.GetLeaderboard)
	g.GET("/reward-wallet", h.GetRewardWallet)
	g.GET("/campaigns", h.GetCampaigns)
	g.GET("/campaigns/:id", h.GetCampaign)
}
