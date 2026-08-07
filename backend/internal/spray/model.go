// Package spray is the shared "spray money" engine: an instant wallet→wallet
// transfer with a returnable animation descriptor and a per-context leaderboard.
// It is reused by social (lives feed) and creators (live/event spray). All money
// REUSES the finance ledger (NL-8) via wallet.Debit/ledger.Credit, is idempotent
// (NL-9), tier-limited fail-closed, and runs under AML velocity limits (NL-10).
// Paymax never advances principal (NL-1) and never pays yield (NL-2): a spray is a
// pure peer-to-peer move, never a loan.
package spray

import "time"

// Animation is the returnable descriptor a client renders for a spray. It carries
// NO money authority — it is a pure presentation contract derived from the amount
// so the same engine drives social lives + creator lives consistently.
type Animation struct {
	Style      string `json:"style"`       // notes | confetti | rain | fireworks
	Intensity  int    `json:"intensity"`   // 1..5 scaled by amount tier
	DurationMs int    `json:"duration_ms"` // animation length
	Emoji      string `json:"emoji"`       // headline glyph
	Label      string `json:"label"`       // human label ("Big Baller")
}

// Spray is one completed spray transfer. The money already moved through the
// ledger when this row is written; the row is the idempotent audit projection.
type Spray struct {
	ID             string    `json:"id"`
	FromUserID     string    `json:"from_user_id"` // FK auth.users(id)
	ToUserID       string    `json:"to_user_id"`   // FK auth.users(id)
	ContextRef     string    `json:"context_ref"`  // live id / event id / creator id
	AmountKobo     int64     `json:"amount_kobo"`
	IdempotencyKey string    `json:"idempotency_key"`
	Animation      Animation `json:"animation"`
	CreatedAt      time.Time `json:"created_at"`
}

// LeaderboardRow is one ranked sprayer within a context.
type LeaderboardRow struct {
	Rank       int    `json:"rank"`
	UserID     string `json:"user_id"`
	TotalKobo  int64  `json:"total_kobo"`
	SprayCount int64  `json:"spray_count"`
}

// describeAnimation maps an amount to a presentation tier. Pure + deterministic so
// it can be unit-tested and rendered identically on every surface.
func describeAnimation(amountKobo int64) Animation {
	switch {
	case amountKobo >= 5_000_00:
		return Animation{Style: "fireworks", Intensity: 5, DurationMs: 4000, Emoji: "\U0001F386", Label: "Big Baller"}
	case amountKobo >= 1_000_00:
		return Animation{Style: "rain", Intensity: 4, DurationMs: 3000, Emoji: "\U0001F4B8", Label: "Money Rain"}
	case amountKobo >= 200_00:
		return Animation{Style: "confetti", Intensity: 3, DurationMs: 2200, Emoji: "\U0001F389", Label: "Generous"}
	case amountKobo >= 50_00:
		return Animation{Style: "notes", Intensity: 2, DurationMs: 1600, Emoji: "\U0001F4B5", Label: "Spray"}
	default:
		return Animation{Style: "notes", Intensity: 1, DurationMs: 1200, Emoji: "\U0001F4B5", Label: "Tip"}
	}
}
