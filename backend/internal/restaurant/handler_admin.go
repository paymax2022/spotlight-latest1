package restaurant

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────────────────────
// Admin (ops-console) HTTP handlers for /api/restaurant/admin/*.
//
// Every route here is mounted behind RequireAuthContext + RequirePermission
// (restaurant.admin.{dispatch,onboarding,payouts}) in the app router; these
// handlers therefore assume an authenticated, authorized admin. Reads are thin
// projections; the two mutations (manual assign, onboarding decision) drive the
// existing idempotent state transitions. Disputes are intentionally NOT handled
// here — the console reuses the existing /api/finance/{disputes,admin/disputes}
// finance routes.
// ─────────────────────────────────────────────────────────────────────────────

// AdminListRiders → GET /api/restaurant/admin/riders (restaurant.admin.dispatch).
// Rider roster + live status from the shared transport driver pool.
func (h *Handler) AdminListRiders(c *gin.Context) {
	riders, err := h.svc.AdminListRiders(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if riders == nil {
		riders = []AdminRider{}
	}
	c.JSON(http.StatusOK, riders)
}

// AdminDispatchQueue → GET /api/restaurant/admin/dispatch/queue
// (restaurant.admin.dispatch). Orders awaiting or in dispatch.
func (h *Handler) AdminDispatchQueue(c *gin.Context) {
	queue, err := h.svc.AdminDispatchQueue(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if queue == nil {
		queue = []AdminDispatchOrder{}
	}
	c.JSON(http.StatusOK, queue)
}

// AdminAssignRider → POST /api/restaurant/admin/orders/:id/assign
// (restaurant.admin.dispatch)  body {rider_id}. Manual ops assignment. Reuses the
// same AssignRider service used by the owner route, but authorizes the actor as
// the restaurant owner so the ops admin can assign on the merchant's behalf.
func (h *Handler) AdminAssignRider(c *gin.Context) {
	var body struct {
		RiderID string `json:"rider_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AdminAssignRider(c.Request.Context(), c.Param("id"), body.RiderID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminListApplications → GET /api/restaurant/admin/onboarding?status=
// (restaurant.admin.onboarding). Restaurant merchant records awaiting KYC review.
func (h *Handler) AdminListApplications(c *gin.Context) {
	apps, err := h.svc.AdminListApplications(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if apps == nil {
		apps = []AdminApplication{}
	}
	c.JSON(http.StatusOK, apps)
}

// AdminDecideApplication → POST /api/restaurant/admin/onboarding/:id/decision
// (restaurant.admin.onboarding)  body {decision:'approve'|'reject', note}.
// Idempotent: approve opens the restaurant, reject keeps it closed. The frontend
// also targets /onboarding/:id/approve and /onboarding/:id/reject; both are
// registered and route through here with the decision taken from the path.
func (h *Handler) AdminDecideApplication(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	// Bind is best-effort: the decision may also come from the path segment.
	_ = c.ShouldBindJSON(&body)
	// The path segment carries the decision for /onboarding/:id/{approve,reject}.
	// The literal "decision" segment (/onboarding/:id/decision) is the sentinel for
	// the body-driven form, so fall back to body.Decision in that case.
	decision := c.Param("decision")
	if decision == "" || decision == "decision" {
		decision = body.Decision
	}
	if err := h.svc.AdminDecideApplication(c.Request.Context(), c.Param("id"), adminID, decision, body.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminPayoutRuns → GET /api/restaurant/admin/payouts (restaurant.admin.payouts).
// READ-ONLY reconciliation of settled food-delivery escrows by period. Moves no
// money (see report: no payout-run/disbursement service exists yet).
func (h *Handler) AdminPayoutRuns(c *gin.Context) {
	runs, err := h.svc.AdminPayoutRuns(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if runs == nil {
		runs = []AdminPayoutRun{}
	}
	c.JSON(http.StatusOK, runs)
}
