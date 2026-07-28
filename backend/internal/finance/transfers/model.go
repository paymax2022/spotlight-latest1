package transfers

import "time"

// WalletTransferStatus tracks the lifecycle of a wallet-to-wallet transfer.
type WalletTransferStatus string

const (
	// Status values align with contracts/openapi.yaml WalletTransfer.status
	// enum: [successful, failed, reversed].
	WalletTransferSuccessful WalletTransferStatus = "successful"
	WalletTransferFailed     WalletTransferStatus = "failed"
	WalletTransferReversed   WalletTransferStatus = "reversed"
)

// BankTransferStatus tracks the lifecycle of a wallet-to-bank transfer.
type BankTransferStatus string

const (
	BankTransferFundsReserved     BankTransferStatus = "funds_reserved"     // wallet→bank: wallet debited, awaiting provider
	BankTransferAwaitingFunding   BankTransferStatus = "awaiting_funding"   // bank→bank: collection initiated, awaiting pay-in
	BankTransferFunded            BankTransferStatus = "funded"             // bank→bank: pay-in received into clearing
	BankTransferProviderInitiated BankTransferStatus = "provider_initiated" // payout accepted by the provider
	BankTransferSuccessful        BankTransferStatus = "successful"
	BankTransferFailed            BankTransferStatus = "failed"
	BankTransferReversed          BankTransferStatus = "reversed"
)

// SourceType distinguishes wallet→bank from bank→bank pass-through.
type SourceType string

const (
	SourceWallet SourceType = "wallet" // debit the user wallet
	SourceBank   SourceType = "bank"   // collect via provider into provider_clearing, then disburse
)

// WalletTransfer represents a wallet-to-wallet transfer.
type WalletTransfer struct {
	ID             string               `json:"id"`
	SenderID       string               `json:"sender_id"`
	RecipientID    string               `json:"recipient_id"`
	AmountKobo     int64                `json:"amount_kobo"`
	FeeKobo        int64                `json:"fee_kobo"`
	Reference      string               `json:"reference"`
	Status         WalletTransferStatus `json:"status"`
	IdempotencyKey string               `json:"idempotency_key"`
	CreatedAt      time.Time            `json:"created_at"`
	// AlreadyProcessed is true when this result was returned by an idempotent
	// replay (same Idempotency-Key seen before) rather than a fresh mutation.
	AlreadyProcessed bool `json:"already_processed,omitempty"`
}

// WalletTransferRequest is the body for POST /finance/transfers/paymax.
type WalletTransferRequest struct {
	RecipientPhone string `json:"recipient_phone" binding:"required"`
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
	Narration      string `json:"narration"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// WalletTransferResolveResponse is the response for GET /finance/transfers/paymax/resolve.
type WalletTransferResolveResponse struct {
	UserID       string `json:"user_id"`
	FullName     string `json:"full_name"`
	MaskedPhone  string `json:"masked_phone"`
}

// BankTransfer represents a wallet-to-bank or bank-to-bank transfer.
type BankTransfer struct {
	ID             string             `json:"id"`
	UserID         string             `json:"user_id"`
	AmountKobo     int64              `json:"amount_kobo"`
	FeeKobo        int64              `json:"fee_kobo"`
	AccountNumber  string             `json:"account_number"`
	AccountName    string             `json:"account_name"`
	BankCode       string             `json:"bank_code"`
	Reference      string             `json:"reference"`
	Status         BankTransferStatus `json:"status"`
	TransferCode   *string            `json:"transfer_code,omitempty"`
	IdempotencyKey string             `json:"idempotency_key"`
	CreatedAt      time.Time          `json:"created_at"`
	// Multi-provider + bank→bank fields (additive; mirror the migration columns).
	Provider              string  `json:"provider"`
	SourceType            string  `json:"source_type"`
	ProviderRecipientCode *string `json:"provider_recipient_code,omitempty"`
	ProviderTransferRef   *string `json:"provider_transfer_ref,omitempty"`
	FailoverFrom          *string `json:"failover_from,omitempty"`
	FundingReference      *string `json:"funding_reference,omitempty"`
	FundingStatus         *string `json:"funding_status,omitempty"`
	// AlreadyProcessed is true when returned by an idempotent replay.
	AlreadyProcessed bool `json:"already_processed,omitempty"`
}

// BankTransferRequest is the body for POST /finance/transfers/bank (wallet→bank).
type BankTransferRequest struct {
	AccountNumber   string `json:"account_number" binding:"required"`
	BankCode        string `json:"bank_code" binding:"required"`
	AmountKobo      int64  `json:"amount_kobo" binding:"required,min=100000"` // min ₦1000
	Narration       string `json:"narration"`
	SaveBeneficiary bool   `json:"save_beneficiary"`
	Provider        string `json:"provider"` // optional preferred provider; "" = registry default
	PIN             string `json:"pin" binding:"required"`
	IdempotencyKey  string `json:"idempotency_key" binding:"required"`
}

// BankToBankRequest is the body for POST /finance/transfers/bank-to-bank.
// The user funds the transfer FROM a bank through the provider (a collection into
// provider_clearing); once funded it is disbursed to the destination bank.
type BankToBankRequest struct {
	AccountNumber   string `json:"account_number" binding:"required"`
	BankCode        string `json:"bank_code" binding:"required"`
	AmountKobo      int64  `json:"amount_kobo" binding:"required,min=100000"`
	Narration       string `json:"narration"`
	SaveBeneficiary bool   `json:"save_beneficiary"`
	Provider        string `json:"provider"`
	PIN             string `json:"pin" binding:"required"`
	IdempotencyKey  string `json:"idempotency_key" binding:"required"`
}

// Beneficiary is a saved payout destination (generalized, multi-provider).
type Beneficiary struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"user_id"`
	Provider              string    `json:"provider"`
	BankCode              string    `json:"bank_code"`
	AccountNumber         string    `json:"account_number"`
	AccountName           string    `json:"account_name"`
	ProviderRecipientCode *string   `json:"provider_recipient_code,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
}

// SaveBeneficiaryRequest is the body for POST /finance/transfers/beneficiaries.
type SaveBeneficiaryRequest struct {
	AccountNumber string `json:"account_number" binding:"required"`
	BankCode      string `json:"bank_code" binding:"required"`
	Provider      string `json:"provider"`
}

// ResolveAccountRequest is the body for POST /finance/transfers/resolve-account.
type ResolveAccountRequest struct {
	AccountNumber string `json:"account_number" binding:"required"`
	BankCode      string `json:"bank_code" binding:"required"`
	Provider      string `json:"provider"`
}

// SetPinRequest is the body for POST /finance/transfers/pin.
type SetPinRequest struct {
	PIN        string `json:"pin" binding:"required"`
	CurrentPIN string `json:"current_pin"`
}

// VerifyPinRequest is the body for POST /finance/transfers/pin/verify.
type VerifyPinRequest struct {
	PIN string `json:"pin" binding:"required"`
}

// Fee schedule (kobo).
func WalletTransferFee(amountKobo int64) int64 {
	switch {
	case amountKobo <= 500_000:
		return 0
	case amountKobo <= 5_000_000:
		return 1_000
	default:
		return 2_500
	}
}

func BankTransferFee(amountKobo int64) int64 {
	switch {
	case amountKobo <= 500_000:
		return 1_000
	case amountKobo <= 5_000_000:
		return 2_500
	default:
		return 5_000
	}
}
