// Package placement implements Featured Placement — a paid landing-page promotion
// module. It is a booking system over scarce ad inventory with ledger escrow, a
// guarded state machine, and a serving resolver.
//
// Iron rules honored:
//   - All money is int64 kobo (minor units). Never float for money math; pricing
//     and pro-rata splits use integer arithmetic only.
//   - Money MOVEMENT reuses the finance ledger standing accounts
//     (PLACEMENT_ESCROW / PLACEMENT_REVENUE). This package never writes SQL against
//     ledger tables; it calls the ledger.Service primitives.
//   - Every money mutation is idempotent on campaign_id + operation; transitions are
//     guarded (no raw status writes) and every transition + money movement writes an
//     immutable row into placement_audit_log.
package placement

import (
	"errors"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────────

// State is the guarded campaign lifecycle state. Transitions are enforced by
// canTransition; any edge not listed is rejected (fail-closed).
type State string

const (
	StateDraft          State = "DRAFT"
	StateSubmitted      State = "SUBMITTED"
	StateUnderReview    State = "UNDER_REVIEW"
	StateNeedsMoreInfo  State = "NEEDS_MORE_INFO"
	StateRejected       State = "REJECTED"
	StatePendingPayment State = "PENDING_PAYMENT"
	StateScheduled      State = "SCHEDULED"
	StateActive         State = "ACTIVE"
	StatePaused         State = "PAUSED"
	StateSuspended      State = "SUSPENDED"
	StateCancelled      State = "CANCELLED"
	StateCancelledEarly State = "CANCELLED_EARLY"
	StateCompleted      State = "COMPLETED"
)

// transitions encodes the legal forward edges. Any edge not present is rejected.
//
// DRAFT→SUBMITTED→UNDER_REVIEW;
// UNDER_REVIEW→{NEEDS_MORE_INFO,REJECTED,SCHEDULED(approve+paid),PENDING_PAYMENT(approve+payment_failed)};
// NEEDS_MORE_INFO→UNDER_REVIEW(resubmit);
// PENDING_PAYMENT→SCHEDULED(retry pay ok);
// SCHEDULED→{ACTIVE(scheduler@start),CANCELLED(before start, full refund)};
// ACTIVE→{PAUSED⇄(resume→ACTIVE),SUSPENDED(admin),CANCELLED_EARLY(pro-rata),COMPLETED(scheduler@end)}.
// Terminal: COMPLETED,REJECTED,CANCELLED,CANCELLED_EARLY,SUSPENDED.
var transitions = map[State]map[State]bool{
	StateDraft:          {StateSubmitted: true},
	StateSubmitted:      {StateUnderReview: true},
	StateUnderReview:    {StateNeedsMoreInfo: true, StateRejected: true, StateScheduled: true, StatePendingPayment: true},
	StateNeedsMoreInfo:  {StateUnderReview: true},
	StatePendingPayment: {StateScheduled: true, StateCancelled: true},
	StateScheduled:      {StateActive: true, StateCancelled: true},
	StateActive: {
		StatePaused:         true,
		StateSuspended:      true,
		StateCancelledEarly: true,
		StateCompleted:      true,
	},
	StatePaused: {StateActive: true, StateSuspended: true, StateCancelledEarly: true},
	// Terminal states have no outbound edges.
	StateRejected:       {},
	StateCancelled:      {},
	StateCancelledEarly: {},
	StateSuspended:      {},
	StateCompleted:      {},
}

// canTransition returns true if from→to is a legal edge (fail-closed default).
func canTransition(from, to State) bool {
	edges, ok := transitions[from]
	if !ok {
		return false
	}
	return edges[to]
}

// IsTerminal reports whether a state has no outbound transitions.
func (s State) IsTerminal() bool {
	switch s {
	case StateCompleted, StateRejected, StateCancelled, StateCancelledEarly, StateSuspended:
		return true
	default:
		return false
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

// LayoutType matches placement_zone.layout_type.
type LayoutType string

const (
	LayoutExclusive LayoutType = "EXCLUSIVE"
	LayoutPooled    LayoutType = "POOLED"
)

// Zone is a versioned inventory config row (placement_zone). Not code — config.
type Zone struct {
	ID                string         `json:"id"`
	Code              string         `json:"code"`
	Label             string         `json:"label"`
	LayoutType        LayoutType     `json:"layout_type"`
	Capacity          int            `json:"capacity"`
	BaseDailyRateKobo int64          `json:"base_daily_rate_kobo"`
	TierMultiplier    float64        `json:"tier_multiplier"`
	Position          int            `json:"position"`
	IsActive          bool           `json:"is_active"`
	CreativeSpec      map[string]any `json:"creative_spec"`
	RateVersion       int            `json:"rate_version"`
}

// Interval is one paused window recorded on paused_intervals. Used to extend the
// campaign window_end by the cumulative paused duration on resume.
type Interval struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// Campaign is the booking REQUEST + review state (featured_campaign). Money columns
// are kobo; state is the guarded lifecycle; version is the optimistic lock.
type Campaign struct {
	ID              string         `json:"id"`
	MerchantID      string         `json:"merchant_id"`
	SubjectType     string         `json:"subject_type"`
	SubjectID       string         `json:"subject_id"`
	ZoneCode        string         `json:"zone_code"`
	WindowStart     time.Time      `json:"window_start"`
	WindowEnd       time.Time      `json:"window_end"`
	DurationDays    int            `json:"duration_days"`
	Creative        map[string]any `json:"creative"`
	QuotedPriceKobo int64          `json:"quoted_price_kobo"`
	RateVersion     int            `json:"rate_version"`
	State           State          `json:"state"`
	ReviewReviewer  *string        `json:"review_reviewer_id,omitempty"`
	ReviewDecision  *string        `json:"review_decision,omitempty"`
	ReviewReason    *string        `json:"review_reason,omitempty"`
	ReviewedAt      *time.Time     `json:"reviewed_at,omitempty"`
	PaymentRef      *string        `json:"payment_ref,omitempty"`
	PausedIntervals []Interval     `json:"paused_intervals"`
	ActivatedAt     *time.Time     `json:"activated_at,omitempty"`
	CompletedAt     *time.Time     `json:"completed_at,omitempty"`
	Version         int            `json:"version"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// ServedItem is one resolved placement returned by the landing resolver. Each gets
// a fresh placement_token (uuid) for analytics correlation and a "Featured" label.
type ServedItem struct {
	CampaignID     string         `json:"campaign_id"`
	ZoneCode       string         `json:"zone_code"`
	SubjectType    string         `json:"subject_type"`
	SubjectID      string         `json:"subject_id"`
	Creative       map[string]any `json:"creative"`
	PlacementToken string         `json:"placement_token"`
	Label          string         `json:"label"`
	House          bool           `json:"house,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing (integer kobo only)
// ─────────────────────────────────────────────────────────────────────────────

// durationDiscountBps returns the duration discount in basis points (1bps = 0.01%).
// Mapping: nearest packaged duration ≤ the requested duration_days.
//
//	1d→0%, 3d→5%, 7d→10%, 14d→15%, 30d→20%
func durationDiscountBps(durationDays int) int64 {
	switch {
	case durationDays >= 30:
		return 2000
	case durationDays >= 14:
		return 1500
	case durationDays >= 7:
		return 1000
	case durationDays >= 3:
		return 500
	default:
		return 0
	}
}

// quotePriceKobo computes the quoted price in kobo using INTEGER math only.
//
//	price = round( base_daily_rate_kobo * duration_days * tier_multiplier
//	               * (1 - duration_discount) )
//
// tier_multiplier is the zone's NUMERIC(6,3) config factor; it is applied as
// thousandths (×1000, integer-rounded) so no float enters the money result. The
// discount is applied via basis points. Half-up rounding throughout.
func quotePriceKobo(baseDailyRateKobo int64, durationDays int, tierMultiplier float64) int64 {
	if baseDailyRateKobo <= 0 || durationDays <= 0 {
		return 0
	}
	// gross = base * days (exact integer).
	gross := baseDailyRateKobo * int64(durationDays)

	// Apply the tier multiplier as thousandths (NUMERIC(6,3)): mult/1000, half-up.
	milli := int64(tierMultiplier*1000.0 + 0.5)
	if milli <= 0 {
		milli = 1000 // never zero-out a paid placement on a bad config factor
	}
	gross = halfUpDiv(gross*milli, 1000)

	// Apply the duration discount in basis points: keep (10000 - discountBps)/10000.
	keepBps := 10000 - durationDiscountBps(durationDays)
	return halfUpDiv(gross*keepBps, 10000)
}

// halfUpDiv divides n by d with half-up rounding, integer-only. d must be > 0.
func halfUpDiv(n, d int64) int64 {
	if d <= 0 {
		return 0
	}
	return (n + d/2) / d
}

// ─────────────────────────────────────────────────────────────────────────────
// Pro-rata earned / refund split (integer kobo only)
// ─────────────────────────────────────────────────────────────────────────────

// proRataSplit computes the earned vs unused split for an early stop. elapsedDays is
// the number of whole days the campaign actually ran; it is clamped to [0,duration].
//
//	earnedKobo  = quoted * elapsed / duration   (integer division, truncating)
//	refundKobo  = quoted - earnedKobo            (remainder; the merchant is never
//	                                              over-charged by rounding)
func proRataSplit(quotedKobo int64, elapsedDays, durationDays int) (earnedKobo, refundKobo int64) {
	if durationDays <= 0 || quotedKobo <= 0 {
		return 0, maxInt64(quotedKobo, 0)
	}
	if elapsedDays < 0 {
		elapsedDays = 0
	}
	if elapsedDays > durationDays {
		elapsedDays = durationDays
	}
	earnedKobo = quotedKobo * int64(elapsedDays) / int64(durationDays)
	refundKobo = quotedKobo - earnedKobo
	return earnedKobo, refundKobo
}

// elapsedDaysUTC returns the whole days elapsed between start and now in UTC,
// clamped to [0, durationDays]. Used by CANCELLED_EARLY / SUSPENDED accounting.
func elapsedDaysUTC(start, now time.Time, durationDays int) int {
	if now.Before(start) {
		return 0
	}
	d := int(now.UTC().Sub(start.UTC()).Hours() / 24)
	if d < 0 {
		d = 0
	}
	if d > durationDays {
		d = durationDays
	}
	return d
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel errors (mapped to HTTP codes by the handler)
// ─────────────────────────────────────────────────────────────────────────────

var (
	ErrNotFound     = errors.New("placement: not found")
	ErrForbidden    = errors.New("placement: caller does not own this campaign")
	ErrBadState     = errors.New("placement: illegal state transition")
	ErrSlotTaken    = errors.New("placement: exclusive slot already taken for this window")
	ErrInsufficient = errors.New("placement: insufficient funds")
	ErrIneligible   = errors.New("placement: campaign failed an eligibility check")
	ErrInvalidInput = errors.New("placement: invalid input")
	ErrZoneNotFound = errors.New("placement: zone not found")
	ErrConflict     = errors.New("placement: optimistic lock conflict")
)
