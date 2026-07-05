package investment

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Register wires the crowdfunding investment routes onto the supplied router
// group. The caller mounts `rg` under the crowdfunding prefix (so routes resolve
// to /api/finance/crowdfunding/investment/...) and applies auth middleware that
// sets `user_id`.
//
// Routes (relative to rg):
//
//	GET  /investment/profile      → caller's investor onboarding profile
//	POST /investment/onboarding   → advance one onboarding gate
//	GET  /investment/offers       → list investment offers
//	GET  /investment/offers/:id   → single offer detail
//	GET  /investment/education    → investor education modules
//	GET  /investment/quiz         → suitability quiz questions
//	POST /investment/subscribe    → subscribe (money mutation, Idempotency-Key)
//	GET  /investment/portfolio    → caller's holdings
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	inv := rg.Group("/investment")
	inv.GET("/profile", h.GetProfile)
	inv.POST("/onboarding", h.CompleteOnboarding)
	inv.GET("/offers", h.GetOffers)
	inv.GET("/offers/:id", h.GetOffer)
	inv.GET("/education", h.GetEducation)
	inv.GET("/quiz", h.GetQuiz)
	inv.POST("/subscribe", h.Subscribe)
	inv.GET("/portfolio", h.GetPortfolio)
}
