package policy

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ════════════════════════════════════════════════════════════════════════════
// OUTBOUND BIND IDEMPOTENCY
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover documents NO idempotency mechanism on POST /products/buy. A retried
// purchase creates a SECOND policy and debits Paymax's prefunded float twice.
// Paymax's iron rule requires an Idempotency-Key on every money mutation, so the
// guarantee has to be built here rather than assumed of the provider.
//
// The mechanism is the primary key on insurance_provider_bind: claiming a key is
// an INSERT, so a concurrent or replayed attempt with the same key cannot claim
// it and therefore cannot reach the provider. No locks, no windows, no reliance
// on anything the provider does.
//
// The hard case is a TRANSPORT failure. When a purchase call times out or the
// connection drops, the request may or may not have been processed — the error
// genuinely does not say. That outcome is recorded as `unknown` and is NEVER
// auto-retried: retrying might buy a second policy, and giving up might strand a
// member who has been debited. It needs a human or a reconciliation pass against
// the provider's own policy list. (This repo has been bitten before by treating
// an ambiguous provider error as a definite one — see the ledger debit retry
// hazard.)

// BindClaim is the outcome of claiming an idempotency key for an outbound
// purchase.
type BindClaim struct {
	// Fresh is true when this caller owns the key and MUST make the provider
	// call. When false, the call has already been made and Existing describes it.
	Fresh bool
	// ProviderPolicyRef is set when a previous attempt with this key SUCCEEDED.
	// Replay this instead of buying again.
	ProviderPolicyRef string
	State             string
	Attempts          int
}

// Sentinel errors for the ambiguous states a caller must not paper over.
var (
	// ErrBindInFlight means another attempt with this key is mid-call. Retrying
	// now could double-purchase.
	ErrBindInFlight = errors.New("policy: a purchase with this idempotency key is already in flight")

	// ErrBindOutcomeUnknown means a previous attempt with this key was SENT to
	// the provider and its outcome was never learned. A policy may or may not
	// exist. Neither retrying nor giving up is safe without checking the
	// provider, so this must be reconciled, not retried.
	ErrBindOutcomeUnknown = errors.New(
		"policy: a previous purchase with this idempotency key was sent but its outcome is unknown — reconcile against the provider before retrying")
)

// BindRegistry guards outbound provider purchases with a claim register.
type BindRegistry struct {
	db *pgxpool.Pool
}

// NewBindRegistry constructs the registry over the pgx pool.
func NewBindRegistry(db *pgxpool.Pool) *BindRegistry { return &BindRegistry{db: db} }

