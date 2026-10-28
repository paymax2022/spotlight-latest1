package app

import (
	"log"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/estate"
)

// RegisterEstateProfile mounts the estate profile / ownership governance surface (estate-a M02:
// EST-UAT-0023, 0028, 0031, 0032, 0035, 0036) on the caller's /estate group.
//
// It takes the group rather than creating its own so the routes inherit
// estateHandler.LifecycleGate() — a pending (e.g. duplicate-suspected), suspended or closed estate
// takes no ownership or branding writes, and the review queue is the only way forward.
//
// Authorization is enforced in the service (assertEstateAdmin / assertResident) and, for a transfer
// decision, by estate_owner_transfer_decide() itself: the path binds the estate, and the single SQL
// writer refuses an actor who is not a party to the transfer.
func RegisterEstateProfile(est *gin.RouterGroup, h *estate.Handler) {
	// Estate profile: readable by any member, writable by an estate admin.
	est.GET("/:id/info", h.GetEstateInfo)
	est.PATCH("/:id/info", h.UpdateEstateInfo)

	// Governance configuration revision history, written by the estate_config trigger.
	est.GET("/:id/admin/config/history", h.GetEstateConfigHistory)

	// Two-party ownership handover.
	est.POST("/:id/owner-transfer", h.RequestOwnerTransfer)
	est.GET("/:id/owner-transfers", h.ListOwnerTransfers)
	est.POST("/:id/owner-transfer/:transferId/decide", h.DecideOwnerTransfer)

	// Phase 2.4 (estate-a M03): the unit occupancy registry, hung off the same group for the same
	// lifecycle gate. It is mounted here rather than at the call site because the two surfaces are one
	// governance decision — who this estate is, and who is allowed to live in it.
	RegisterEstateOccupancy(est, h)

	// Phase 2.5a (estate-d M18): the inbox archive / retention surface, for the same reason. Who the
	// estate is, who lives in it, and how long the estate keeps telling them about it.
	RegisterEstateNotifications(est, h)

	log.Println("[estate] profile / ownership governance routes registered")
}
