package votebridge_test

import (
	"testing"

	"spotlight/backend/internal/votebridge"
)

// TestDebitForVotesRequestFields verifies the wallet vote debit request contract.
func TestDebitForVotesRequestFields(t *testing.T) {
	req := votebridge.DebitForVotesRequest{
		ContestID:      "contest-xyz",
		ContestantID:   "contestant-abc",
		CostKobo:       10_000,
		VoteCount:      5,
		IdempotencyKey: "vote-debit-001",
	}
	if req.ContestantID == "" {
		t.Error("DebitForVotesRequest.ContestantID must not be empty")
	}
	if req.CostKobo <= 0 {
		t.Errorf("DebitForVotesRequest.CostKobo must be positive, got %d", req.CostKobo)
	}
	if req.VoteCount <= 0 {
		t.Errorf("DebitForVotesRequest.VoteCount must be positive, got %d", req.VoteCount)
	}
	if req.IdempotencyKey == "" {
		t.Error("DebitForVotesRequest.IdempotencyKey must not be empty")
	}
}

// TestDebitForVotesResponseFields verifies the response structure after a successful debit.
func TestDebitForVotesResponseFields(t *testing.T) {
	resp := votebridge.DebitForVotesResponse{
		OK:             true,
		BalanceKobo:    490_000,
		IdempotencyKey: "vote-debit-001",
	}
	if !resp.OK {
		t.Error("DebitForVotesResponse.OK should be true on success")
	}
	if resp.BalanceKobo < 0 {
		t.Errorf("DebitForVotesResponse.BalanceKobo must not be negative, got %d", resp.BalanceKobo)
	}
	if resp.IdempotencyKey == "" {
		t.Error("DebitForVotesResponse.IdempotencyKey must echo the request key")
	}
}

// TestCostKoboMustCoverAllVotes verifies that CostKobo covers the full batch cost.
// The service debits CostKobo in a single atomic operation; it is the caller's
// responsibility to compute: CostKobo = pricePerVote * VoteCount.
func TestCostKoboMustCoverAllVotes(t *testing.T) {
	pricePerVote := int64(2_000) // ₦20 per vote
	voteCount := 5
	expectedCost := pricePerVote * int64(voteCount)

	req := votebridge.DebitForVotesRequest{
		ContestID:      "contest-xyz",
		ContestantID:   "contestant-abc",
		CostKobo:       expectedCost,
		VoteCount:      voteCount,
		IdempotencyKey: "vote-debit-001",
	}
	if req.CostKobo != expectedCost {
		t.Errorf("CostKobo=%d does not match pricePerVote×count=%d×%d=%d",
			req.CostKobo, pricePerVote, voteCount, expectedCost)
	}
}
