// Package admin is the self-contained back-office surface for Paymax Invest. It
// is a thin, in-memory orchestration layer on top of the existing crypto store
// (store.Repository) and the stocks service (stocks.Service): it reads what they
// already hold (assets, transactions, positions, orders) and adds the admin-only
// concerns those modules deliberately leave out — RBAC, an asset/fee/risk/flag
// control plane, a KYC + withdrawal review queue, a maker-checker approval flow,
// and an append-only audit log.
//
// IRON RULES (mirrors the rest of the backend):
//   - Money is integer MINOR UNITS (kobo/cents). Never floats on the wire.
//   - Every JSON shape is camelCase so payloads round-trip to the React client.
//   - Every mutation is RBAC-gated and writes an AuditEntry.
//   - Sensitive mutations don't apply directly: they open a PENDING Approval that
//     a *different* admin must approve (four-eyes / maker-checker).
//
// The package is stdlib-only beyond the internal modules it composes; it owns no
// external state and is a drop-in for an HTTP layer to wrap with handlers.
package admin

// ── Roles ────────────────────────────────────────────────────────────────────

// Role is an admin persona. Each role carries a fixed permission set (see
// rbac.go). SuperAdmin holds every permission.
type Role string

const (
	RoleSuperAdmin      Role = "SuperAdmin"
	RoleComplianceAdmin Role = "ComplianceAdmin"
	RoleTradingOpsAdmin Role = "TradingOpsAdmin"
	RoleProductAdmin    Role = "ProductAdmin"
	RoleFinanceAdmin    Role = "FinanceAdmin"
	RoleSupportAdmin    Role = "SupportAdmin"
	RoleRiskAdmin       Role = "RiskAdmin"
	RoleContentAdmin    Role = "ContentAdmin"
)

// AdminUser is a back-office operator.
type AdminUser struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Role   Role   `json:"role"`
	Status string `json:"status"` // "active" | "suspended"
}

// ── Money ────────────────────────────────────────────────────────────────────

// Money is an integer minor-unit fiat amount + ISO-4217 currency. It mirrors
// domain.Money so admin payloads stay consistent with the rest of the backend.
type Money struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// ── Dashboard / KPIs ─────────────────────────────────────────────────────────

// DashboardCounts is the operational at-a-glance tally.
type DashboardCounts struct {
	Users              int `json:"users"`
	OpenKyc            int `json:"openKyc"`
	PendingWithdrawals int `json:"pendingWithdrawals"`
	FailedOrders       int `json:"failedOrders"`
	ReconExceptions    int `json:"reconExceptions"`
	PendingApprovals   int `json:"pendingApprovals"`
	ActiveAssets       int `json:"activeAssets"`
	PausedAssets       int `json:"pausedAssets"`
}

// RevenueSummary is a coarse fee/revenue rollup (illustrative, derived from
// recorded transaction fees + a flat estimate per stock order).
type RevenueSummary struct {
	Today       Money `json:"today"`
	MonthToDate Money `json:"monthToDate"`
	Fees30d     Money `json:"fees30d"`
	OrderCount  int   `json:"orderCount"`
}

// ProviderHealthSummary rolls up the provider statuses for the dashboard tile.
type ProviderHealthSummary struct {
	Up       int `json:"up"`
	Degraded int `json:"degraded"`
	Down     int `json:"down"`
}

// Dashboard is the home screen of the admin console.
type Dashboard struct {
	GeneratedAt string                `json:"generatedAt"`
	Counts      DashboardCounts       `json:"counts"`
	Revenue     RevenueSummary        `json:"revenue"`
	Providers   ProviderHealthSummary `json:"providers"`
	Reconciled  bool                  `json:"reconciled"`
}

// ── Users ────────────────────────────────────────────────────────────────────

// UserSummary is a customer row in the admin user list.
type UserSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	KycTier   int    `json:"kycTier"`
	Status    string `json:"status"`
	Portfolio Money  `json:"portfolio"`
}

// UserDetail is the expanded customer view (derived from portfolio/positions).
type UserDetail struct {
	UserSummary
	BaseCurrency  string `json:"baseCurrency"`
	CashBalance   Money  `json:"cashBalance"`
	TotalGainLoss Money  `json:"totalGainLoss"`
	Positions     int    `json:"positions"`
	OpenOrders    int    `json:"openOrders"`
	Flags         []string `json:"flags"`
}

// ── KYC ──────────────────────────────────────────────────────────────────────

// KycDoc is one uploaded verification document.
type KycDoc struct {
	Type   string `json:"type"`   // "id" | "selfie" | "proof_of_address" …
	Status string `json:"status"` // "received" | "verified" | "rejected"
}

// KycCase is a verification case awaiting compliance review.
type KycCase struct {
	ID          string   `json:"id"`
	UserID      string   `json:"userId"`
	Name        string   `json:"name"`
	Status      string   `json:"status"` // "PENDING" | "APPROVED" | "REJECTED"
	Tier        int      `json:"tier"`
	SubmittedAt string   `json:"submittedAt"`
	Docs        []KycDoc `json:"docs"`
	RiskFlags   []string `json:"riskFlags"`
}

