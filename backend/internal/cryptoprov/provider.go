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

// AccountProvider creates the provider-side account (one per user, custodial).
type AccountProvider interface {
	CreateAccount(ctx context.Context, u UserRef) (AccountRef, error)
}

// WalletProvider reads balances and issues deposit addresses for an account.
type WalletProvider interface {
	Wallets(ctx context.Context, accountID string) ([]Wallet, error)
	CreateDepositAddress(ctx context.Context, accountID, currency, network string) (DepositAddress, error)
}

// SwapProvider converts one asset to another. A quote is valid only for a short
// window; ConfirmSwap executes it and must be idempotent per quote id. Every call is
// scoped to the account that owns the quote.
type SwapProvider interface {
	QuoteSwap(ctx context.Context, req SwapQuoteRequest) (SwapQuote, error)
	ConfirmSwap(ctx context.Context, accountID, quoteID string) (Swap, error)
	GetSwap(ctx context.Context, accountID, swapID string) (Swap, error)
}

// WithdrawalProvider moves crypto out of custody. The reference is the caller's
// deterministic idempotency reference; the provider is expected to honour it.
type WithdrawalProvider interface {
	Withdraw(ctx context.Context, req WithdrawRequest) (Withdrawal, error)
	GetWithdrawal(ctx context.Context, accountID, id string) (Withdrawal, error)
}

// WebhookProvider authenticates and parses inbound provider events.
type WebhookProvider interface {
	VerifyWebhook(headers map[string]string, body []byte) error
	ParseWebhook(body []byte) (Event, error)
}

// UserRef identifies the platform user a provider account is created for. Only the
// fields the provider needs; never carries KYC documents.
type UserRef struct {
	UserID    string
	Email     string
	FirstName string
	LastName  string
}

// AccountRef is the provider-side account.
type AccountRef struct {
	ID string
}

// Wallet is one currency balance on a provider account.
type Wallet struct {
	Currency string
	Balance  decimal.Decimal
	Locked   decimal.Decimal
}

// DepositAddress is where a user sends crypto. Tag is the memo/tag some networks require.
type DepositAddress struct {
	Currency string
	Network  string
	Address  string
	Tag      string
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
	// Raw is the original data object. It is for diagnostics and re-query hints only:
	// the service must re-read the provider for the authoritative state and never
	// release value on a webhook payload alone.
	Raw []byte
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
