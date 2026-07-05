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

	rg.GET("/settings/notifications", h.GetNotificationPrefs)
	rg.PUT("/settings/notifications", h.UpdateNotificationPrefs)
}
