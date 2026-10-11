// Package cryptoprov is the provider abstraction for crypto trading. Providers
// implement small capability interfaces; callers ask for a capability with As and
// get ErrUnsupported when a provider does not offer it. Every provider call that
// moves value is made by the service layer under write-ahead intent, so the
// interfaces here carry only the calls and their error semantics.
package cryptoprov

import (
	"context"
	"errors"
	"time"

	"github.com/shopspring/decimal"
)

// AssetClass separates crypto from future equity brokers without changing the interfaces.
type AssetClass string

const (
	AssetClassCrypto AssetClass = "crypto"
	AssetClassEquity AssetClass = "equity"
)

// ErrUnsupported is returned when a provider does not implement a capability.
var ErrUnsupported = errors.New("cryptoprov: capability not supported by provider")

// ErrNotFound is returned when the provider has no record for a reference.
var ErrNotFound = errors.New("cryptoprov: not found")

// Provider is implemented by every adapter.
type Provider interface {
	Name() string
	AssetClass() AssetClass
}

// MarketProvider reads prices. Reads are cacheable and retry-safe.
type MarketProvider interface {
	Ticker(ctx context.Context, market string) (Ticker, error)
}

// SwapProvider converts one asset to another. A quote is valid only for a short
// window; ConfirmSwap executes it and must be idempotent per quote id.
type SwapProvider interface {
	QuoteSwap(ctx context.Context, req SwapQuoteRequest) (SwapQuote, error)
	ConfirmSwap(ctx context.Context, quoteID string) (Swap, error)
	GetSwap(ctx context.Context, swapID string) (Swap, error)
}

// WithdrawalProvider moves crypto out of custody. The reference is the caller's
// deterministic idempotency reference; the provider is expected to honour it.
type WithdrawalProvider interface {
	Withdraw(ctx context.Context, req WithdrawRequest) (Withdrawal, error)
	GetWithdrawal(ctx context.Context, id string) (Withdrawal, error)
}

// WebhookProvider authenticates and parses inbound provider events.
type WebhookProvider interface {
	VerifyWebhook(headers map[string]string, body []byte) error
	ParseWebhook(body []byte) (Event, error)
}

// Ticker is a market price snapshot.
type Ticker struct {
	Market string
	Last   decimal.Decimal
	At     time.Time
}

// SwapQuoteRequest asks for a quote with exactly one side fixed.
type SwapQuoteRequest struct {
	AccountID  string
	From       string
	To         string
	FromAmount decimal.Decimal // set exactly one of FromAmount / ToAmount
	ToAmount   decimal.Decimal
}

// SwapQuote is a priced, time-limited swap offer.
type SwapQuote struct {
	QuoteID   string
	From      string
	To        string
	FromAmt   decimal.Decimal
	ToAmt     decimal.Decimal
	Price     decimal.Decimal
	ExpiresAt time.Time
}

// Swap is an executed (or in-flight) conversion.
type Swap struct {
	ID      string
	QuoteID string
	Status  SwapStatus
	ToAmt   decimal.Decimal
}

// SwapStatus is the provider-side state of a swap.
type SwapStatus string

const (
	SwapPending   SwapStatus = "pending"
	SwapCompleted SwapStatus = "completed"
	SwapFailed    SwapStatus = "failed"
)

// WithdrawRequest is a withdrawal instruction. Reference must be deterministic per
// logical withdrawal so a retry can never create a second transfer.
type WithdrawRequest struct {
	AccountID string
	Currency  string
	Network   string
	Address   string
	Tag       string
	Amount    decimal.Decimal
	Reference string
}

// Withdrawal is the provider-side record of a transfer.
type Withdrawal struct {
	ID     string
	Status WithdrawalStatus
	TxID   string
}

// WithdrawalStatus is the provider-side state of a withdrawal.
type WithdrawalStatus string

const (
	WithdrawalProcessing WithdrawalStatus = "processing"
	WithdrawalDone       WithdrawalStatus = "done"
	WithdrawalRejected   WithdrawalStatus = "rejected"
)

// Event is a parsed webhook. Key is the provider's stable dedupe key.
type Event struct {
	Key  string
	Type string
	Ref  string
}

// As returns p as the capability interface T, or ErrUnsupported when p does not
// implement it. It keeps callers from type-asserting ad hoc.
func As[T any](p Provider) (T, error) {
	var zero T
	t, ok := p.(T)
	if !ok {
		return zero, ErrUnsupported
	}
	return t, nil
}
