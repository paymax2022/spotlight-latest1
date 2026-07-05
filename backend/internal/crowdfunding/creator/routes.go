package creator

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Register wires the crowdfunding creator-dashboard routes onto the supplied
// router group. The caller mounts `rg` under the crowdfunding prefix and applies
// auth middleware that sets `user_id`.
//
// IMPORTANT: the campaign-scoped routes use the SAME param name ':id' as the
// sibling discovery/wallet packages (which register /campaigns/:id,
// /campaigns/:id/wallet, /campaigns/:id/ledger on the same group) to avoid Gin
// wildcard-conflict panics on the shared /campaigns/:id/* tree.
//
// Routes (relative to rg):
//
//	GET    /campaigns/:id/contributors          → contributors (derived)
//	GET    /campaigns/:id/milestones            → campaign milestones
//	GET    /campaigns/saved                     → caller's saved campaigns
//	GET    /campaigns/recently-viewed           → caller's recently viewed
//	POST   /campaigns/:id/save                  → save a campaign
//	DELETE /campaigns/:id/save                  → unsave a campaign
//	GET    /contributions                       → caller's contributions
//	GET    /contributions/:id                   → a single contribution
//	POST   /contributions/:id/refund-request    → record refund intent (no money)
//	GET    /creator/stats                       → creator dashboard stats (derived)
//	GET    /creator/campaigns                   → creator's campaigns
//	GET    /creator/contributions               → recent contributions to creator
//	GET    /creator/withdrawals                 → creator's withdrawal requests
//	GET    /creator/notifications               → creator notifications
//	GET    /creator/campaigns/:id/analytics     → campaign analytics (derived)
//	GET    /rewards/backers                      → reward fulfilment queue
//	PUT    /rewards/fulfilment/:id               → update reward fulfilment status
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	// Campaign-scoped reads / saves (shared :id param with sibling packages).
	rg.GET("/campaigns/:id/contributors", h.GetContributors)
	rg.GET("/campaigns/:id/milestones", h.GetMilestones)
	rg.POST("/campaigns/:id/save", h.SaveCampaign)
	rg.DELETE("/campaigns/:id/save", h.UnsaveCampaign)

	// Static campaign-collection routes — mounted OFF the /campaigns/:id param
	// tree (Gin panics on a static sibling of a wildcard segment).
	rg.GET("/saved-campaigns", h.GetSaved)
	rg.GET("/recently-viewed", h.GetRecentlyViewed)

	// Contributions (caller's own) + refund-request (record-only).
	rg.GET("/contributions", h.ListContributions)
	rg.GET("/contributions/:id", h.GetContribution)
	rg.POST("/contributions/:id/refund-request", h.RequestRefund)

	// Creator dashboard.
	rg.GET("/creator/stats", h.GetCreatorStats)
	rg.GET("/creator/campaigns", h.GetMyCampaigns)
	rg.GET("/creator/contributions", h.GetCreatorContributions)
	rg.GET("/creator/withdrawals", h.GetCreatorWithdrawals)
	rg.GET("/creator/notifications", h.GetCreatorNotifications)
	rg.GET("/creator/campaigns/:id/analytics", h.GetCampaignAnalytics)

	// Reward fulfilment.
	rg.GET("/rewards/backers", h.GetRewardBackers)
	rg.PUT("/rewards/fulfilment/:id", h.UpdateRewardStatus)
}
