package restaurant

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────────────────────
// Admin store & menu management for /api/restaurant/admin/restaurants/*.
//
// WHY THESE EXIST
// The member-facing store/menu routes (/api/finance/restaurant/:id/...) are
// owner-only: Service.assertOwner compares the caller against restaurants.owner_id
// with no operator exemption. So a platform admin could VIEW a merchant's store in
// the ops console but could not fix a wrong price, hide an unavailable dish, or
// force a misbehaving store closed — every mutation answered 403.
//
// These handlers call the SAME service methods (no duplicated SQL, no second code
// path to drift) but run them under WithAdminOverride, which relaxes the ownership
// check. Every route is fail-closed behind RequirePermission(restaurant.manage) in
// internal/app/finance_routes.go — RBAC is the security boundary here, not
// ownership. The `restaurant: not found` existence check still applies, so a bad
// id is a 404 for operators too.
//
// The admin's own user id is still passed through, so anything that attributes an
// actor records the operator rather than the merchant.
// ─────────────────────────────────────────────────────────────────────────────

// adminCtx returns the request context marked as an admin-authenticated call.
// Grep `adminCtx(` to find every ownership-bypassing call in this file.
func adminCtx(c *gin.Context) context.Context {
	return WithAdminOverride(c.Request.Context())
}

// AdminGetRestaurant → GET /api/restaurant/admin/restaurants/:id
// (restaurant.manage). Store profile + full menu, for the console detail page.
// Read-only, so no override is needed — GetRestaurantDetail never checked owner.
func (h *Handler) AdminGetRestaurant(c *gin.Context) {
	detail, err := h.svc.GetRestaurantDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

// AdminUpdateRestaurant → PATCH /api/restaurant/admin/restaurants/:id
// (restaurant.manage). Partial edit of the store profile; nil fields unchanged.
func (h *Handler) AdminUpdateRestaurant(c *gin.Context) {
	var req UpdateRestaurantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.UpdateRestaurant(adminCtx(c), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// AdminModerationQueue → GET /admin/restaurant/listings/pending
//
// Listings awaiting review, oldest first — a moderation queue is worked in the
// order people have been waiting.
func (h *Handler) AdminModerationQueue(c *gin.Context) {
	list, err := h.svc.PendingListings(adminCtx(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"listings": list, "count": len(list)})
}

// AdminDecideListing → POST /admin/restaurant/listings/:id/decision
//
// Body {decision: approve|reject|changes, reason}. Rejecting or requesting
// changes without a reason is refused by the service — the owner needs something
// to act on.
func (h *Handler) AdminDecideListing(c *gin.Context) {
	var body struct {
		Decision string `json:"decision" binding:"required"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var to ListingReviewStatus
	switch body.Decision {
	case "approve":
		to = ListingApproved
	case "reject":
		to = ListingRejected
	case "changes":
		to = ListingChangesRequested
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "decision must be approve|reject|changes"})
		return
	}
	if err := h.svc.DecideListing(adminCtx(c), c.Param("id"), c.GetString("user_id"), to, body.Reason); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminUnclaimedRestaurants → GET /admin/restaurants/unclaimed
//
// Shops with no identifiable merchant: no owner, or an owner with no active
// merchant profile. Empty today (the linking migration resolved all 1539 legacy
// owners); it exists so an imported or admin-seeded row cannot sit unmanaged and
// unnoticed.
func (h *Handler) AdminUnclaimedRestaurants(c *gin.Context) {
	list, err := h.svc.UnclaimedRestaurants(adminCtx(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"restaurants": list, "count": len(list)})
}

// AdminSetAvailability → PATCH /api/restaurant/admin/restaurants/:id/availability
// (restaurant.manage). Operator force-open / force-close, e.g. suspending a store
// that is accepting orders it cannot fulfil.
func (h *Handler) AdminSetAvailability(c *gin.Context) {
	var body struct {
		IsOpen *bool `json:"is_open" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.IsOpen == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "is_open is required"})
		return
	}
	r, err := h.svc.SetAvailability(adminCtx(c), c.Param("id"), c.GetString("user_id"), *body.IsOpen)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// AdminCreateCategory → POST /api/restaurant/admin/restaurants/:id/menu/categories
func (h *Handler) AdminCreateCategory(c *gin.Context) {
	var body struct {
		Name string `json:"name" binding:"required,min=1,max=120"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cat, err := h.svc.CreateCategory(adminCtx(c), c.Param("id"), c.GetString("user_id"), body.Name)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, cat)
}

// AdminDeleteCategory → DELETE /api/restaurant/admin/restaurants/:id/menu/categories/:categoryId
func (h *Handler) AdminDeleteCategory(c *gin.Context) {
	if err := h.svc.DeleteCategory(adminCtx(c), c.Param("id"), c.GetString("user_id"), c.Param("categoryId")); err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// AdminCreateItem → POST /api/restaurant/admin/restaurants/:id/menu/items
func (h *Handler) AdminCreateItem(c *gin.Context) {
	var req CreateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	it, err := h.svc.CreateItem(adminCtx(c), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, it)
}

// AdminUpdateItem → PATCH /api/restaurant/admin/restaurants/:id/menu/items/:itemId
// Price / availability / dietary tags. Price bounds are validated in the service,
// so an operator cannot set a nonsense price either.
func (h *Handler) AdminUpdateItem(c *gin.Context) {
	var req UpdateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	it, err := h.svc.UpdateItem(adminCtx(c), c.Param("id"), c.GetString("user_id"), c.Param("itemId"), req)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, it)
}

// AdminDeleteItem → DELETE /api/restaurant/admin/restaurants/:id/menu/items/:itemId
func (h *Handler) AdminDeleteItem(c *gin.Context) {
	if err := h.svc.DeleteItem(adminCtx(c), c.Param("id"), c.GetString("user_id"), c.Param("itemId")); err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
