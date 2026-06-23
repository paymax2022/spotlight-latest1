package orchestration

import "time"

// Rail is a settlement rail (spec §5.4).
type Rail string

const (
	RailBankTransfer Rail = "bank_transfer"
	RailMobileMoney  Rail = "mobile_money"
	RailIBAN         Rail = "iban"
	RailWallet       Rail = "wallet"
	RailStablecoin   Rail = "stablecoin"
)

// Intent distinguishes the lifecycle a quote is requested for.
type Intent string

const (
	IntentConversion Intent = "conversion"
	IntentTransfer   Intent = "transfer"
	IntentCollection Intent = "collection"
)

// AmountType indicates which side of a quote the requested amount pegs.
type AmountType string

const (
	AmountSource      AmountType = "source"
	AmountDestination AmountType = "destination"
)

// FeeType categorises an itemized quote fee (transparency, spec §9).
type FeeType string

const (
	FeeProvider FeeType = "provider_fee"
	FeeRail     FeeType = "rail_fee"
	FeeSpread   FeeType = "paymax_spread"
)

// Fee is one itemized charge on a quote.
type Fee struct {
	Type   FeeType `json:"type"`
	Amount Money   `json:"amount"`
}

// Route is the {provider, corridor, rail} the router selected.
type Route struct {
	Provider string `json:"provider"`
	Corridor string `json:"corridor"`
	Rail     Rail   `json:"rail"`
}

// Alternative is a non-chosen viable route surfaced for transparency/ops.
type Alternative struct {
	Provider  string  `json:"provider"`
	Corridor  string  `json:"corridor"`
	Rail      Rail    `json:"rail"`
	AllInRate float64 `json:"all_in_rate"`
	Destination Money `json:"destination"`
}

// QuoteStatus follows Appendix B: quoted -> locked -> consumed | expired.
type QuoteStatus string

const (
	QuoteQuoted   QuoteStatus = "quoted"
	QuoteLocked   QuoteStatus = "locked"
	QuoteConsumed QuoteStatus = "consumed"
	QuoteExpired  QuoteStatus = "expired"
)

// Quote is a priced, time-boxed offer with a chosen route and alternatives.
type Quote struct {
	ID           string        `json:"id"`
	CustomerID   string        `json:"-"`
	Status       QuoteStatus   `json:"status"`
	AmountType   AmountType    `json:"amount_type"`
	Source       Money         `json:"source"`
	Destination  Money         `json:"destination"`
	Rate         float64       `json:"rate"`
	AllInRate    float64       `json:"all_in_rate"`
	Fees         []Fee         `json:"fees"`
	Route        Route         `json:"route"`
	Alternatives []Alternative `json:"alternatives"`
	Locked       bool          `json:"locked"`
	Intent       Intent        `json:"-"`
	ExpiresAt    time.Time     `json:"expires_at"`
	CreatedAt    time.Time     `json:"-"`
}

// Expired reports whether the quote's lock window has elapsed.
func (q *Quote) Expired(now time.Time) bool { return now.After(q.ExpiresAt) }

// ConversionStatus follows Appendix B: pending -> settled | failed.
type ConversionStatus string

const (
	ConvPending ConversionStatus = "pending"
	ConvSettled ConversionStatus = "settled"
	ConvFailed  ConversionStatus = "failed"
)

// Conversion is the executed record of FX between two held balances.
type Conversion struct {
	ID            string           `json:"id"`
	Reference     string           `json:"reference"`
	CustomerID    string           `json:"customer_id"`
	Status        ConversionStatus `json:"status"`
	Source        Money            `json:"source"`
	Destination   Money            `json:"destination"`
	Rate          float64          `json:"rate"`
	AllInRate     float64          `json:"all_in_rate"`
	Fees          []Fee            `json:"fees"`
	Route         Route            `json:"route"`
	ProviderRef    string           `json:"provider_ref"`
	TransactionID  string           `json:"transaction_id"`
	IdempotencyKey string           `json:"-"`
	CreatedAt      time.Time        `json:"created_at"`
}

