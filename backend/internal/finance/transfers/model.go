package transfers

import "time"

// WalletTransferStatus tracks the lifecycle of a wallet-to-wallet transfer.
type WalletTransferStatus string

const (
	WalletTransferPending   WalletTransferStatus = "pending"
	WalletTransferCompleted WalletTransferStatus = "completed"
	WalletTransferFailed    WalletTransferStatus = "failed"
)

// BankTransferStatus tracks the lifecycle of a wallet-to-bank transfer.
type BankTransferStatus string

const (
	BankTransferFundsReserved      BankTransferStatus = "funds_reserved"
	BankTransferProviderInitiated  BankTransferStatus = "provider_initiated"
	BankTransferSuccessful         BankTransferStatus = "successful"
	BankTransferFailed             BankTransferStatus = "failed"
	BankTransferReversed           BankTransferStatus = "reversed"
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

// BankTransfer represents a wallet-to-bank transfer.
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
}

// BankTransferRequest is the body for POST /finance/transfers/bank.
type BankTransferRequest struct {
	AccountNumber  string `json:"account_number" binding:"required"`
	BankCode       string `json:"bank_code" binding:"required"`
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100000"` // min ₦1000
	Narration      string `json:"narration"`
	SaveBeneficiary bool  `json:"save_beneficiary"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
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
