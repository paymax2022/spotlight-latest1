package utilitybills

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ════════════════════════════════════════════════════════════════════════════
// OUTBOUND PURCHASE IDEMPOTENCY
// ════════════════════════════════════════════════════════════════════════════
//
// Adapted from backend/internal/insurance/policy/outbound_idempotency.go, whose
// Claim/Succeeded/Failed/Unknown/UnresolvedCount shape solves exactly this
// problem. The columns differ (VTpass routes across multiple providers and keys
// on a biller/product code, not a policy id), which is why this is a separate
// table rather than a widened insurance one — see the migration plan's decision
// #3.
//
// VTpass's own idempotency is WEAK in a way that matters here: request_id is
// derived from an Africa/Lagos YYYYMMDDHHmm prefix plus the key's last 20
// alphanumerics (see provider/vtpass/vtpass.go's vtpassRequestID), so the SAME
// idempotency key retried in the NEXT minute produces a DIFFERENT request_id and
// VTpass happily sells the customer a second unit of electricity. The guarantee
// therefore has to live on our side.
//
// The mechanism is the primary key on utility_provider_bind: claiming a key is an
// INSERT ... ON CONFLICT DO NOTHING, so a replayed or concurrent attempt cannot
// claim it and therefore cannot reach VTpass at all. No locks, no windows.
//
// The hard case is a TRANSPORT failure (timeout, reset connection, context
// deadline). VTpass keeps processing after our socket gives up, so the error
// genuinely does not say whether a purchase happened. That outcome is recorded as
// `unknown` and is NEVER auto-retried: retrying might buy a second bundle, and
// giving up might strand a member who has been debited. Phase 3's scheduled
// requery job resolves these against VTpass; until then the key stays locked and
// UnresolvedCount surfaces the backlog.

// Bind states. Kept as constants rather than bare strings so the CHECK
// constraint in the migration and this file can never drift apart silently.
const (
	BindStateInFlight  = "in_flight"
	BindStateSucceeded = "succeeded"
	BindStateFailed    = "failed"
	BindStateUnknown   = "unknown"
)

// BindClaim is the outcome of claiming an idempotency key for one outbound
// purchase attempt.
type BindClaim struct {
	// Fresh is true when this caller owns the key and MUST make the provider
	// call. When false, the call already happened and ProviderTransactionRef
	// describes it.
	Fresh bool
	// ProviderTransactionRef is set when a previous attempt with this key reached
	// the provider and was ACCEPTED (VTpass answered SUCCESS or PENDING). Replay
	// this instead of purchasing again.
	ProviderTransactionRef string
	State                  string
	Attempts               int
}

// Sentinel errors for the ambiguous states a caller must not paper over.
var (
	// ErrBindInFlight means another attempt with this key is mid-call. Retrying
	// now could double-purchase.
	ErrBindInFlight = errors.New("utilitybills: a purchase with this idempotency key is already in flight")

	// ErrBindOutcomeUnknown means a previous attempt with this key was SENT to the
	// provider and its outcome was never learned. A purchase may or may not exist
	// upstream. Neither retrying nor giving up is safe without asking the provider,
	// so this must be reconciled, not retried.
	ErrBindOutcomeUnknown = errors.New(
		"utilitybills: a previous purchase with this idempotency key was sent but its outcome is unknown — reconcile against the provider before retrying")
)

// BindRegistry guards outbound provider purchases with a claim register.
type BindRegistry struct {
	db *pgxpool.Pool
}

// NewBindRegistry constructs the registry over the pgx pool.
func NewBindRegistry(db *pgxpool.Pool) *BindRegistry { return &BindRegistry{db: db} }

