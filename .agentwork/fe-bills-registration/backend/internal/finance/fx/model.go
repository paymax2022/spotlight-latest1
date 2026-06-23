package fx

import "time"

// CurrencyWallet is a user's balance in a non-NGN currency.
type CurrencyWallet struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Currency     string    `json:"currency"` // ISO 4217: "USD", "GBP", "EUR"
	BalanceMinor int64     `json:"balance_minor"` // cents/pence/cents in minor units
	CreatedAt    time.Time `json:"created_at"`
}

// FXQuote holds a Maplerad rate quote that is Redis-reserved with a TTL.
type FXQuote struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	ProviderQuoteID string    `json:"provider_quote_id"`
	SourceCurrency  string    `json:"source_currency"`
	TargetCurrency  string    `json:"target_currency"`
	SourceAmountKobo int64    `json:"source_amount_kobo"`
	TargetAmountMinor int64   `json:"target_amount_minor"`
	Rate            float64   `json:"rate"`
	FeeKobo         int64     `json:"fee_kobo"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

// FXConversion is the executed record of a currency exchange.
type FXConversion struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	QuoteID           string    `json:"quote_id"`
	ProviderTxnID     string    `json:"provider_txn_id"`
	SourceCurrency    string    `json:"source_currency"`
	TargetCurrency    string    `json:"target_currency"`
	SourceAmountKobo  int64     `json:"source_amount_kobo"`
	TargetAmountMinor int64     `json:"target_amount_minor"`
	Rate              float64   `json:"rate"`
	FeeKobo           int64     `json:"fee_kobo"`
	Status            string    `json:"status"` // pending | completed | failed
	Reference         string    `json:"reference"`
	IdempotencyKey    string    `json:"idempotency_key"`
	CreatedAt         time.Time `json:"created_at"`
}

// QuoteRequest is the body for POST /finance/fx/quote.
type QuoteRequest struct {
	SourceCurrency string `json:"source_currency" binding:"required"`
	TargetCurrency string `json:"target_currency" binding:"required"`
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
}

// ConvertRequest is the body for POST /finance/fx/convert.
type ConvertRequest struct {
	QuoteID        string `json:"quote_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// RateResponse is returned from GET /finance/fx/rates.
type RateResponse struct {
	SourceCurrency string  `json:"source_currency"`
	TargetCurrency string  `json:"target_currency"`
	Rate           float64 `json:"rate"`
	UpdatedAt      string  `json:"updated_at"`
}