// Claim attempts to take ownership of an idempotency key for one outbound
// purchase.
//
//   - Nobody has used the key      → Fresh=true; the caller MUST make the call.
//   - A previous attempt succeeded → Fresh=false with the policy ref; replay it.
//   - A previous attempt failed    → Fresh=true; the provider rejected it and
//     created nothing, so a retry is safe.
//   - An attempt is in flight      → ErrBindInFlight.
//   - An outcome is unknown        → ErrBindOutcomeUnknown.
//
// FAILS CLOSED. If the registry itself is unusable, Claim returns an error and
// the purchase does NOT proceed — unlike the float breaker, this one must not
// fail open, because without it a retry storm buys duplicate policies with real
// money. A refused purchase is recoverable; a duplicate one is not.
func (r *BindRegistry) Claim(ctx context.Context, key, provider, productCode, policyID string) (BindClaim, error) {
	if r == nil || r.db == nil {
		return BindClaim{}, fmt.Errorf("policy: bind registry unavailable — refusing to purchase without idempotency protection")
	}
	if key == "" {
		return BindClaim{}, fmt.Errorf("policy: Idempotency-Key required for a provider purchase")
	}

	var pid any
	if policyID != "" {
		pid = policyID
	}

	// The INSERT is the claim. ON CONFLICT DO NOTHING means exactly one caller
	// wins; everybody else falls through to the read below.
	var claimed bool
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_provider_bind
			(idempotency_key, provider, product_code, policy_id, state)
		VALUES ($1, $2, $3, $4, 'in_flight')
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING true`, key, provider, productCode, pid).Scan(&claimed)
	switch {
	case err == nil && claimed:
		return BindClaim{Fresh: true, State: "in_flight", Attempts: 1}, nil
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return BindClaim{}, fmt.Errorf("policy: claim idempotency key: %w", err)
	}

	// The key already exists — read what happened to it.
	var (
		state string
		ref   *string
		att   int
	)
	if err := r.db.QueryRow(ctx, `
		SELECT state, provider_policy_ref, attempts
		FROM public.insurance_provider_bind WHERE idempotency_key = $1`, key).Scan(&state, &ref, &att); err != nil {
		return BindClaim{}, fmt.Errorf("policy: read idempotency key: %w", err)
	}

	switch state {
	case "succeeded":
		out := BindClaim{Fresh: false, State: state, Attempts: att}
		if ref != nil {
			out.ProviderPolicyRef = *ref
		}
		return out, nil

	case "failed":
		// The provider rejected the previous attempt outright, so nothing was
		// created and re-running is safe. Re-arm the key for this attempt.
		if _, err := r.db.Exec(ctx, `
			UPDATE public.insurance_provider_bind
			SET state = 'in_flight', attempts = attempts + 1, failure_text = NULL, updated_at = now()
			WHERE idempotency_key = $1 AND state = 'failed'`, key); err != nil {
			return BindClaim{}, fmt.Errorf("policy: re-arm idempotency key: %w", err)
		}
		return BindClaim{Fresh: true, State: "in_flight", Attempts: att + 1}, nil

	case "unknown":
		return BindClaim{State: state, Attempts: att}, fmt.Errorf("%w (key %s)", ErrBindOutcomeUnknown, key)

	default: // in_flight
		return BindClaim{State: state, Attempts: att}, ErrBindInFlight
	}
}

// Succeeded records a confirmed provider purchase. The stored reference is what
// a later replay of the same key returns instead of buying again.
func (r *BindRegistry) Succeeded(ctx context.Context, key, providerPolicyRef string, premiumKobo int64) {
	if r == nil || r.db == nil {
		return
	}
	if _, err := r.db.Exec(ctx, `
		UPDATE public.insurance_provider_bind
		SET state = 'succeeded', provider_policy_ref = $2, premium_kobo = $3,
		    failure_text = NULL, updated_at = now()
		WHERE idempotency_key = $1`, key, providerPolicyRef, premiumKobo); err != nil {
		// The purchase DID happen; only our note about it failed. Reconciliation
		// against the provider's policy list is the backstop.
		log.Printf("[insurance] WARN could not record bind success for key %s (policy %s): %v",
			key, providerPolicyRef, err)
	}
}

// Failed records a provider REJECTION — a definite negative, where nothing was
// created and a retry is safe. Use it only when the provider answered; if the
// call merely errored in transit, use Unknown.
func (r *BindRegistry) Failed(ctx context.Context, key, reason string) {
	if r == nil || r.db == nil {
		return
	}
	if _, err := r.db.Exec(ctx, `
		UPDATE public.insurance_provider_bind
		SET state = 'failed', failure_text = $2, updated_at = now()
		WHERE idempotency_key = $1`, key, reason); err != nil {
		log.Printf("[insurance] WARN could not record bind failure for key %s: %v", key, err)
	}
}

// Unknown records that a purchase was SENT but its outcome was never learned.
//
// This is the state that must not be guessed. The key stays locked: a later
// attempt gets ErrBindOutcomeUnknown rather than a silent second purchase, and
// the row shows up in the reconciliation query until a human or a reconciler
// checks the provider's policy list and resolves it.
func (r *BindRegistry) Unknown(ctx context.Context, key, reason string) {
	if r == nil || r.db == nil {
		return
	}
	if _, err := r.db.Exec(ctx, `
		UPDATE public.insurance_provider_bind
		SET state = 'unknown', failure_text = $2, updated_at = now()
		WHERE idempotency_key = $1`, key, reason); err != nil {
		log.Printf("[insurance] WARN could not record unknown bind outcome for key %s: %v", key, err)
	}
	log.Printf("[insurance] ⚠️ bind outcome UNKNOWN for key %s — a policy may or may not exist at the provider; reconcile before retrying", key)
}

// UnresolvedCount reports how many outbound purchases have an unknown outcome.
// Admin surfaces it: each one is a member who may be paying for cover we cannot
// see, or holding cover we did not record.
func (r *BindRegistry) UnresolvedCount(ctx context.Context) (int, error) {
	if r == nil || r.db == nil {
		return 0, fmt.Errorf("policy: bind registry unavailable")
	}
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT count(*) FROM public.insurance_provider_bind WHERE state = 'unknown'`).Scan(&n)
	return n, err
}
