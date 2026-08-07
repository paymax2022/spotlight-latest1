package va

import "time"

// VirtualAccount mirrors the virtual_accounts table.
type VirtualAccount struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Provider      string    `json:"provider"`
	AccountNumber string    `json:"account_number"`
	AccountName   string    `json:"account_name"`
	BankName      string    `json:"bank_name"`
	BankCode      string    `json:"bank_code,omitempty"`
	ProvisionedAt time.Time `json:"provisioned_at"`
}

// InboundTransfer is a credit event from a bank transfer into a virtual account.
type InboundTransfer struct {
	AccountNumber  string
	AmountKobo     int64
	Reference      string // Paystack transfer reference
	SenderName     string
	SenderBank     string
	IdempotencyKey string // derived from Paystack event ID
}
