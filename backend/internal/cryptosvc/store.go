// Package cryptosvc holds the crypto service layer that sits on the cryptoprov
// provider abstraction. This slice is the inbound-webhook path only: verify, dedupe,
// re-query the provider for the authoritative state, and apply a conditional swap
// transition. It posts nothing to the ledger yet; settlement is a later slice.
package cryptosvc

import (
	"context"
	"errors"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// SwapRecord is our row for one provider swap.
type SwapRecord struct {
	ID                string
	UserID            string
	Provider          string
	ProviderAccountID string
	ProviderSwapID    string
	State             cryptoprov.SwapState
	ReceivedAmount    decimal.Decimal

	// Ledger inputs, fixed at quote time so a later fee-schedule change never reprices
	// an open swap. Side says which NGN legs exist (buy, sell, or swap = none).
	Side    Side
	NGNKobo int64 // buy: NGN principal paid; sell: quoted gross proceeds
	FeeBps  int
	FeeKobo int64 // buy: platform fee charged on top of NGNKobo
}

// WebhookEvent is one received delivery. Key is the provider's stable dedupe key.
type WebhookEvent struct {
	Key        string
	Provider   string
	Type       string
	Payload    []byte
	ReceivedAt time.Time
}

// Store is the persistence the webhook path needs. Implementations must make
// InsertWebhookEvent and TransitionSwap atomic: the dedupe key is a primary key and
// the transition is a conditional UPDATE ... WHERE status = from.
type Store interface {
	// InsertWebhookEvent records the delivery. inserted is false when the key already exists.
	InsertWebhookEvent(ctx context.Context, ev WebhookEvent) (inserted bool, err error)
	// DeleteWebhookEvent removes the dedupe row so a provider retry re-runs processing.
	DeleteWebhookEvent(ctx context.Context, key string) error
	// SwapByProviderID finds our swap row for a provider swap id.
	SwapByProviderID(ctx context.Context, provider, providerSwapID string) (SwapRecord, bool, error)
	// TransitionSwap moves from -> to only if the row is still in from. applied is
	// false when another writer (user request, reconciler) won the race.
	TransitionSwap(ctx context.Context, id string, from, to cryptoprov.SwapState, received decimal.Decimal, reason string) (applied bool, err error)
}

var (
	// ErrUnknownProvider means the webhook path names a provider that is not registered.
	ErrUnknownProvider = errors.New("cryptosvc: unknown provider")
	// ErrSwapNotRecorded means a swap event arrived before we persisted the swap
	// (the confirm response may still be in flight). It is retryable: the dedupe row
	// is removed so the provider's redelivery is processed.
	ErrSwapNotRecorded = errors.New("cryptosvc: swap not recorded yet")
	// ErrBadSignature is returned for any delivery that fails verification (HTTP 401).
	ErrBadSignature = cryptoprov.ErrBadSignature
)
