package app

import (
	"log"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/estate"
)

// RegisterEstateOccupancy mounts the unit occupancy surface (estate-a M03: EST-UAT-0043, 0044, 0045,
// 0046, 0048, 0051, 0052) on the caller's /estate group.
//
// Like the profile routes, it takes the group instead of creating its own: occupancy is a governance
// write, so a pending, suspended or closed estate must not be admitting residents into units.
//
// Every handler here passes the path estate and the caller's own id to the service; the privilege
// decision is the service's (assertEstateAdmin / landlord-of-the-unit) and then the database writer's,
// which re-checks both. A route never writes a party column on its own — that is the whole point of the
// single admitting function.
func RegisterEstateOccupancy(est *gin.RouterGroup, h *estate.Handler) {
	// Who occupies a unit, and who may change that.
	est.GET("/:id/occupants", h.ListOccupancies)
	est.GET("/:id/properties/:pid/occupants", h.ListOccupancies)
	est.POST("/:id/properties/:pid/occupants", h.AdmitOccupant)
	est.DELETE("/:id/properties/:pid/occupants/:userId", h.ReleaseOccupant)

	// The unit's own occupancy rules.
	est.PATCH("/:id/properties/:pid/capacity", h.SetUnitCapacity)

	// Occupancy proof: the claim queue an admin reads, and the verdict on a resident's documents.
	est.GET("/:id/ownership-claims", h.ListOwnershipClaims)
	est.GET("/:id/profile/occupancy-proof", h.GetOccupancyProof)
	est.POST("/:id/profile/occupancy-proof/verify", h.VerifyOccupancyProof)

	log.Println("[estate] unit occupancy / proof routes registered")
}
