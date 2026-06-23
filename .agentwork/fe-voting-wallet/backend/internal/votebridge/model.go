package votebridge

// DebitForVotesRequest is the body for POST /api/finance/vote-bridge/debit.
// The Next.js bridge calls this to debit the user's wallet before crediting votes.
type DebitForVotesRequest struct {
	ContestID      string `json:"contest_id" binding:"required"`
	ContestantID   string `json:"contestant_id" binding:"required"`
	VoteCount      int    `json:"vote_count" binding:"required,min=1"`
	CostKobo       int64  `json:"cost_kobo" binding:"required,min=1"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// DebitForVotesResponse is returned on success.
type DebitForVotesResponse struct {
	OK             bool   `json:"ok"`
	BalanceKobo    int64  `json:"balance_kobo"`
	IdempotencyKey string `json:"idempotency_key"`
}