// Claim attempts to take ownership of an idempotency key for one outbound
// purchase attempt.
//
//   - Nobody has used the key      → Fresh=true; the caller MUST make the call.
//   - A previous attempt succeeded → Fresh=false with the provider ref; replay it.
//   - A previous attempt failed    → Fresh=true; the provider rejected it and
//     bought nothing, so a retry is safe.
//   - An attempt is in flight      → ErrBindInFlight.
//   - An outcome is unknown        → ErrBindOutcomeUnknown.
//
// FAILS CLOSED. If the registry itself is unusable, Claim returns an error and the
// purchase does NOT proceed: without it a retry storm buys duplicate bills with
// real money. A refused purchase is recoverable; a duplicate one is not.
func (r *BindRegistry) Claim(ctx context.Context, key, providerName, billerCode, productCode, transactionID string) (BindClaim, error) {
	if r == nil || r.db == nil {
		return BindClaim{}, fmt.Errorf("utilitybills: bind registry unavailable — refusing to purchase without idempotency protection")
	}
	if key == "" {
		return BindClaim{}, fmt.Errorf("utilitybills: Idempotency-Key required for a provider purchase")
	}

	// Nullable columns: an empty string is stored as NULL rather than '' so the
	// admin/reconciliation queries can tell "not applicable" from "blank".
	var txID any
	if transactionID != "" {
		txID = transactionID
	}

	// The INSERT is the claim. ON CONFLICT DO NOTHING means exactly one caller
	// wins; everybody else falls through to the read below.
	var claimed bool
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.utility_provider_bind
			(idempotency_key, provider_name, biller_code, product_code, transaction_id, state)
		VALUES ($1, $2, $3, $4, $5, 'in_flight')
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING true`, key, providerName, billerCode, productCode, txID).Scan(&claimed)
	switch {
	case err == nil && claimed:
		return BindClaim{Fresh: true, State: BindStateInFlight, Attempts: 1}, nil
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return BindClaim{}, fmt.Errorf("utilitybills: claim idempotency key: %w", err)
	}

	// The key already exists — read what happened to it.
	var (
		state string
		ref   *string
		att   int
	)
	if err := r.db.QueryRow(ctx, `
		SELECT state, provider_transaction_ref, attempts
		FROM public.utility_provider_bind WHERE idempotency_key = $1`, key).Scan(&state, &ref, &att); err != nil {
		return BindClaim{}, fmt.Errorf("utilitybills: read idempotency key: %w", err)
	}

	switch state {
	case BindStateSucceeded:
		out := BindClaim{Fresh: false, State: state, Attempts: att}
		if ref != nil {
			out.ProviderTransactionRef = *ref
		}
		return out, nil

	case BindStateFailed:
		// The provider rejected the previous attempt outright, so nothing was bought
		// and re-running is safe. Re-arm the key for this attempt.
		if _, err := r.db.Exec(ctx, `
			UPDATE public.utility_provider_bind
			SET state = 'in_flight', attempts = attempts + 1, failure_text = NULL, updated_at = now()
			WHERE idempotency_key = $1 AND state = 'failed'`, key); err != nil {
			return BindClaim{}, fmt.Errorf("utilitybills: re-arm idempotency key: %w", err)
		}
		return BindClaim{Fresh: true, State: BindStateInFlight, Attempts: att + 1}, nil

	case BindStateUnknown:
		return BindClaim{State: state, Attempts: att}, fmt.Errorf("%w (key %s)", ErrBindOutcomeUnknown, key)

	default: // in_flight
		return BindClaim{State: state, Attempts: att}, ErrBindInFlight
	}
}

// Succeeded records a purchase the provider ACCEPTED. The stored reference is
// what a later replay of the same key returns instead of purchasing again.
//
// Note this is also called for a PENDING outcome, deliberately. "Pending" means
// VTpass took the request and is processing it — the money-relevant fact is that
// the request LANDED, and a replay must not send it a second time. Whether it
// ultimately settles or fails is a question for requery, not for the idempotency
// register.
func (r *BindRegistry) Succeeded(ctx context.Context, key, providerTransactionRef string) {
	if r == nil || r.db == nil {
		return
	}
	if _, err := r.db.Exec(ctx, `
		UPDATE public.utility_provider_bind
		SET state = 'succeeded', provider_transaction_ref = $2, failure_text = NULL, updated_at = now()
		WHERE idempotency_key = $1`, key, providerTransactionRef); err != nil {
		// The purchase DID happen; only our note about it failed. Reconciliation
		// against the provider is the backstop.
		log.Printf("[utilitybills] WARN could not record bind success for key %s (provider ref %s): %v",
			key, providerTransactionRef, err)
	}
}

// Failed records a provider REJECTION — a definite negative, where nothing was
// bought and a retry (including a failover to the NEXT provider) is safe. Use it
// only when the provider answered; if the call merely errored in transit, use
// Unknown.
func (r *BindRegistry) Failed(ctx context.Context, key, reason string) {
	if r == nil || r.db == nil {
		return
	}
	if _, err := r.db.Exec(ctx, `
		UPDATE public.utility_provider_bind
		SET state = 'failed', failure_text = $2, updated_at = now()
		WHERE idempotency_key = $1`, key, reason); err != nil {
		log.Printf("[utilitybills] WARN could not record bind failure for key %s: %v", key, err)
	}
}

// Unknown records that a purchase was SENT but its outcome was never learned.
//
// This is the state that must not be guessed. The key stays locked: a later
// attempt gets ErrBindOutcomeUnknown rather than a silent second purchase, and
// the row shows up in UnresolvedCount until Phase 3's requery job (or a human)
// checks the provider and resolves it.
func (r *BindRegistry) Unknown(ctx context.Context, key, reason string) {
	if r == nil || r.db == nil {
		return
	}
	if _, err := r.db.Exec(ctx, `
		UPDATE public.utility_provider_bind
		SET state = 'unknown', failure_text = $2, updated_at = now()
		WHERE idempotency_key = $1`, key, reason); err != nil {
		log.Printf("[utilitybills] WARN could not record unknown bind outcome for key %s: %v", key, err)
	}
	log.Printf("[utilitybills] ⚠️ bind outcome UNKNOWN for key %s — a bill purchase may or may not exist at the provider; reconcile before retrying", key)
}

// UnresolvedCount reports how many outbound purchases have an unknown outcome.
// Each one is a member who may have been debited for a bill we cannot confirm, or
// who holds a bill we never recorded.
func (r *BindRegistry) UnresolvedCount(ctx context.Context) (int, error) {
	if r == nil || r.db == nil {
		return 0, fmt.Errorf("utilitybills: bind registry unavailable")
	}
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT count(*) FROM public.utility_provider_bind WHERE state = 'unknown'`).Scan(&n)
	return n, err
}
