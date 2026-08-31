package engage

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Register wires the crowdfunding engagement routes onto the supplied router
// group. The caller is responsible for mounting `rg` under the crowdfunding
// prefix and applying auth middleware that sets `user_id`.
//
// Routes (relative to rg):
//
//	GET  /help                       → help-center articles
//	GET  /support/tickets            → caller's support tickets
//	GET  /support/tickets/:id        → single ticket with messages
//	POST /support/tickets            → open a new ticket
//	POST /support/tickets/:id/reply  → append a reply, set ticket PENDING
//	GET  /notifications              → caller's notifications
//	POST /notifications/read         → mark all notifications read
//	POST /campaigns/:id/events       → record a VIEW or SHARE (analytics)
//	GET  /campaigns/:id/comments     → campaign comments + Q&A with replies
//	POST /campaigns/:id/comments     → post a comment or question
//	POST /comments/:commentId/reply  → creator reply to a comment
//	POST /comments/:commentId/report → flag a comment (idempotent)
//	GET  /settings/notifications     → notification preferences
//	PUT  /settings/notifications     → upsert notification preferences
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	rg.GET("/help", h.GetHelp)

	rg.GET("/support/tickets", h.ListTickets)
	rg.GET("/support/tickets/:id", h.GetTicket)
	rg.POST("/support/tickets", h.CreateTicket)
	rg.POST("/support/tickets/:id/reply", h.ReplyTicket)

	rg.GET("/notifications", h.GetNotifications)
	rg.POST("/notifications/read", h.MarkNotificationsRead)

	// Engagement events feeding creator analytics. Public-ish: an anonymous
	// view still counts, so this must not require user_id to be set.
	rg.POST("/campaigns/:id/events", h.RecordCampaignEvent)

	// Campaign comments and Q&A. The reply/report routes hang off /comments/:commentId
	// rather than the campaign, because that is the shape the client already calls —
	// it holds a comment id at that point, not a campaign id.
	//
	// The param is named :commentId, NOT :id: gin panics at boot on two different
	// wildcard names at the same position, and /campaigns/:id/* already claims :id
	// on this group.
	rg.GET("/campaigns/:id/comments", h.ListComments)
	rg.POST("/campaigns/:id/comments", h.PostComment)
	rg.POST("/comments/:commentId/reply", h.ReplyComment)
	rg.POST("/comments/:commentId/report", h.ReportComment)

	rg.GET("/settings/notifications", h.GetNotificationPrefs)
	rg.PUT("/settings/notifications", h.UpdateNotificationPrefs)
}
