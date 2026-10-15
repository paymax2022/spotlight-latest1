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

	// Quote data the confirm step needs.
	ProviderQuoteID string
	IdempotencyKey  string
	FromCurrency    string
	ToCurrency      string
	FromAmount      decimal.Decimal
	QuotedToAmount  decimal.Decimal
	QuotedPrice     decimal.Decimal
	ExpiresAt       time.Time
	// ExecuteAttempted is set (once) immediately before the provider is asked to execute.
	// A confirming swap with this set and no provider swap id has an UNKNOWN outcome and is
	// never executed or refunded blindly.
	ExecuteAttempted bool
	// UpdatedAt is the last write to the row; the reconciler ages swaps by it.
	UpdatedAt time.Time
}

// NewSwap is a freshly quoted swap to persist.
type NewSwap struct {
	UserID, Provider, ProviderAccountID, ProviderQuoteID, IdempotencyKey string
	FromCurrency, ToCurrency                                             string
	Side                                                                 Side
	FromAmount, QuotedToAmount, QuotedPrice                              decimal.Decimal
	NGNKobo, FeeKobo                                                     int64
	FeeBps                                                               int
	ExpiresAt                                                            time.Time
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

	// InsertSwap persists a quoted swap. A repeat of (user, idempotency key) returns the
	// existing row with created=false instead of a second quote.
	InsertSwap(ctx context.Context, n NewSwap) (rec SwapRecord, created bool, err error)
	// StaleSwaps returns up to limit swaps in state whose last write is older than olderThan,
	// oldest first. It is the reconciler's work queue; it must not lock rows.
	StaleSwaps(ctx context.Context, state cryptoprov.SwapState, olderThan time.Time, limit int) ([]SwapRecord, error)
	// TouchSwap bumps updated_at only while the swap is still in state, so a pass that
	// changed nothing rotates a stuck swap to the back of the age-ordered work queue.
	TouchSwap(ctx context.Context, id string, state cryptoprov.SwapState) error
	// SwapByIdempotencyKey finds the user's swap for a quote idempotency key.
	SwapByIdempotencyKey(ctx context.Context, userID, key string) (SwapRecord, bool, error)
	// SwapByID reads a swap owned by userID; another user's id is simply not found.
	SwapByID(ctx context.Context, userID, id string) (SwapRecord, bool, error)
	// ListByState returns swaps in state across all users, oldest parked first
	// (updated_at asc), paginated by limit/offset (the caller bounds them). It backs
	// the admin review queue; it is read-only and must not lock rows.
	ListByState(ctx context.Context, state cryptoprov.SwapState, limit, offset int) ([]SwapRecord, error)
	// Backlog rolls up the OPEN swaps (quoted, confirming, processing, needs_review) by state:
	// how many, the NGN held for them (ngn+fee, kobo) and the oldest last write. States with no
	// rows may be omitted. It is read-only, takes no row locks and returns no swap contents.
	Backlog(ctx context.Context) ([]BacklogState, error)
	// SwapByIDAny reads a swap by id WITHOUT user scoping. It is for the admin resolution
	// path only (the caller is already gated by the crypto.admin permission); member reads
	// must use SwapByID so another user's id stays 404.
	SwapByIDAny(ctx context.Context, id string) (SwapRecord, bool, error)
	// MarkExecuteAttempt records that the provider call is about to be made. first is true
	// only for the call that set it.
	MarkExecuteAttempt(ctx context.Context, id string) (first bool, err error)
	// SetProviderSwapID records the provider's swap id once; it never overwrites a different id.
	SetProviderSwapID(ctx context.Context, id, providerSwapID string) (bool, error)
	// ProviderAccount / SaveProviderAccount manage the user's custodial sub-account.
	ProviderAccount(ctx context.Context, userID, provider string) (string, bool, error)
	SaveProviderAccount(ctx context.Context, userID, provider, accountID string) error
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

// BacklogState is one state's rollup in the operational backlog.
type BacklogState struct {
	State           cryptoprov.SwapState
	Count           int64
	HeldKobo        int64
	OldestUpdatedAt time.Time // zero when Count is 0
}
