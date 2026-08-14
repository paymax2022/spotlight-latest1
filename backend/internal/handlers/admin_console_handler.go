package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// AdminConsoleHandler serves the unified /api/v1/admin/* endpoints for the mobile admin console.
// All endpoints require X-Admin-Role header (set by client) and are gated by RBAC middleware.
type AdminConsoleHandler struct {
	store *AdminStore
}

// NewAdminConsoleHandler creates a new admin console handler.
func NewAdminConsoleHandler(store *AdminStore) *AdminConsoleHandler {
	return &AdminConsoleHandler{store: store}
}

// ── Dashboard ────────────────────────────────────────────────────────────────

// Dashboard returns a top-of-console snapshot: user counts, pending queues, revenue, provider health.
// GET /api/v1/admin/dashboard
func (h *AdminConsoleHandler) Dashboard(c *gin.Context) {
	stats, err := h.store.GetDashboardStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load dashboard stats"})
		return
	}

	dashboard := gin.H{
		"users": stats.TotalUsers,
		"openKyc": stats.KYCPending,
		"pendingWithdrawals": 15, // Phase 2: query payouts table
		"failedOrders": stats.FailedTxns,
		"reconExceptions": 0, // Phase 2: query reconciliation_exceptions table
		"revenueToday": gin.H{
			"amount": 0, // Phase 2: sum fees from last 24h
			"currency": "NGN",
		},
		"revenueMonth": gin.H{
			"amount": 0, // Phase 2: sum fees from last 30 days
			"currency": "NGN",
		},
		"tradingVolume": gin.H{
			"amount": stats.TotalVolume,
			"currency": "NGN",
		},
		"providerSummary": []gin.H{
			{
				"name": "Paystack",
				"kind": "payments",
				"status": "healthy",
				"latencyMs": 142,
			},
			{
				"name": "Binance",
				"kind": "liquidity",
				"status": "healthy",
				"latencyMs": 287,
			},
			{
				"name": "Fireblocks",
				"kind": "custody",
				"status": "healthy",
				"latencyMs": 165,
			},
		},
	}
	c.JSON(http.StatusOK, dashboard)
}

// ── Users ────────────────────────────────────────────────────────────────────

