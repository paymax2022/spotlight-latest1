package app

import (
	"log"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/estate"
)

// RegisterEstateNotifications mounts the inbox archive / search / retention surface (estate-d M18:
// EST-UAT-0359, defect ESTD-D008) on the caller's /estate group.
//
// It takes the group rather than creating its own so the routes inherit estateHandler.LifecycleGate():
// the two governance writes (the retention policy, and running the sweep) are exactly the sort of
// decision a pending or suspended estate should not be making, and the personal writes inherit the same
// posture — a resident of a suspended estate can still read the inbox, they cannot mark it read. That is
// a consequence of the gate, not an accident, and the live lane asserts the 423 rather than leaving it
// untested.
//
// GET /:id/notifications is registered in the shared finance group and is deliberately not re-registered
// here (gin refuses a duplicate method+path); its handler was extended in place to take the new filters.
//
// Authorization is entirely in the service: every route below scopes to ginutil.UserID() — the caller's
// own rows — and the two admin routes assert estate_admin before they touch the schedule.
func RegisterEstateNotifications(est *gin.RouterGroup, h *estate.Handler) {
	// The recipient's own inbox.
	est.POST("/:id/notifications/read-all", h.MarkAllNotificationsRead)
	est.POST("/:id/notifications/:notificationId/read", h.MarkNotificationRead)
	est.POST("/:id/notifications/:notificationId/archive", h.ArchiveNotification)
	est.POST("/:id/notifications/:notificationId/pin", h.PinNotification)

	// The estate's retention schedule (estate admin).
	est.GET("/:id/notifications/retention", h.GetNotificationRetention)
	est.PUT("/:id/notifications/retention", h.SetNotificationRetention)
	est.POST("/:id/notifications/retention/run", h.RunNotificationRetention)

	log.Println("[estate] notification inbox / archive / retention routes registered")
}
