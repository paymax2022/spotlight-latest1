package marketplace

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_account.go — Trust & Account gap endpoints the mobile Account tab needs
// (§ Mobile-UX-Flows.md 28–34) that the core marketplace did not yet expose:
//
//   • Saved items / wishlist  : POST/DELETE /listings/:id/save, GET /saved-items
//   • Reports (safety valve)   : POST /reports
//   • Block user               : POST/DELETE /blocks/:id, GET /blocks
//   • Notification preferences : GET/PATCH /notification-prefs
//   • Meetup safe-spots        : GET /meetup/safe-spots
//
// All are non-money metadata endpoints (no Idempotency-Key, no ledger), Bearer-auth,
// owner-scoped (OLA enforced in the service). Responses are snake_case via respond().

// ─── Saved items / wishlist ──────────────────────────────────────────────────

// SaveListing POST /listings/:id/save — add a listing to the caller's wishlist.
func (h *Handler) SaveListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	item, err := h.svc.SaveListing(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, item)
}

// UnsaveListing DELETE /listings/:id/save — remove a listing from the wishlist.
func (h *Handler) UnsaveListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.UnsaveListing(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// ListSavedItems GET /saved-items — the caller's saved listings (newest first).
func (h *Handler) ListSavedItems(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	limit, offset := pageParams(c)
	items, err := h.svc.ListSavedItems(c.Request.Context(), uid, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, items)
}

// ─── Reports ─────────────────────────────────────────────────────────────────

// CreateReport POST /reports — file a report against a listing, seller, or chat.
func (h *Handler) CreateReport(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in CreateReportInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	r, err := h.svc.CreateReport(c.Request.Context(), uid, in)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, gin.H{"report": r})
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

// CreateBlock POST /blocks — block another user.
func (h *Handler) CreateBlock(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		BlockedUserID string `json:"blocked_user_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.BlockUser(c.Request.Context(), uid, body.BlockedUserID)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, b)
}

// DeleteBlock DELETE /blocks/:id — unblock (id = the block row id).
func (h *Handler) DeleteBlock(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.UnblockUser(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// ListBlocks GET /blocks — the caller's blocked users.
func (h *Handler) ListBlocks(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	blocks, err := h.svc.ListBlocks(c.Request.Context(), uid)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, blocks)
}

// ─── Followed sellers ────────────────────────────────────────────────────────

// FollowSeller POST /sellers/:id/follow.
func (h *Handler) FollowSeller(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.FollowSeller(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, gin.H{"ok": true})
}

// UnfollowSeller DELETE /sellers/:id/follow.
func (h *Handler) UnfollowSeller(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if err := h.svc.UnfollowSeller(c.Request.Context(), uid, c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// ListFollowedSellers GET /followed-sellers — the caller's followed sellers,
// newest-first.
func (h *Handler) ListFollowedSellers(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	sellers, err := h.svc.ListFollowedSellers(c.Request.Context(), uid)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, sellers)
}

// ─── Notification preferences ────────────────────────────────────────────────

// GetNotificationPrefs GET /notification-prefs — the caller's per-category toggles
// (defaults returned when no row exists yet).
func (h *Handler) GetNotificationPrefs(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	p, err := h.svc.GetNotificationPrefs(c.Request.Context(), uid)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, p)
}

// UpdateNotificationPrefs PATCH /notification-prefs — partial update (only the
// supplied toggles change; omitted ones are left as-is).
func (h *Handler) UpdateNotificationPrefs(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in NotificationPrefsPatch
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	p, err := h.svc.UpdateNotificationPrefs(c.Request.Context(), uid, in)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, p)
}

// ─── Meetup safe-spots ───────────────────────────────────────────────────────

// MeetupSafeSpots GET /meetup/safe-spots?state=&lga= — curated verified-safe
// meetup locations for the Transact agent's Meetup Mode (§27).
func (h *Handler) MeetupSafeSpots(c *gin.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	spots := h.svc.MeetupSafeSpots(c.Query("state"), c.Query("lga"))
	respond(c, http.StatusOK, spots)
}
