package wallet

import "time"

// BalanceResponse is the API response for GET /finance/wallet/balance.
type BalanceResponse struct {
	UserID      string `json:"user_id"`
	BalanceKobo int64  `json:"balance_kobo"`
	// Convenience field for display; clients should format from balance_kobo.
	BalanceNaira float64 `json:"balance_naira"`
}

// TopupIntent represents an initiated Paystack payment before webhook confirmation.
type TopupIntent struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Reference      string    `json:"reference"`
	PaystackRef    string    `json:"paystack_ref"`
	Status         string    `json:"status"` // pending | success | failed
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// TopupRequest is the request body for POST /finance/wallet/topup.
type TopupRequest struct {
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// TopupResponse is returned from POST /finance/wallet/topup.
type TopupResponse struct {
	Reference       string `json:"reference"`
	PaystackAuthURL string `json:"paystack_auth_url"`
	AmountKobo      int64  `json:"amount_kobo"`
}

// Transaction is a user-facing view of one ledger entry.
type Transaction struct {
	ID         string    `json:"id"`
	Type       string    `json:"type"` // credit | debit
	AmountKobo int64     `json:"amount_kobo"`
	Reference  string    `json:"reference"`
	CreatedAt  time.Time `json:"created_at"`
}

// TransactionsResponse wraps a page of transactions.
type TransactionsResponse struct {
	Transactions []Transaction `json:"transactions"`
	Total        int           `json:"total"`
	Limit        int           `json:"limit"`
	Offset       int           `json:"offset"`
}