// ── Asset control plane ──────────────────────────────────────────────────────

// AssetControl is the admin-editable trading configuration for one asset,
// unified across crypto and stocks.
type AssetControl struct {
	ID                string `json:"id"`
	Symbol            string `json:"symbol"`
	Kind              string `json:"kind"` // "crypto" | "stock"
	BuyEnabled        bool   `json:"buyEnabled"`
	SellEnabled       bool   `json:"sellEnabled"`
	WithdrawalEnabled bool   `json:"withdrawalEnabled"`
	Status            string `json:"status"` // "active" | "paused" | "delisted"
	FeeBps            int64  `json:"feeBps"`
	MinOrder          int64  `json:"minOrder"`
	MaxOrder          int64  `json:"maxOrder"`
}

// AssetControlPatch is a partial update of an AssetControl; nil fields are left
// unchanged. The HTTP layer decodes a JSON body straight into this.
type AssetControlPatch struct {
	BuyEnabled        *bool  `json:"buyEnabled,omitempty"`
	SellEnabled       *bool  `json:"sellEnabled,omitempty"`
	WithdrawalEnabled *bool  `json:"withdrawalEnabled,omitempty"`
	Status            *string `json:"status,omitempty"`
	FeeBps            *int64 `json:"feeBps,omitempty"`
	MinOrder          *int64 `json:"minOrder,omitempty"`
	MaxOrder          *int64 `json:"maxOrder,omitempty"`
}

// ── Orders ───────────────────────────────────────────────────────────────────

// AdminOrder is a unified order/transaction row across crypto and stocks.
type AdminOrder struct {
	Ref         string `json:"ref"`
	User        string `json:"user"`
	Kind        string `json:"kind"` // "crypto" | "stock"
	Side        string `json:"side"`
	Symbol      string `json:"symbol"`
	Status      string `json:"status"`
	Amount      Money  `json:"amount"`
	CreatedAt   string `json:"createdAt"`
	ProviderRef string `json:"providerRef"`
}

// ── Withdrawal review ────────────────────────────────────────────────────────

// WithdrawalReviewItem is a crypto withdrawal in the manual-review queue.
type WithdrawalReviewItem struct {
	Reference string `json:"reference"`
	User      string `json:"user"`
	Symbol    string `json:"symbol"`
	Amount    Money  `json:"amount"`
	Address   string `json:"address"`
	Network   string `json:"network"`
	RiskScore int    `json:"riskScore"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

// ── Provider health ──────────────────────────────────────────────────────────

// ProviderHealth is one upstream provider's liveness snapshot.
type ProviderHealth struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`   // "liquidity" | "custody" | "broker" | "kyc" …
	Status    string `json:"status"` // "up" | "degraded" | "down"
	LatencyMs int    `json:"latencyMs"`
	LastCheck string `json:"lastCheck"`
}

// ── Risk / fees / flags ──────────────────────────────────────────────────────

// RiskLimit is a configurable risk threshold.
type RiskLimit struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Scope      string `json:"scope"` // "per_user_daily" | "per_order" | "global_daily" …
	ValueMinor int64  `json:"valueMinor"`
	Currency   string `json:"currency"`
}

// FeeConfigItem is a configurable platform fee (basis points).
type FeeConfigItem struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"` // "crypto" | "stock" | "swap" | "withdrawal"
	Bps   int64  `json:"bps"`
}

// FeatureFlag is a server-driven product toggle.
type FeatureFlag struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
}

// ── Audit ────────────────────────────────────────────────────────────────────

// AuditEntry is one append-only record of an admin action. Written on every
// mutation (including approvals).
type AuditEntry struct {
	ID         string `json:"id"`
	Actor      string `json:"actor"` // the acting Role
	Action     string `json:"action"`
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityId"`
	Reason     string `json:"reason"`
	OldValue   string `json:"oldValue,omitempty"`
	NewValue   string `json:"newValue,omitempty"`
	At         string `json:"at"`
	IP         string `json:"ip,omitempty"`
}

// ── Maker-checker approvals ──────────────────────────────────────────────────

// Approval is a sensitive change held for four-eyes sign-off. Maker opens it;
// a different Checker applies or rejects it.
type Approval struct {
	Type        string         `json:"type"` // "asset_control" | "fee" | "risk_limit" | "withdrawal" | "kyc"
	ID          string         `json:"id"`
	Summary     string         `json:"summary"`
	RequestedBy Role           `json:"requestedBy"`
	Status      string         `json:"status"` // "PENDING" | "APPROVED" | "REJECTED"
	CreatedAt   string         `json:"createdAt"`
	Maker       Role           `json:"maker"`
	Checker     *Role          `json:"checker,omitempty"`
	Reason      string         `json:"reason"`
	Payload     map[string]any `json:"payload"`
}

// ── Errors ───────────────────────────────────────────────────────────────────

// AdminError is a typed admin failure mapping to the client `{type,message}`
// envelope. Type is one of: "forbidden", "not_found", "conflict", "invalid".
type AdminError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func (e *AdminError) Error() string { return e.Message }