// TransferStatus follows Appendix B: queued -> processing -> paid | failed | reversed.
type TransferStatus string

const (
	TransferQueued     TransferStatus = "queued"
	TransferProcessing TransferStatus = "processing"
	TransferPaid       TransferStatus = "paid"
	TransferFailed     TransferStatus = "failed"
	TransferReversed   TransferStatus = "reversed"
)

// Counterparty identifies a payout destination holder.
type Counterparty struct {
	Name string `json:"name"`
}

// Destination is an inline payout target (spec §5.4).
type Destination struct {
	Rail          Rail         `json:"rail"`
	Currency      string       `json:"currency"`
	Scheme        string       `json:"scheme"`
	AccountNumber string       `json:"account_number"`
	BankCode      string       `json:"bank_code,omitempty"`
	Counterparty  Counterparty `json:"counterparty"`
}

// StatusEvent is one entry in a transfer's status history.
type StatusEvent struct {
	Status string    `json:"status"`
	At     time.Time `json:"at"`
}

// Transfer is a payout to a beneficiary/rail, optionally with embedded FX.
type Transfer struct {
	ID            string         `json:"id"`
	Reference     string         `json:"reference"`
	CustomerID    string         `json:"customer_id"`
	Status        TransferStatus `json:"status"`
	Source        Money          `json:"source"`
	Destination   Money          `json:"destination"`
	QuotedRate    float64        `json:"quoted_rate"`
	ExecutedRate  float64        `json:"executed_rate"`
	Fees          []Fee          `json:"fees"`
	Route         Route          `json:"route"`
	Narration     string         `json:"narration,omitempty"`
	ProviderRef    string         `json:"provider_ref"`
	TransactionID  string         `json:"transaction_id"`
	StatusHistory  []StatusEvent  `json:"status_history"`
	IdempotencyKey string         `json:"-"`
	CreatedAt      time.Time      `json:"created_at"`
}

// VirtualAccount is an inbound collection account (spec §5.5).
type VirtualAccount struct {
	ID        string                 `json:"id"`
	CustomerID string                `json:"-"`
	Currency  string                 `json:"currency"`
	Type      string                 `json:"type"` // virtual_account | iban
	Provider  string                 `json:"provider"`
	Status    string                 `json:"status"`
	Details   map[string]interface{} `json:"details"`
	CreatedAt time.Time              `json:"created_at"`
}

// --- Request bodies (normalized API) ---

// QuoteRequest is POST /v1/quotes.
type QuoteRequest struct {
	Source          string     `json:"source" binding:"required"`          // ISO-4217
	Destination     string     `json:"destination" binding:"required"`     // ISO-4217
	Amount          int64      `json:"amount" binding:"required,min=1"`    // minor units
	AmountType      AmountType `json:"amount_type"`                        // default source
	Intent          Intent     `json:"intent" binding:"required"`
	DestinationRail Rail       `json:"destination_rail,omitempty"`
	Lock            bool       `json:"lock"`
}

// ConversionRequest is POST /v1/conversions.
type ConversionRequest struct {
	QuoteID    string `json:"quote_id" binding:"required"`
	CustomerID string `json:"customer_id"`
	Reference  string `json:"reference,omitempty"`
}

// TransferRequest is POST /v1/transfers.
type TransferRequest struct {
	QuoteID      string       `json:"quote_id,omitempty"` // omit for same-currency
	CustomerID   string       `json:"customer_id"`
	BeneficiaryID string      `json:"beneficiary_id,omitempty"`
	Destination  *Destination `json:"destination,omitempty"`
	Amount       *Money       `json:"amount,omitempty"`
	Narration    string       `json:"narration,omitempty"`
	Reference    string       `json:"reference,omitempty"`
}

// CollectionRequest is POST /v1/collections/virtual-accounts.
type CollectionRequest struct {
	CustomerID string `json:"customer_id"`
	Currency   string `json:"currency" binding:"required"`
	Type       string `json:"type" binding:"required"` // virtual_account | iban
}
