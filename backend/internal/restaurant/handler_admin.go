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

// AdminListPayoutRuns → GET /api/restaurant/admin/payouts (restaurant.admin.payouts).
// Real disbursement runs (restaurant + rider), newest first. Each row is an
// auditable payout run whose net was (or will be) posted to the provider wallet
// via a balanced ledger transfer.
func (h *Handler) AdminListPayoutRuns(c *gin.Context) {
	runs, err := h.svc.ListRuns(c.Request.Context(), 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if runs == nil {
		runs = []PayoutRun{}
	}
	c.JSON(http.StatusOK, runs)
}

// AdminGetPayoutRun → GET /api/restaurant/admin/payouts/:id (restaurant.admin.payouts).
// A single run plus its append-only provenance lines.
func (h *Handler) AdminGetPayoutRun(c *gin.Context) {
	run, err := h.svc.GetRun(c.Request.Context(), c.Param("id"))
	if err != nil {
		if err == ErrPayoutRunNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, run)
}

// AdminBuildPayoutRun → POST /api/restaurant/admin/payouts/build
// (restaurant.admin.payouts)  body {period_key, provider_type, provider_id}.
// Aggregates settled-but-unpaid settlements for the provider/period into a draft
// run + lines. Idempotent per (provider, period). No money moves at build time.
func (h *Handler) AdminBuildPayoutRun(c *gin.Context) {
	var body struct {
		PeriodKey    string `json:"period_key" binding:"required"`
		ProviderType string `json:"provider_type" binding:"required"`
		ProviderID   string `json:"provider_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	run, err := h.svc.BuildRun(c.Request.Context(), body.PeriodKey, body.ProviderType, body.ProviderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, run)
}

// AdminProcessPayoutRun → POST /api/restaurant/admin/payouts/:id/process
// (restaurant.admin.payouts). Disburses a draft run: posts ONE balanced ledger
// transfer (DR settlement account, CR provider wallet) keyed on the run's
// idempotency_key and flips draft->processing->paid. REQUIRES an Idempotency-Key
// header (money mutation). Idempotent + fail-closed: a duplicate never double-pays.
func (h *Handler) AdminProcessPayoutRun(c *gin.Context) {
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrPayoutMissingIdem.Error()})
		return
	}
	run, err := h.svc.ProcessRun(c.Request.Context(), c.Param("id"), idem)
	if err != nil {
		switch err {
		case ErrPayoutRunNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case ErrPayoutMissingIdem, ErrPayoutNothingDue:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, run)
}
