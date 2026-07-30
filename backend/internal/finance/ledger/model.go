package ledger

import "time"

// EntryType mirrors the ENUM in the Supabase migration.
type EntryType string

const (
	EntryCredit         EntryType = "CREDIT"
	EntryDebit          EntryType = "DEBIT"
	EntryReversalCredit EntryType = "REVERSAL_CREDIT"
	EntryReversalDebit  EntryType = "REVERSAL_DEBIT"
)

// AccountType identifies the logical wallet / standing account.
type AccountType string

const (
	AccountUserWallet         AccountType = "user_wallet"
	AccountVirtualAccount     AccountType = "virtual_account"
	AccountEscrow             AccountType = "escrow"
	AccountRefund             AccountType = "refund"
	AccountProviderClearing   AccountType = "provider_clearing"
	AccountPaymaxRevenue      AccountType = "paymax_revenue"
	AccountCommission         AccountType = "commission"
	AccountReferralReward     AccountType = "referral_reward_expense"
	AccountFXSpreadIncome     AccountType = "fx_spread_income"
	AccountSettlement         AccountType = "settlement"
	AccountFailedTransferSusp AccountType = "failed_transfer_suspense"
	// Featured Placement standing accounts (paid landing-page promotion).
	// Escrow holds a merchant's pre-paid placement spend; on completion the
	// earned portion is recognized into revenue, with unused remainder reversed
	// back to the merchant wallet. Same standing-account pattern as escrow above
	// (auto-created on first GetOrCreateStandingAccount; no seed row required).
	AccountPlacementEscrow  AccountType = "placement_escrow"
	AccountPlacementRevenue AccountType = "placement_revenue"
	// EdTech Fees segregated vault (SF-5). All FeesVault (savings-pot) funds route
	// through a standing account of this type so vault balances reconcile separately
	// from general float. Auto-created on first GetOrCreateStandingAccount; no seed
	// row required. Segregation is by dedicated AccountType (the ledger has no
	// free-form purpose column); the reference string carries the human-readable
	// purpose.
	AccountEdtechFeesVault AccountType = "edtech_fees_vault"
)

// Account is a logical wallet / standing account in the ledger.
type Account struct {
	ID        string      `json:"id"`
	UserID    *string     `json:"user_id,omitempty"` // nil for standing accounts
	Type      AccountType `json:"type"`
	CreatedAt time.Time   `json:"created_at"`
}

// Entry is one side of a double-entry journal entry. Immutable once written.
type Entry struct {
	ID             string    `json:"id"`
	AccountID      string    `json:"account_id"`
	Type           EntryType `json:"type"`
	AmountKobo     int64     `json:"amount_kobo"` // always positive; direction from EntryType
	Reference      string    `json:"reference"`   // human-readable ref (e.g. "topup:xxx")
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// JournalEntry is a balanced pair (debit account + credit account) representing
// one financial event. Both sides are written atomically.
type JournalEntry struct {
	Reference       string
	IdempotencyKey  string
	AmountKobo      int64
	DebitAccountID  string
	CreditAccountID string
	Description     string
}
