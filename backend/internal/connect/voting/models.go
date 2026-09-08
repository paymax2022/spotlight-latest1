// Package connectvoting implements Paymax Connect contests: free polls and PAID
// voting. A free vote is a one-per-user poll choice with velocity guards; a paid
// vote debits the voter's Paymax wallet via the finance ledger (balanced
// double-entry, idempotent, tier-checked, audited) and credits Paymax revenue.
//
// Iron rules honoured (root CLAUDE.md "Money handling"):
//   - paid-vote amounts are integer kobo (BIGINT), resolved server-side from the
//     contest — never from the client;
//   - every paid vote requires an Idempotency-Key and posts a balanced ledger
//     entry; a retry is a safe no-op (ledger unique constraint);
//   - tier limits are enforced server-side, fail-closed, before any debit;
//   - integrity guards (one free vote per contest, per-window velocity cap) run
//     server-side; the client cannot override them.
package connectvoting

import "time"

// Contest mirrors a row of public.connect_contests. Status is one of
// draft|open|closed. PaidVoteKobo is the price of ONE paid vote unit in kobo
// (0 = paid voting disabled for the contest).
type Contest struct {
	ID                string     `json:"id"`
	Title             string     `json:"title"`
	Description       *string    `json:"description,omitempty"`
	Status            string     `json:"status"`
	PaidVoteKobo      int64      `json:"paid_vote_kobo"`
	FreeVotesPerUser  int        `json:"free_votes_per_user"`
	VelocityPerMinute int        `json:"velocity_per_minute"`
	OpensAt           *time.Time `json:"opens_at,omitempty"`
	ClosesAt          *time.Time `json:"closes_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	RulesText         string     `json:"rules_text,omitempty"`
	BannerImageURL    string     `json:"banner_image_url,omitempty"`

	// Roster/tally summary, populated by the list + detail queries so a client
	// rendering a contest card does not have to fetch the whole roster to show
	// "N contestants / M votes" (which would be an N+1 across the list).
	ContestantCount int   `json:"contestant_count"`
	TotalVotes      int64 `json:"total_votes"`
}

// Vote mirrors a row of public.connect_votes (immutable). A free vote has
// paid=false and amount_kobo=0; a paid vote carries the ledger ref.
type Vote struct {
	ID             string    `json:"id"`
	ContestID      string    `json:"contest_id"`
	VoterID        string    `json:"voter_id"`
	OptionRef      string    `json:"option_ref"`
	Paid           bool      `json:"paid"`
	Quantity       int       `json:"quantity"`
	AmountKobo     int64     `json:"amount_kobo"`
	IdempotencyKey *string   `json:"-"`
	LedgerRef      *string   `json:"ledger_ref,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// ResultRow is one tallied option in a contest's results.
type ResultRow struct {
	OptionRef  string `json:"option_ref"`
	FreeVotes  int64  `json:"free_votes"`
	PaidVotes  int64  `json:"paid_votes"`
	TotalVotes int64  `json:"total_votes"`
}

// --- Request DTOs ---

// FreeVoteRequest is the body for POST /contests/:id/vote.
type FreeVoteRequest struct {
	OptionRef string `json:"optionRef" binding:"required"`
}

// PaidVoteRequest is the body for POST /contests/:id/paid-vote. Quantity is the
// number of paid vote units; the price-per-unit comes from the contest, never
// the client.
type PaidVoteRequest struct {
	OptionRef string `json:"optionRef" binding:"required"`
	Quantity  int    `json:"quantity"`
}
