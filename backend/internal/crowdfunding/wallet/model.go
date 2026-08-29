// Package wallet exposes a campaign's derived wallet, its ledger projection, the
// creator's saved bank accounts, and the withdrawal flow.
//
// IRON RULES enforced here:
//   - All monetary amounts are int64 kobo (minor units). Never floats.
//   - The wallet balance is NEVER stored: it is derived from the contributions
//     ledger and cf_withdrawals on every read.
//   - SubmitWithdrawal requires an Idempotency-Key and executes the payout
//     immediately (DEBIT AccountEscrow / CREDIT AccountProviderClearing,
//     balanced double-entry, deterministic idempotency key, audited) — there is
//     no separate admin-approval step. Campaign review (approve/reject/freeze)
//     is the one remaining gate: it decides whether a campaign can accept
//     contributions at all; once it can, funds are the creator's on arrival.
package wallet

// ─── Response DTOs (field names match the mobile TypeScript contract exactly) ──

// CampaignWalletSummary mirrors the client CampaignWalletSummary type.
// All balances are derived, never stored.
type CampaignWalletSummary struct {
	CampaignID         string `json:"campaignId"`
	CampaignTitle      string `json:"campaignTitle"`
	AvailableKobo      int64  `json:"availableKobo"`
	PendingKobo        int64  `json:"pendingKobo"`
	EscrowKobo         int64  `json:"escrowKobo"`
	TotalRaisedKobo    int64  `json:"totalRaisedKobo"`
	TotalWithdrawnKobo int64  `json:"totalWithdrawnKobo"`
	Frozen             bool   `json:"frozen"`
}

// LedgerEntry mirrors the client LedgerEntry type. amountKobo is signed
// (+credit / -debit) and balanceKobo is the running balance after this entry.
type LedgerEntry struct {
	ID          string `json:"id"`
	Type        string `json:"type"` // LedgerEntryType (see ledgerEntryType constants)
	Description string `json:"description"`
	AmountKobo  int64  `json:"amountKobo"`
	BalanceKobo int64  `json:"balanceKobo"`
	Reference   string `json:"reference"`
	Status      string `json:"status"` // POSTED | PENDING | REVERSED
	CreatedAt   string `json:"createdAt"`
}

// BankAccount mirrors the client BankAccount type.
type BankAccount struct {
	ID                  string `json:"id"`
	BankName            string `json:"bankName"`
	AccountNumberMasked string `json:"accountNumberMasked"`
	AccountName         string `json:"accountName"`
	IsDefault           bool   `json:"isDefault"`
}

// ─── Request DTOs ────────────────────────────────────────────────────────────

// WithdrawalRequestInput mirrors the client WithdrawalRequestInput type.
// campaignId comes from the route path; the body carries the rest.
type WithdrawalRequestInput struct {
	AmountKobo    int64   `json:"amountKobo" binding:"required,min=100"`
	BankAccountID string  `json:"bankAccountId" binding:"required"`
	Reason        string  `json:"reason"`
	EvidenceLabel *string `json:"evidenceLabel"`
}

// WithdrawalResult is the object returned after a withdrawal is paid out.
type WithdrawalResult struct {
	ID          string `json:"id"`
	Reference   string `json:"reference"`
	Status      string `json:"status"` // COMPLETED on success; PENDING only on an idempotent replay that hasn't posted yet
	AmountKobo  int64  `json:"amountKobo"`
	BankLabel   string `json:"bankLabel"`
	RequestedAt string `json:"requestedAt"`
}

// Ledger entry type / status enum values (mirror the client LedgerEntryType and
// LedgerEntry.status unions). The SQL projection in service.go emits these
// literals directly; they are documented here as the canonical contract:
//
//	type:   CONTRIBUTION | WITHDRAWAL | REFUND | REVERSAL | MILESTONE_RELEASE
//	status: POSTED | PENDING | REVERSED
