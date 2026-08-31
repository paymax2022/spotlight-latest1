package catalog

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ════════════════════════════════════════════════════════════════════════════
// PROVIDER FLOAT BREAKER
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover settles binds against a PREFUNDED DISTRIBUTOR WALLET, not a
// per-transaction charge. Every purchase debits a float Paymax holds with them,
// and when that float empties EVERY bind fails at once.
//
// The bind saga debits the member's premium BEFORE calling the provider (and
// auto-reverses on failure). That is correct for an isolated failure. It is the
// wrong shape for a cliff: with an empty float, every member in the queue would
// be debited and reversed in turn. One reversal is a working saga; a thousand is
// an incident, and every one of them is a member who saw money leave their
// wallet.
//
// So the FIRST bind that hits an empty float trips this breaker, and every
// subsequent bind is refused BEFORE any money moves. An operator tops up the
// MyCover wallet and resets it.
//
// What this is NOT: a balance, an account, or anything ledger-like. No money is
// represented here and nothing is posted against it. We cannot read the real
// balance at all — /wallet/balance is 403 for our key — so this records only
// what we OBSERVED the provider do, never a figure we invented.

// ErrProviderFloatExhausted is returned by Guard when binds are currently
// refused because the provider's prefunded wallet was observed to be empty.
var ErrProviderFloatExhausted = errors.New(
	"insurance: the provider's prefunded wallet is empty — binding is paused so no member is charged for cover that cannot be issued")

// FloatState is the recorded state of one aggregator's prefunded float.
type FloatState struct {
	Provider            string     `json:"provider"`
	State               string     `json:"state"` // ok | exhausted | unknown
	ConsecutiveFailures int        `json:"consecutive_failures"`
	LastFailureAt       *time.Time `json:"last_failure_at,omitempty"`
	LastSuccessAt       *time.Time `json:"last_success_at,omitempty"`
	LastFailureText     string     `json:"last_failure_text,omitempty"`
	LastTopupNote       string     `json:"last_topup_note,omitempty"`
	LastResetAt         *time.Time `json:"last_reset_at,omitempty"`
	UpdatedAt           time.Time  `json:"updated_at"`
	// BindingPaused is the single field a caller needs: true means do not take
	// the member's money.
	BindingPaused bool `json:"binding_paused"`
}

// FloatService records and reports provider float state.
type FloatService struct {
	db *pgxpool.Pool
}

// NewFloatService constructs the float breaker over the pgx pool.
func NewFloatService(db *pgxpool.Pool) *FloatService { return &FloatService{db: db} }

// Guard is called BEFORE the member's premium is debited. It returns
// ErrProviderFloatExhausted when the breaker is tripped.
//
// FAIL OPEN, deliberately. If the breaker itself cannot be read (DB blip), the
// bind proceeds: the saga's auto-reverse still protects the member, and refusing
// every purchase because a status table was unreadable would be a worse outage
// than the one being guarded against. The breaker is a stampede brake, not the
// safety mechanism — the auto-reverse is.
func (s *FloatService) Guard(ctx context.Context, provider string) error {
	if s == nil || s.db == nil {
		return nil
	}
	var state string
	err := s.db.QueryRow(ctx, `
		SELECT state FROM public.insurance_provider_float WHERE provider = $1`, provider).Scan(&state)
	if err != nil {
		return nil // fail open — see doc comment
	}
	if state == "exhausted" {
		return fmt.Errorf("%w (provider %s)", ErrProviderFloatExhausted, provider)
	}
	return nil
}

// RecordFloatExhausted trips the breaker after the provider refused a purchase
// for want of float. providerText is the provider's verbatim message; it carries
// no member PII and no credentials.
func (s *FloatService) RecordFloatExhausted(ctx context.Context, provider, providerText string) {
	if s == nil || s.db == nil {
		return
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO public.insurance_provider_float
			(provider, state, consecutive_failures, last_failure_at, last_failure_text, updated_at)
		VALUES ($1, 'exhausted', 1, now(), $2, now())
		ON CONFLICT (provider) DO UPDATE SET
			state = 'exhausted',
			consecutive_failures = public.insurance_provider_float.consecutive_failures + 1,
			last_failure_at = now(),
			last_failure_text = EXCLUDED.last_failure_text,
			updated_at = now()`, provider, providerText)
	if err != nil {
		log.Printf("[insurance] WARN could not record float exhaustion for %s: %v", provider, err)
		return
	}
	// Loud on purpose: this is a treasury outage, not a member error.
	log.Printf("[insurance] ⛔ %s prefunded wallet is EMPTY — binding PAUSED. Top up the %s dashboard and reset the breaker.",
		provider, provider)
}

// RecordBindSucceeded clears the breaker after a bind actually went through —
// proof the float has money in it. This is the only automatic path back to "ok",
// and it is evidence-based rather than time-based.
func (s *FloatService) RecordBindSucceeded(ctx context.Context, provider string) {
	if s == nil || s.db == nil {
		return
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO public.insurance_provider_float
			(provider, state, consecutive_failures, last_success_at, updated_at)
		VALUES ($1, 'ok', 0, now(), now())
		ON CONFLICT (provider) DO UPDATE SET
			state = 'ok',
			consecutive_failures = 0,
			last_success_at = now(),
			updated_at = now()`, provider)
	if err != nil {
		log.Printf("[insurance] WARN could not clear float state for %s: %v", provider, err)
	}
}

// Reset re-arms binding after an operator has topped the provider wallet up.
// note records what they say they funded — a human record, NOT an authority: the
// real balance lives at the provider and we cannot read it.
func (s *FloatService) Reset(ctx context.Context, provider, note, byUserID string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("insurance: nil pool")
	}
	var by any
	if byUserID != "" {
		by = byUserID
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO public.insurance_provider_float
			(provider, state, consecutive_failures, last_topup_note, last_reset_at, last_reset_by, updated_at)
		VALUES ($1, 'ok', 0, NULLIF($2,''), now(), $3, now())
		ON CONFLICT (provider) DO UPDATE SET
			state = 'ok',
			consecutive_failures = 0,
			last_topup_note = NULLIF(EXCLUDED.last_topup_note, ''),
			last_reset_at = now(),
			last_reset_by = EXCLUDED.last_reset_by,
			updated_at = now()`, provider, note, by)
	return err
}

// List returns every recorded float state, for the admin providers screen and
// the low-float alarm.
func (s *FloatService) List(ctx context.Context) ([]FloatState, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("insurance: nil pool")
	}
	rows, err := s.db.Query(ctx, `
		SELECT provider, state, consecutive_failures, last_failure_at, last_success_at,
		       COALESCE(last_failure_text,''), COALESCE(last_topup_note,''), last_reset_at, updated_at
		FROM public.insurance_provider_float
		ORDER BY provider`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FloatState
	for rows.Next() {
		var f FloatState
		if err := rows.Scan(&f.Provider, &f.State, &f.ConsecutiveFailures,
			&f.LastFailureAt, &f.LastSuccessAt, &f.LastFailureText,
			&f.LastTopupNote, &f.LastResetAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		f.BindingPaused = f.State == "exhausted"
		out = append(out, f)
	}
	return out, rows.Err()
}
