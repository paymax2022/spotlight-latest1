package spotlightwealth

import "fmt"

// ──────────────────────────────────────────────────────────────────────────
// Spotlight Wealth — the education-first Spotlight ⇄ Invest growth surface.
// Server counterpart of mobile features/spotlightwealth/types/spotlight.types.ts.
//
// STRICT RULES (docs/crypto/product.md → Spotlight Integration), enforced here:
//   • Leaderboards rank LEARNING points (lessons/quizzes) — never profit/gains.
//   • Challenge rewards are WALLET CREDIT — never a guaranteed investment return.
//   • Nothing recommends a security or surfaces a celebrity buy-signal.
//
// MONEY: internally every reward amount is BIGINT kobo (int64) and moves through
// the finance double-entry ledger — a completion credit is redistributed from
// the paymax_revenue standing account into the member's wallet, never minted.
// The client-facing Money struct is a { amount(major units), currency } display
// pair (matching the mobile type), converted at the handler boundary only.
// ──────────────────────────────────────────────────────────────────────────

// Money is the client-facing display pair. amount is MAJOR units (e.g. Naira),
// matching the mobile type. Server-side math always uses kobo int64.
type Money struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

// koboToMoney converts an internal kobo amount to the display Money pair.
func koboToMoney(kobo int64, currency string) Money {
	return Money{Amount: float64(kobo) / 100.0, Currency: currency}
}

// SpotlightTopic tags a video / challenge (drives chip styling client-side).
type SpotlightTopic string

// ChallengeKind — all education-first (never a trade).
type ChallengeKind string

// FinanceVideo is a creator-led financial-literacy video (education only).
type FinanceVideo struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	Creator        string         `json:"creator"`
	ThumbnailColor string         `json:"thumbnailColor"`
	DurationMins   int            `json:"durationMins"`
	Topic          SpotlightTopic `json:"topic"`
}

// Challenge is a learn-and-earn challenge. reward is credited to the member's
// WALLET on completion — never a guaranteed return, never framed as profit.
// `joined` is per-caller (derived from spotlight_challenge_members).
type Challenge struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Reward      Money         `json:"reward"`
	EndsAt      string        `json:"endsAt"`
	Joined      bool          `json:"joined"`
	Kind        ChallengeKind `json:"kind"`
}

// LeaderboardEntry — points are LEARNING points, explicitly NOT profit.
type LeaderboardEntry struct {
	Rank        int    `json:"rank"`
	DisplayName string `json:"displayName"`
	Points      int    `json:"points"`
}

// RewardWalletEntry is one credit/spend movement in the reward wallet history.
type RewardWalletEntry struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Amount Money  `json:"amount"` // positive = credit earned, negative = redeemed
	At     string `json:"at"`
}

// RewardWallet is the member's learning-reward credit balance + history.
type RewardWallet struct {
	Balance Money               `json:"balance"`
	History []RewardWalletEntry `json:"history"`
}

// Campaign is a creator/event-led education or referral programme.
type Campaign struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	IconColor   string `json:"iconColor"`
	CTA         string `json:"cta"`
}

// DefaultCurrency for reward credit (matches the mobile DEFAULT_CURRENCY).
const DefaultCurrency = "NGN"

// Sentinel errors — mapped to HTTP status in the handler.
var (
	ErrNotFound       = fmt.Errorf("spotlight: not found")
	ErrForbidden      = fmt.Errorf("spotlight: forbidden")
	ErrBadInput       = fmt.Errorf("spotlight: invalid input")
	ErrAlreadyJoined  = fmt.Errorf("spotlight: already joined")
	ErrChallengeEnded = fmt.Errorf("spotlight: challenge has ended")
)
