package webhooks

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists the provider-event idempotency ledger and applies
// provider-driven POLICY state changes (claim state changes are delegated to the
// claims service). All queries are parameterized; raw provider JSON is never
// written (only the external_event_id + normalised type + refs).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the webhooks repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// RecordEvent inserts the (provider, external_event_id) idempotency row. It
// returns inserted=false when the event was already seen (duplicate webhook), so
// the caller can drop it. UNIQUE(provider, external_event_id) is the hard guard.
func (r *Repository) RecordEvent(ctx context.Context, provider, externalEventID, eventType string) (inserted bool, err error) {
	// Guard the RECEIVER, not just the pool: this is reached from an
	// UNAUTHENTICATED endpoint, so a nil repository must return an error the
	// handler can turn into a 4xx/5xx, never a panic that takes the process with
	// it. `r.db` alone dereferences nil.
	if r == nil || r.db == nil {
		return false, errors.New("webhooks: repository not configured")
	}
	ct, err := r.db.Exec(ctx, `
		INSERT INTO public.insurance_provider_event (provider, external_event_id, event_type)
		VALUES ($1,$2,$3)
		ON CONFLICT (provider, external_event_id) DO NOTHING`,
		provider, externalEventID, eventType)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// PolicyByProviderRef returns (policyID, state, version, found) for a policy by
// its (provider, provider_policy_ref).
func (r *Repository) PolicyByProviderRef(ctx context.Context, provider, ref string) (id, state string, version int, found bool, err error) {
	if r == nil || r.db == nil {
		return "", "", 0, false, errors.New("webhooks: repository not configured")
	}
	err = r.db.QueryRow(ctx, `
		SELECT id, state, version FROM public.insurance_policy
		WHERE provider = $1 AND provider_policy_ref = $2 LIMIT 1`, provider, ref).Scan(&id, &state, &version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", 0, false, nil
		}
		return "", "", 0, false, err
	}
	return id, state, version, true, nil
}

// SetPolicyState applies a provider-driven policy state change (version-guarded).
// Used for policy.bound/cancelled/lapsed/expired. Returns false when the guard
// (version) did not match (a concurrent update won — safe to ignore).
func (r *Repository) SetPolicyState(ctx context.Context, id, toState string, expectVersion int) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("webhooks: repository not configured")
	}
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_policy
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $3`, id, toState, expectVersion)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}