// GetUsers returns a paginated list of users.
// GET /api/v1/admin/users
func (h *AdminConsoleHandler) GetUsers(c *gin.Context) {
	limit := 50
	offset := 0
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if o := c.Query("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}

	users, total, err := h.store.ListUsers(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load users"})
		return
	}

	result := []gin.H{}
	for _, u := range users {
		result = append(result, gin.H{
			"id": u.ID,
			"name": u.Name,
			"email": u.Email,
			"status": u.Status,
			"kycTier": u.Tier,
			"createdAt": u.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"users": result,
		"total": total,
		"limit": limit,
		"offset": offset,
	})
}

// GetUser returns detailed information for a specific user.
// GET /api/v1/admin/users/:id
func (h *AdminConsoleHandler) GetUser(c *gin.Context) {
	userID := c.Param("id")

	// TODO: Query detailed user record from users + ledger + kyc tables
	user := gin.H{
		"id": userID,
		"name": "Alice Johnson",
		"email": "alice@example.com",
		"status": "active",
		"kycTier": 2,
		"createdAt": time.Now().Add(-30*24*time.Hour).Format(time.RFC3339),
		"phone": "+234 801 234 5678",
		"country": "Nigeria",
		"kycStatus": "approved",
		"walletBalance": gin.H{
			"amount": 5250000,
			"currency": "NGN",
		},
		"lifetimeVolume": gin.H{
			"amount": 125000000,
			"currency": "NGN",
		},
		"lastActiveAt": time.Now().Add(-2*time.Hour).Format(time.RFC3339),
		"flags": []string{},
	}
	c.JSON(http.StatusOK, user)
}

// ── KYC Queue ───────────────────────────────────────────────────────────────

// GetKycQueue returns pending KYC cases awaiting review.
// GET /api/v1/admin/kyc
func (h *AdminConsoleHandler) GetKycQueue(c *gin.Context) {
	entries, err := h.store.GetKYCQueue(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load kyc queue"})
		return
	}

	cases := []gin.H{}
	for _, e := range entries {
		cases = append(cases, gin.H{
			"id": e.ID,
			"userId": e.UserID,
			"name": e.Name,
			"status": e.Status,
			"tier": e.Tier,
			"submittedAt": e.SubmittedAt,
			"riskFlags": []string{}, // Phase 2: query aml_checks table
		})
	}

	c.JSON(http.StatusOK, gin.H{"cases": cases})
}

// ReviewKyc approves, rejects, or escalates a KYC case.
// POST /api/v1/admin/kyc/:id/review
// Body: { decision: 'approve'|'reject'|'escalate', reason: string }
func (h *AdminConsoleHandler) ReviewKyc(c *gin.Context) {
	caseID := c.Param("id")

	var req struct {
		Decision string `json:"decision" binding:"required,oneof=approve reject escalate"`
		Reason   string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update kyc_sessions status; emit audit event; trigger tier upgrade if approved
	updatedCase := gin.H{
		"id": caseID,
		"userId": "usr_042",
		"name": "Chinyere Okonkwo",
		"status": req.Decision,
		"tier": 2,
		"submittedAt": time.Now().Add(-24*time.Hour).Format(time.RFC3339),
		"riskFlags": []string{"address_mismatch"},
	}
	c.JSON(http.StatusOK, updatedCase)
}

// ── Asset Controls ──────────────────────────────────────────────────────────

// GetAssetControls returns the list of tradable assets and their admin controls.
// GET /api/v1/admin/assets
func (h *AdminConsoleHandler) GetAssetControls(c *gin.Context) {
	// TODO: Query asset_controls table (or compute from feature flags + config)
	assets := []gin.H{
		{
			"id": "ast_001",
			"symbol": "BTC",
			"kind": "crypto",
			"buyEnabled": true,
			"sellEnabled": true,
			"withdrawalEnabled": true,
			"status": "active",
			"feeBps": 50,
			"minOrder": gin.H{"amount": 50000, "currency": "NGN"},
			"maxOrder": gin.H{"amount": 50000000, "currency": "NGN"},
		},
		{
			"id": "ast_002",
			"symbol": "ETH",
			"kind": "crypto",
			"buyEnabled": true,
			"sellEnabled": true,
			"withdrawalEnabled": true,
			"status": "active",
			"feeBps": 50,
			"minOrder": gin.H{"amount": 50000, "currency": "NGN"},
			"maxOrder": gin.H{"amount": 50000000, "currency": "NGN"},
		},
		{
			"id": "ast_003",
			"symbol": "AAPL",
			"kind": "stock",
			"buyEnabled": true,
			"sellEnabled": true,
			"withdrawalEnabled": false,
			"status": "active",
			"feeBps": 75,
			"minOrder": gin.H{"amount": 100000, "currency": "NGN"},
			"maxOrder": gin.H{"amount": 100000000, "currency": "NGN"},
		},
	}
	c.JSON(http.StatusOK, assets)
}

// UpdateAssetControl patches trading controls for one asset.
// PATCH /api/v1/admin/assets/:id
// Body: partial AssetControl (only set fields to update)
func (h *AdminConsoleHandler) UpdateAssetControl(c *gin.Context) {
	assetID := c.Param("id")

	var patch map[string]interface{}
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update asset_controls table; emit audit event
	updated := gin.H{
		"id": assetID,
		"symbol": "BTC",
		"kind": "crypto",
		"buyEnabled": patch["buyEnabled"],
		"sellEnabled": patch["sellEnabled"],
		"withdrawalEnabled": patch["withdrawalEnabled"],
		"status": patch["status"],
		"feeBps": patch["feeBps"],
		"minOrder": patch["minOrder"],
		"maxOrder": patch["maxOrder"],
	}
	c.JSON(http.StatusOK, updated)
}

// ── Orders ──────────────────────────────────────────────────────────────────

// GetOrders returns orders filtered by status or kind.
// GET /api/v1/admin/orders?filter=all|failed|pending|crypto|stock
func (h *AdminConsoleHandler) GetOrders(c *gin.Context) {
	orders, err := h.store.ListOrders(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load orders"})
		return
	}

	filter := c.DefaultQuery("filter", "all")

	result := []gin.H{}
	for _, o := range orders {
		// Apply filter.
		//
		// Compared against the AdminOrderStatus values the store normalises to
		// (see tradingOrdersSQL), NOT lower-case. The failed/pending groupings
		// mirror the console's own KPI tiles exactly — failed counts
		// Failed+Reversed, pending counts Pending+Processing — so the server-side
		// filter and the client-side count can never disagree.
		if filter != "all" {
			if (filter == "failed" && o.Status != "Failed" && o.Status != "Reversed") ||
				(filter == "pending" && o.Status != "Pending" && o.Status != "Processing") ||
				(filter == "crypto" && o.Type != "crypto") ||
				(filter == "stock" && o.Type != "stock") {
				continue
			}
		}

		result = append(result, gin.H{
			"ref": o.ID,
			"user": o.Email,
			"kind": o.Type,
			"side": "buy",
			"symbol": "", // Phase 2: extract from order details
			"status": o.Status,
			"amount": gin.H{"amount": o.Amount, "currency": "NGN"},
			"createdAt": o.CreatedAt,
			"providerRef": "", // Phase 2: from provider_reference column
		})
	}

	c.JSON(http.StatusOK, result)
}

// ── Withdrawal Review ───────────────────────────────────────────────────────

// GetWithdrawalQueue returns pending withdrawal requests awaiting review.
// GET /api/v1/admin/withdrawals
func (h *AdminConsoleHandler) GetWithdrawalQueue(c *gin.Context) {
	withdrawals, err := h.store.ListWithdrawals(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load withdrawals"})
		return
	}

	result := []gin.H{}
	for _, w := range withdrawals {
		result = append(result, gin.H{
			"reference": w.ID,
			"user": w.Email,
			"symbol": "BTC", // Phase 2: extract currency
			"amount": gin.H{"amount": w.Amount, "currency": "NGN"},
			"address": w.Account,
			"network": "bitcoin", // Phase 2: from withdrawal_network column
			"riskScore": 0, // Phase 2: calculate from transaction history
			"status": w.Status,
			"createdAt": w.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, result)
}

// ReviewWithdrawal approves, rejects, or escalates a withdrawal request.
// POST /api/v1/admin/withdrawals/:ref/review
// Body: { decision: 'approve'|'reject'|'escalate', reason: string }
func (h *AdminConsoleHandler) ReviewWithdrawal(c *gin.Context) {
	ref := c.Param("ref")

	var req struct {
		Decision string `json:"decision" binding:"required,oneof=approve reject escalate"`
		Reason   string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update withdrawal status; emit audit; trigger broadcast if approved
	updated := gin.H{
		"reference": ref,
		"user": "Alice Johnson",
		"symbol": "BTC",
		"amount": gin.H{"amount": 500000, "currency": "BTC"},
		"address": "1A1z7agoat4QJVA****",
		"network": "bitcoin",
		"riskScore": 15,
		"status": req.Decision,
		"createdAt": time.Now().Add(-8*time.Hour).Format(time.RFC3339),
	}
	c.JSON(http.StatusOK, updated)
}

// ── Reconciliation ──────────────────────────────────────────────────────────

// GetReconciliation returns open reconciliation exceptions.
// GET /api/v1/admin/reconciliation
func (h *AdminConsoleHandler) GetReconciliation(c *gin.Context) {
	// TODO: Query reconciliation exceptions table; compute deltas between internal ledger and external provider balances
	recon := gin.H{
		"asset": "BTC",
		"generatedAt": time.Now().Format(time.RFC3339),
		"exceptions": []gin.H{
			{
				"id": "recon_001",
				"asset": "BTC",
				"kind": "missing_ledger",
				"internal": gin.H{"amount": 1000000, "currency": "BTC"},
				"external": gin.H{"amount": 1050000, "currency": "BTC"},
				"delta": gin.H{"amount": 50000, "currency": "BTC"},
				"detectedAt": time.Now().Add(-12*time.Hour).Format(time.RFC3339),
			},
		},
	}
	c.JSON(http.StatusOK, recon)
}

// ── Providers ───────────────────────────────────────────────────────────────

// GetProviders returns health status of all integrated providers (Paystack, Binance, etc).
// GET /api/v1/admin/providers
func (h *AdminConsoleHandler) GetProviders(c *gin.Context) {
	// TODO: Query provider health endpoints in parallel; record latency + status
	providers := []gin.H{
		{
			"name": "Paystack",
			"kind": "payments",
			"status": "healthy",
			"latencyMs": 142,
			"lastCheck": time.Now().Add(-5*time.Minute).Format(time.RFC3339),
		},
		{
			"name": "Binance",
			"kind": "liquidity",
			"status": "healthy",
			"latencyMs": 287,
			"lastCheck": time.Now().Add(-3*time.Minute).Format(time.RFC3339),
		},
		{
			"name": "Fireblocks",
			"kind": "custody",
			"status": "healthy",
			"latencyMs": 165,
			"lastCheck": time.Now().Format(time.RFC3339),
		},
	}
	c.JSON(http.StatusOK, providers)
}

// ── Risk Limits ─────────────────────────────────────────────────────────────

// GetRiskLimits returns the current risk limit configuration.
// GET /api/v1/admin/risk-limits
func (h *AdminConsoleHandler) GetRiskLimits(c *gin.Context) {
	// TODO: Query risk_limits table or load from config
	limits := []gin.H{
		{
			"id": "rl_001",
			"label": "Daily withdrawal limit per user",
			"scope": "per_user_daily",
			"valueMinor": 10000000, // 100,000 NGN
			"currency": "NGN",
		},
		{
			"id": "rl_002",
			"label": "Single transaction limit",
			"scope": "per_txn",
			"valueMinor": 5000000, // 50,000 NGN
			"currency": "NGN",
		},
		{
			"id": "rl_003",
			"label": "Global 24h volume cap",
			"scope": "global_24h",
			"valueMinor": 1000000000, // 10M NGN
			"currency": "NGN",
		},
	}
	c.JSON(http.StatusOK, limits)
}

// UpdateRiskLimit patches one risk limit.
// PATCH /api/v1/admin/risk-limits/:id
// Body: { valueMinor: number }
func (h *AdminConsoleHandler) UpdateRiskLimit(c *gin.Context) {
	limitID := c.Param("id")

	var req struct {
		ValueMinor int64 `json:"valueMinor" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update risk_limits table; emit audit event
	updated := gin.H{
		"id": limitID,
		"label": "Daily withdrawal limit per user",
		"scope": "per_user_daily",
		"valueMinor": req.ValueMinor,
		"currency": "NGN",
	}
	c.JSON(http.StatusOK, updated)
}

// ── Fees ────────────────────────────────────────────────────────────────────

// GetFees returns the current fee configuration.
// GET /api/v1/admin/fees
func (h *AdminConsoleHandler) GetFees(c *gin.Context) {
	// TODO: Query fee_config table
	fees := []gin.H{
		{
			"id": "fee_001",
			"label": "Crypto trading fee",
			"kind": "crypto_trade",
			"bps": 50,
		},
		{
			"id": "fee_002",
			"label": "Stock trading fee",
			"kind": "stock_trade",
			"bps": 75,
		},
		{
			"id": "fee_003",
			"label": "Withdrawal fee",
			"kind": "withdrawal",
			"bps": 25,
		},
	}
	c.JSON(http.StatusOK, fees)
}

// UpdateFee patches one fee config.
// PATCH /api/v1/admin/fees/:id
// Body: { bps: number }
func (h *AdminConsoleHandler) UpdateFee(c *gin.Context) {
	feeID := c.Param("id")

	var req struct {
		Bps int `json:"bps" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update fee_config table; emit audit event
	updated := gin.H{
		"id": feeID,
		"label": "Crypto trading fee",
		"kind": "crypto_trade",
		"bps": req.Bps,
	}
	c.JSON(http.StatusOK, updated)
}

// ── Feature Flags ───────────────────────────────────────────────────────────

// GetFeatureFlags returns the list of feature flags and their enabled status.
// GET /api/v1/admin/feature-flags
func (h *AdminConsoleHandler) GetFeatureFlags(c *gin.Context) {
	// TODO: Query feature_flags table or environment config
	flags := []gin.H{
		{
			"key": "ENABLE_CRYPTO_TRADING",
			"label": "Crypto trading",
			"enabled": true,
		},
		{
			"key": "ENABLE_STOCK_TRADING",
			"label": "Stock trading",
			"enabled": false,
		},
		{
			"key": "ENABLE_AI_TRADING",
			"label": "AI-powered trading fund",
			"enabled": false,
		},
		{
			"key": "ENABLE_SAVINGS_AJO",
			"label": "Savings / Ajo circles",
			"enabled": true,
		},
	}
	c.JSON(http.StatusOK, flags)
}

// SetFeatureFlag enables or disables a feature flag.
// PATCH /api/v1/admin/feature-flags/:key
// Body: { enabled: boolean }
func (h *AdminConsoleHandler) SetFeatureFlag(c *gin.Context) {
	key := c.Param("key")

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update feature_flags table; emit audit event; possibly reload config in-process
	updated := gin.H{
		"key": key,
		"label": "Crypto trading",
		"enabled": req.Enabled,
	}
	c.JSON(http.StatusOK, updated)
}

// ── Approvals (Maker-Checker) ───────────────────────────────────────────────

// GetApprovals returns pending approvals requiring a checker.
// GET /api/v1/admin/approvals
func (h *AdminConsoleHandler) GetApprovals(c *gin.Context) {
	// TODO: Query approvals table where status = 'pending'
	approvals := []gin.H{
		{
			"id": "app_001",
			"type": "asset.update",
			"summary": "Enable ETH selling on the platform",
			"requestedBy": "admin@paymax.co",
			"status": "pending",
			"createdAt": time.Now().Add(-6*time.Hour).Format(time.RFC3339),
			"maker": "admin@paymax.co",
			"checker": nil,
		},
		{
			"id": "app_002",
			"type": "risk.update",
			"summary": "Raise daily withdrawal limit to 500k NGN",
			"requestedBy": "risk-admin@paymax.co",
			"status": "pending",
			"createdAt": time.Now().Add(-3*time.Hour).Format(time.RFC3339),
			"maker": "risk-admin@paymax.co",
			"checker": nil,
		},
	}
	c.JSON(http.StatusOK, approvals)
}

// Approve approves a pending approval.
// POST /api/v1/admin/approvals/:id/approve
// Body: {} (empty, just records who approved)
func (h *AdminConsoleHandler) Approve(c *gin.Context) {
	approvalID := c.Param("id")

	// TODO: Update approval status to 'approved'; record checker; emit audit; execute the change
	updated := gin.H{
		"id": approvalID,
		"type": "asset.update",
		"summary": "Enable ETH selling on the platform",
		"requestedBy": "admin@paymax.co",
		"status": "approved",
		"createdAt": time.Now().Add(-6*time.Hour).Format(time.RFC3339),
		"maker": "admin@paymax.co",
		"checker": "you@paymax.co",
	}
	c.JSON(http.StatusOK, updated)
}

// RejectApproval rejects a pending approval.
// POST /api/v1/admin/approvals/:id/reject
// Body: { reason: string }
func (h *AdminConsoleHandler) RejectApproval(c *gin.Context) {
	approvalID := c.Param("id")

	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Update approval status to 'rejected'; record checker + reason; emit audit
	updated := gin.H{
		"id": approvalID,
		"type": "asset.update",
		"summary": "Enable ETH selling on the platform",
		"requestedBy": "admin@paymax.co",
		"status": "rejected",
		"createdAt": time.Now().Add(-6*time.Hour).Format(time.RFC3339),
		"maker": "admin@paymax.co",
		"checker": "you@paymax.co",
	}
	c.JSON(http.StatusOK, updated)
}

// ── Audit Log ───────────────────────────────────────────────────────────────

// GetAudit returns the immutable audit log of all admin actions.
// GET /api/v1/admin/audit
func (h *AdminConsoleHandler) GetAudit(c *gin.Context) {
	logs, err := h.store.ListAuditLogs(c.Request.Context(), 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load audit logs"})
		return
	}

	entries := []gin.H{}
	for _, log := range logs {
		entries = append(entries, gin.H{
			"id": log.ID,
			"actor": log.UserID,
			"action": log.Action,
			"module": log.Module,
			"entityId": log.ResourceID,
			"oldValues": log.OldValues,
			"newValues": log.NewValues,
			"at": log.Timestamp,
			"severity": log.Severity,
		})
	}

	c.JSON(http.StatusOK, entries)
}

// ── Admin Directory ─────────────────────────────────────────────────────────

// GetAdmins returns a list of all admin users and their roles.
// GET /api/v1/admin/admins
func (h *AdminConsoleHandler) GetAdmins(c *gin.Context) {
	// TODO: Query admin users table (or users table where role != null) with RBAC role info
	admins := []gin.H{
		{
			"id": "adm_001",
			"name": "Super Admin",
			"email": "admin@paymax.co",
			"role": "SuperAdmin",
			"status": "active",
		},
		{
			"id": "adm_002",
			"name": "Compliance Officer",
			"email": "compliance@paymax.co",
			"role": "ComplianceAdmin",
			"status": "active",
		},
		{
			"id": "adm_003",
			"name": "Risk Manager",
			"email": "risk@paymax.co",
			"role": "RiskAdmin",
			"status": "active",
		},
	}
	c.JSON(http.StatusOK, admins)
}
