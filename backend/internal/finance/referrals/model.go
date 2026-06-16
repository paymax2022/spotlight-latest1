package referrals

import "time"

const (
	RewardAmountKobo = 50_000 // ₦500 per referral
)

// Code is a user's referral code.
type Code struct {
	UserID    string    `json:"user_id"`
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"created_at"`
}

// Event records when a referral reward was earned.
type Event struct {
	ID          string    `json:"id"`
	ReferrerID  string    `json:"referrer_id"`
	ReferredID  string    `json:"referred_id"`
	AmountKobo  int64     `json:"amount_kobo"`
	CreatedAt   time.Time `json:"created_at"`
}

// Summary is the response for GET /finance/referrals/me.
type Summary struct {
	Code             string `json:"code"`
	TotalReferrals   int    `json:"total_referrals"`
	TotalEarnedKobo  int64  `json:"total_earned_kobo"`
}
