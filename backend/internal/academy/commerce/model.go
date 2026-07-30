package commerce

import (
	"encoding/json"
	"time"
)

// Money is always integer MINOR UNITS + a currency code (conventions.md). Never floats.

// ── Catalog ───────────────────────────────────────────────────────────────────

// Plan mirrors academy_plans.
type Plan struct {
	ID         string          `json:"id"`
	Code       string          `json:"code"`
	Name       string          `json:"name"`
	PriceMinor int64           `json:"priceMinor"`
	Period     string          `json:"period"`
	Features   json.RawMessage `json:"features"`
	Status     string          `json:"status"`
}

// ExamBundle mirrors academy_exam_bundles.
type ExamBundle struct {
	ID         string          `json:"id"`
	ArenaID    *string         `json:"arenaId,omitempty"`
	Name       string          `json:"name"`
	PriceMinor int64           `json:"priceMinor"`
	Contents   json.RawMessage `json:"contents"`
	Season     *string         `json:"season,omitempty"`
	Status     string          `json:"status"`
}

// ── Orders / entitlements ──────────────────────────────────────────────────────

// Order mirrors academy_orders.
type Order struct {
	ID             string    `json:"id"`
	UserID         string    `json:"userId"`
	Kind           string    `json:"kind"`  // plan | bundle
	RefID          string    `json:"refId"` // plan/bundle id
	AmountMinor    int64     `json:"amountMinor"`
	Currency       string    `json:"currency"`
	State          string    `json:"state"`
	PaymentRef     *string   `json:"paymentRef,omitempty"`
	BNPLRef        *string   `json:"bnplRef,omitempty"`
	IdempotencyKey *string   `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

// Entitlement mirrors academy_entitlements.
type Entitlement struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Kind      string    `json:"kind"` // plan | bundle | arena
	RefID     *string   `json:"refId,omitempty"`
	State     string    `json:"state"`  // active | revoked
	Source    string    `json:"source"` // order | bnpl | access_card | reward | scholarship
	GrantedAt time.Time `json:"grantedAt"`
}

// Subscription mirrors academy_subscriptions.
type Subscription struct {
	ID        string     `json:"id"`
	UserID    string     `json:"userId"`
	PlanID    string     `json:"planId"`
	State     string     `json:"state"`
	StartedAt time.Time  `json:"startedAt"`
	RenewsAt  *time.Time `json:"renewsAt,omitempty"`
}

// AccessCard mirrors academy_access_cards (pin_hash never serialised).
type AccessCard struct {
	ID          string     `json:"id"`
	Batch       string     `json:"batch"`
	Serial      string     `json:"serial"`
	GrantKind   string     `json:"grantKind"` // plan | bundle
	GrantRefID  string     `json:"grantRefId"`
	State       string     `json:"state"`
	AgentID     *string    `json:"agentId,omitempty"`
	ActivatedBy *string    `json:"activatedBy,omitempty"`
	ActivatedAt *time.Time `json:"activatedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// ── Admin oversight aggregates (read-only) ─────────────────────────────────────

// OrderStateSummary is one state bucket in the payments overview: count + summed
// amount (minor units) of orders in that state.
type OrderStateSummary struct {
	State       string `json:"state"`
	Count       int64  `json:"count"`
	AmountMinor int64  `json:"amountMinor"`
}

// OrdersOverview aggregates academy_orders by state for the admin payments console.
type OrdersOverview struct {
	TotalOrders      int64               `json:"totalOrders"`
	TotalAmountMinor int64               `json:"totalAmountMinor"`
	ByState          []OrderStateSummary `json:"byState"`
}

// ── Offline bundle manifest (academy_content_bundles, read-only) ───────────────

// BundleManifest is the download descriptor for an offline content bundle.
type BundleManifest struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	VersionID       *string         `json:"versionId,omitempty"`
	ArenaCode       *string         `json:"arenaCode,omitempty"`
	SizeBudgetBytes int64           `json:"sizeBudgetBytes"`
	LessonIDs       []string        `json:"lessonIds"`
	Status          string          `json:"status"`
	Manifest        json.RawMessage `json:"manifest"`
}

// ── Offline sync envelope (nfr.md §Offline) ────────────────────────────────────

// SyncRequest is the deterministic, idempotent sync envelope. Each event carries a
// stable clientEventId; server is authoritative for scoring/timing/money. LWW only
// for non-critical state.
type SyncRequest struct {
	Events []SyncEvent `json:"events"`
}

// SyncEvent is one queued client event.
type SyncEvent struct {
	ClientEventID string          `json:"clientEventId" binding:"required"`
	Kind          string          `json:"kind" binding:"required"` // progress | attempt_queued | reward_eligible
	Payload       json.RawMessage `json:"payload"`
	ClientTS      *time.Time      `json:"clientTs,omitempty"`
}

// SyncResult is the server reconciliation result.
type SyncResult struct {
	Reconciled []SyncResolution `json:"reconciled"`
}

// SyncResolution reports the server-authoritative outcome for one client event.
type SyncResolution struct {
	ClientEventID string    `json:"clientEventId"`
	Kind          string    `json:"kind"`
	Resolution    string    `json:"resolution"` // accepted | superseded | rejected (replay = accepted, no new effect)
	ServerTS      time.Time `json:"serverTs"`
	Note          string    `json:"note,omitempty"`
}

// ── Request DTOs ───────────────────────────────────────────────────────────────

// CreateOrderRequest starts an order in checkout (price locked from catalog).
type CreateOrderRequest struct {
	Kind  string `json:"kind" binding:"required"` // plan | bundle
	RefID string `json:"refId" binding:"required"`
}

// GenerateCardsRequest is the admin batch-generation request.
type GenerateCardsRequest struct {
	Batch      string `json:"batch" binding:"required"`
	GrantKind  string `json:"grantKind" binding:"required"` // plan | bundle
	GrantRefID string `json:"grantRefId" binding:"required"`
	Count      int    `json:"count" binding:"required"`
	PinDigits  int    `json:"pinDigits"` // default 6
}

// GeneratedCard returns a card serial + its one-time plaintext PIN (shown ONCE at
// generation so the agent can print/distribute; never stored in plaintext).
type GeneratedCard struct {
	ID     string `json:"id"`
	Serial string `json:"serial"`
	PIN    string `json:"pin"`
}

// AllocateCardsRequest assigns a batch (or specific serials) to an agent.
type AllocateCardsRequest struct {
	AgentID string   `json:"agentId" binding:"required"`
	Batch   string   `json:"batch"`
	Serials []string `json:"serials"`
}

// ActivateCardRequest is the member redemption.
type ActivateCardRequest struct {
	Serial string `json:"serial" binding:"required"`
	PIN    string `json:"pin" binding:"required"`
}

// SubscribeRequest creates a subscription via the pay-now path.
type SubscribeRequest struct {
	PlanID string `json:"planId" binding:"required"`
}

// ── helpers ────────────────────────────────────────────────────────────────────

func rawOrEmptyObject(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(b)
}
