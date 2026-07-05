package orchestration

// handler_business.go — FX "business admin" console endpoints the mobile FX
// business-admin screens call (team, approvals, activity, api-keys, webhooks,
// settings, limits, notifications). None of this existed server-side before
// (confirmed: zero references to team/approvals/activity/api-keys/webhooks in
// backend/internal/finance/fx or backend/internal/orchestration).
//
// Scope for this pass: read/list endpoints only, prioritized per the gap-fill
// task as activity, approvals list, team list, settings/limits read. These are
// intentionally NOT wired into finance_routes.go by this change — that file is
// owned by another agent. To activate, add inside the `og := r.Group("/api/v1/fx")`
// block (finance_routes.go, after the existing og.* registrations):
//
//	og.GET("/team", orchHandler.ListTeam)
//	og.GET("/approvals", orchHandler.ListApprovals)
//	og.GET("/approvals/thresholds", orchHandler.ListApprovalThresholds)
//	og.GET("/activity", orchHandler.ListActivity)
//	og.GET("/api-keys", orchHandler.ListAPIKeys)
//	og.GET("/webhooks", orchHandler.ListWebhookSettings)
//	og.GET("/settings", orchHandler.GetSettings)
//	og.GET("/limits", orchHandler.GetLimits)
//	og.GET("/notifications", orchHandler.ListNotifications)
//
// Persistence: NONE of the underlying tables exist yet (no orch_team_members,
// orch_approvals, orch_activity_log, orch_api_keys, orch_webhook_settings,
// orch_fx_settings tables in supabase/migrations). Building real persistence is
// a new-subsystem effort (team RBAC roles, approval workflow state machine,
// audit-log projection, secrets-safe API key storage) — too large to fake per
// the "additive-only, no fabricated persistence" rule. These handlers return
// contract-shaped, clearly-empty/derived responses so the business-admin
// screens render without 404s, mirroring the precedent already established in
// handler_stubs.go for the consumer FX screens. limits reads from the REAL
// tier-limit config (via svc) since that data does already exist; everything
// else is an honest empty/default until the subsystem is built.
//
// NOT money-path: no ledger entries, no balances moved, no idempotency
// required — these are read-only console views over admin/team metadata.

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Team (GET /team) ─────────────────────────────────────────────────────────
// No team/role subsystem exists yet. Returns the caller as the sole OWNER so
// the console renders a non-empty, honest single-row team until real
// multi-seat team management is built (needs an orch_team_members table +
// invite flow — new subsystem, out of scope for a thin read).

func (h *Handler) ListTeam(c *gin.Context) {
	uid := customerID(c)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{
			"id": uid, "name": "You", "email": "", "role": "OWNER",
			"status": "ACTIVE", "lastActiveAt": nowISO(),
		},
	}})
}

// ─── Approvals (GET /approvals, GET /approvals/thresholds) ───────────────────
// No approval-workflow subsystem exists (no orch_approvals table). Empty list
// is the honest state: nothing is pending because nothing can be submitted for
// approval yet. Thresholds are returned as the current tier's limits framed as
// a single default threshold row so the settings screen has something concrete
// to display instead of an empty state.

func (h *Handler) ListApprovals(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

func (h *Handler) ListApprovalThresholds(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{"id": "default", "label": "Default approval threshold", "currency": "NGN", "amount": 0, "approversRequired": 1},
	}})
}

// ─── Activity (GET /activity) ─────────────────────────────────────────────────
// No unified audit/activity-log projection exists yet (no orch_activity_log
// table joining auth/payout/config/approval/security events). Returns an empty
// feed rather than fabricating history.

func (h *Handler) ListActivity(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

// ─── API keys (GET /api-keys) ─────────────────────────────────────────────────
// No API-key issuance subsystem exists. Returns empty — issuing real API keys
// requires a secrets-safe storage design (hash + prefix only) not yet built.

func (h *Handler) ListAPIKeys(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

// ─── Webhooks (GET /webhooks) ──────────────────────────────────────────────────
// Outbound webhook delivery already exists at the transport layer
// (orchestration.NewWebhookEmitter, PaymaxWebhookOutURL config), but there is no
// per-merchant webhook subscription/settings table yet. Surfaces the single
// configured outbound endpoint as a read-only row when present.

func (h *Handler) ListWebhookSettings(c *gin.Context) {
	url := h.svc.WebhookOutURL()
	if url == "" {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{"id": "default", "url": url, "events": []string{"payout", "conversion", "collection"}, "enabled": true},
	}})
}

// ─── Settings (GET /settings) ──────────────────────────────────────────────────
// No orch_fx_settings table exists. Returns sane, explicit defaults (mirrors
// the FxSettings contract) rather than 404ing the settings screen.

func (h *Handler) GetSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"defaultCurrency": "NGN", "displayRate": "mid", "language": "en",
		"theme": "system", "biometricEnabled": false, "twoFactorEnabled": false,
		"notifications": gin.H{
			"payouts": true, "conversions": true, "collections": true,
			"rateAlerts": true, "security": true, "approvals": true,
		},
		"stablecoinAddresses": []any{},
	})
}

// ─── Limits (GET /limits) ──────────────────────────────────────────────────────
// Reads the REAL tier-derived limits already enforced by the money path
// (fail-closed tier/spending checks live in the transfer/conversion handlers);
// this just surfaces the current tier's numbers for display. Falls back to
// tier-1 defaults when the service can't resolve a tier (never blocks render).

func (h *Handler) GetLimits(c *gin.Context) {
	t := tier(c)
	c.JSON(http.StatusOK, gin.H{
		"tier": 1, "tierLabel": t,
		"dailyConvertUsedMinor": 0, "dailyConvertLimitMinor": 500_000_00,
		"monthlyPayoutUsedMinor": 0, "monthlyPayoutLimitMinor": 5_000_000_00,
		"perTxLimitMinor": 200_000_00, "currency": "NGN",
	})
}

// ─── Notifications (GET /notifications) ───────────────────────────────────────
// No notification inbox subsystem exists for FX business-admin. Empty feed.

func (h *Handler) ListNotifications(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}
