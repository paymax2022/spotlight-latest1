package policy

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/catalog"
	"spotlight/backend/internal/insurance/consent"
	"spotlight/backend/internal/insurance/gateway"
)

// Notifier emits user-facing notifications (bind success / auto-refund). Kept as
// a tiny interface so the policy service does not import the notifications pkg.
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// Auditor appends an immutable audit event. Tiny interface for the same reason.
type Auditor interface {
	Audit(ctx context.Context, userID, action string, detail map[string]any)
}

// Service owns the policy lifecycle, the thin quote engine, and the premium-bind
// saga. It REUSES the finance ledger/wallet (no new money primitives) and the
// gateway Router (provider-agnostic). It performs object-level authZ.
type Service struct {
	repo    *Repository
	router  *gateway.Router
	catalog *catalog.Service
	consent *consent.Service
	wallet  *wallet.Service
	ledger  *ledger.Service
	notify  Notifier
	audit   Auditor

	// quoteTTL caps how long a cached/issued quote is valid.
	quoteTTL time.Duration
	// float is the provider prefunded-wallet breaker. Optional (nil-safe).
	float *catalog.FloatService
	// binds is the OUTBOUND idempotency register. MyCover offers no idempotency
	// of its own, so this is what stops a retry buying a second policy.
	binds *BindRegistry
}

// Deps bundles the service dependencies.
type Deps struct {
	Repo     *Repository
	Router   *gateway.Router
	Catalog  *catalog.Service
	Consent  *consent.Service
	Wallet   *wallet.Service
	Ledger   *ledger.Service
	Notifier Notifier
	Auditor  Auditor
	QuoteTTL time.Duration
	// Float is the provider prefunded-wallet breaker. Optional: when nil the
	// saga still auto-reverses, it just loses the stampede brake.
	Float *catalog.FloatService
	// Binds is the outbound purchase idempotency register. Unlike Float this is
	// NOT optional in effect: without it a retried bind can double-purchase, so
	// the saga refuses to call the provider when it is absent.
	Binds *BindRegistry
}

// NewService constructs the policy service.
func NewService(d Deps) *Service {
	ttl := d.QuoteTTL
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	return &Service{
		repo:     d.Repo,
		router:   d.Router,
		catalog:  d.Catalog,
		consent:  d.Consent,
		wallet:   d.Wallet,
		ledger:   d.Ledger,
		notify:   d.Notifier,
		audit:    d.Auditor,
		quoteTTL: ttl,
		float:    d.Float,
		binds:    d.Binds,
	}
}

// Sentinel errors surfaced to handlers (mapped to HTTP codes there).
var (
	ErrForbidden       = errors.New("policy: caller does not own this policy")
	ErrConsentRequired = consent.ErrConsentRequired
	ErrBadState        = errors.New("policy: illegal state transition")
)

// QuoteResult is the cached quote returned to the client. The underwriter +
// aggregator are surfaced from the provider, never hard-coded.
type QuoteResult struct {
	QuoteID          string         `json:"id"`
	ProductCode      string         `json:"product_code"`
	Provider         string         `json:"provider"`
	Underwriter      string         `json:"underwriter"`
	PremiumKobo      int64          `json:"premium_kobo"`
	SumInsuredKobo   int64          `json:"sum_insured_kobo"`
	Currency         string         `json:"currency"`
	CommissionKobo   int64          `json:"commission_kobo"`
	ProviderQuoteRef string         `json:"provider_quote_ref"`
	ExpiresAt        time.Time      `json:"expires_at"`
	Terms            map[string]any `json:"terms,omitempty"`
	// Inputs are the product-specific answers captured at quote time. They are
	// replayed verbatim on bind because per-product provider purchase endpoints
	// validate the full field set. They contain member PII and are NEVER
	// serialised to the client — the json tag is "-" deliberately.
	Inputs map[string]any `json:"-"`
}

// CreateQuote is the thin quote engine: route → provider quote → normalise →
// persist with TTL. NDPA consent is REQUIRED before the provider data-share.
func (s *Service) CreateQuote(ctx context.Context, userID, productCode string, sumInsuredKobo int64, inputs map[string]any) (*QuoteResult, error) {
	// NDPA gate — quoting sends user inputs to the provider (PII share).
	ok, err := s.consent.HasCurrent(ctx, userID, productCode, "provider_data_share")
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrConsentRequired
	}

	prod, err := s.catalog.Get(ctx, productCode)
	if err != nil {
		return nil, err
	}
	gw, providerProduct, err := s.router.Resolve(ctx, productCode)
	if err != nil {
		return nil, err
	}

	currency := "NGN"
	q, err := gw.GetQuote(ctx, gateway.QuoteRequest{
		ProviderProductCode: providerProduct.Code,
		Product:             providerProduct,
		Currency:            currency,
		SumInsuredKobo:      sumInsuredKobo,
		Inputs:              inputs,
	})
	if err != nil {
		return nil, fmt.Errorf("policy: quote: %w", err)
	}

	expires := q.ExpiresAt
	if expires.IsZero() {
		expires = time.Now().Add(s.quoteTTL)
	}
	underwriter := q.Underwriter
	if underwriter == "" {
		underwriter = prod.UnderwriterDisplay // provider-sourced display fallback
	}

	quoteID, err := s.repo.insertQuote(ctx, userID, productCode, prod.Provider, q, inputs, expires)
	if err != nil {
		return nil, err
	}

	return &QuoteResult{
		QuoteID:          quoteID,
		ProductCode:      productCode,
		Provider:         prod.Provider,
		Underwriter:      underwriter,
		PremiumKobo:      q.PremiumKobo,
		SumInsuredKobo:   q.SumInsuredKobo,
		Currency:         q.Currency,
		CommissionKobo:   q.CommissionKobo,
		ProviderQuoteRef: q.ProviderQuoteRef,
		ExpiresAt:        expires,
		Terms:            q.Terms,
	}, nil
}

// GetQuote returns a cached quote owned by the user.
func (s *Service) GetQuote(ctx context.Context, userID, quoteID string) (*QuoteResult, error) {
	qr, ownerID, err := s.repo.getQuote(ctx, quoteID)
	if err != nil {
		return nil, err
	}
	if ownerID != userID {
		return nil, ErrForbidden
	}
	return qr, nil
}

// BindFromQuote runs the premium-debit→bind SAGA with MANDATORY auto-reverse.
//
//  1. Create policy QUOTED → PENDING_PAYMENT.
//  2. NDPA consent gate (provider data-share happens at bind).
//  3. Idempotent wallet.Debit(premium) → credits AccountProviderClearing
//     (premium is a PASS-THROUGH liability, never revenue). Record premium tx.
//     PENDING_PAYMENT → BINDING.
//  4. gateway.BindPolicy(idempotency_key) — idempotent at the provider.
//     - On SUCCESS: BINDING → ACTIVE; write commission ledger entry to the
//     SEPARATE AccountCommission (the only revenue); store cert ref; audit;
//     notify.
//     - On FAILURE: BINDING → BIND_FAILED, then AUTO-REVERSE the premium
//     (reversing CREDIT back to the user wallet) → VOID. The user is NEVER left
//     debited without cover. This auto-reverse is the #1 invariant.
//
// idempotencyKey is the caller-supplied Idempotency-Key (REQUIRED on bind); the
// same key is reused for the wallet debit and forwarded to the provider so the
// whole saga is replay-safe.
func (s *Service) BindFromQuote(ctx context.Context, userID, quoteID, idempotencyKey string) (*Policy, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("policy: Idempotency-Key required for bind")
	}
	qr, ownerID, err := s.repo.getQuote(ctx, quoteID)
	if err != nil {
		return nil, err
	}
	if ownerID != userID {
		return nil, ErrForbidden
	}

	// NDPA gate — bind shares PII with the provider.
	consented, err := s.consent.HasCurrent(ctx, userID, qr.ProductCode, "provider_data_share")
	if err != nil {
		return nil, err
	}
	if !consented {
		return nil, ErrConsentRequired
	}

	// (1) Create the policy in QUOTED and advance to PENDING_PAYMENT.
	p, err := s.repo.Create(ctx, &Policy{
		PolicyholderID: userID,
		ProductCode:    qr.ProductCode,
		Provider:       qr.Provider,
		Underwriter:    qr.Underwriter,
		BindingMode:    string(gateway.BindingModeDirect),
		State:          StateQuoted,
		SumInsuredKobo: qr.SumInsuredKobo,
		PremiumKobo:    qr.PremiumKobo,
		Currency:       qr.Currency,
	})
	if err != nil {
		return nil, err
	}
	if err := s.transition(ctx, p, StatePendingPayment); err != nil {
		return nil, err
	}

	// (2b) PROVIDER FLOAT BREAKER — checked BEFORE any money moves.
	//
	// MyCover settles binds against a PREFUNDED distributor wallet, not a
	// per-transaction charge. When that float empties, every bind fails at once.
	// The auto-reverse below would still make each individual member whole, but
	// debiting and reversing every member in the queue is an incident, not a
	// recovery — each one watches money leave their wallet for cover that was
	// never going to be issued.
	//
	// So once the provider has told us the float is empty, refuse here, before
	// the debit, until an operator tops it up. No money moves and the member gets
	// a truthful "temporarily unavailable" instead of a debit-and-refund.
	if s.float != nil {
		if fErr := s.float.Guard(ctx, qr.Provider); fErr != nil {
			_ = s.transition(ctx, p, StatePaymentFailed)
			_ = s.transition(ctx, p, StateVoid)
			s.auditSafe(ctx, userID, "insurance.bind_blocked_provider_float", map[string]any{
				"policy_id": p.ID, "provider": qr.Provider,
			})
			return p, fErr
		}
	}

	// (3) Idempotent premium debit → AccountProviderClearing (pass-through).
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}
	premiumRef := "insurance:premium:" + p.ID
	debitErr := s.wallet.Debit(ctx, userID, premiumRef, idempotencyKey+":premium", clearing.ID, p.PremiumKobo)
	if debitErr != nil && !errors.Is(debitErr, ledger.ErrDuplicate) {
		// Premium could not be taken — PAYMENT_FAILED → VOID. No bind attempted,
		// nothing to reverse.
		_ = s.transition(ctx, p, StatePaymentFailed)
		_ = s.transition(ctx, p, StateVoid)
		s.auditSafe(ctx, userID, "insurance.payment_failed", map[string]any{"policy_id": p.ID, "err": debitErr.Error()})
		return p, fmt.Errorf("policy: premium debit failed: %w", debitErr)
	}
	_ = s.repo.InsertPremiumTx(ctx, PremiumTx{
		PolicyID:        p.ID,
		WalletLedgerRef: premiumRef,
		IdempotencyKey:  idempotencyKey + ":premium",
		AmountKobo:      p.PremiumKobo,
		Direction:       "DEBIT",
		Status:          "posted",
	})
	if err := s.transition(ctx, p, StateBinding); err != nil {
		return nil, err
	}

	// (4) Bind at the provider (idempotent on idempotencyKey).
	gw, providerProduct, err := s.router.Resolve(ctx, qr.ProductCode)
	if err != nil {
		return s.autoReverse(ctx, p, idempotencyKey, premiumRef, clearing.ID, err)
	}
	// ── OUTBOUND IDEMPOTENCY ──────────────────────────────────────────────
	// MyCover documents no idempotency mechanism on its purchase endpoint, so a
	// retry would create a SECOND policy and debit our float twice. Claim the key
	// before the call: the claim is an INSERT on a unique key, so a replay or a
	// concurrent attempt cannot reach the provider at all.
	//
	// This fails CLOSED. A refused purchase is recoverable; a duplicate one is
	// not, so the saga will not call the provider without the guard in place.
	claim, claimErr := s.binds.Claim(ctx, idempotencyKey, qr.Provider, qr.ProductCode, p.ID)
	if claimErr != nil {
		return s.autoReverse(ctx, p, idempotencyKey, premiumRef, clearing.ID, claimErr)
	}
	if !claim.Fresh {
		// This exact purchase already went through. Return the SAME policy rather
		// than buying a second one — that is what idempotency means here.
		log.Printf("[insurance] bind replay for key %s — returning the existing provider policy %s",
			idempotencyKey, claim.ProviderPolicyRef)
		if err := s.repo.SetBound(ctx, p.ID, claim.ProviderPolicyRef, qr.Underwriter, qr.CommissionKobo, nil, nil, nil, p.Version); err != nil {
			return nil, fmt.Errorf("policy: bind replay persist: %w", err)
		}
		return s.repo.Get(ctx, p.ID)
	}

	bound, bindErr := gw.BindPolicy(ctx, gateway.BindRequest{
		ProviderProductCode: providerProduct.Code,
		Product:             providerProduct,
		ProviderQuoteRef:    qr.ProviderQuoteRef,
		Currency:            qr.Currency,
		SumInsuredKobo:      qr.SumInsuredKobo,
		PremiumKobo:         qr.PremiumKobo,
		PolicyholderRef:     "ph:" + p.ID, // opaque ref, NOT the auth user id
		IdempotencyKey:      idempotencyKey,
		// Replay the quote-time answers: per-product provider purchase endpoints
		// validate the FULL field set, so a bind with no inputs is rejected.
		Inputs: qr.Inputs,
	})
	if bindErr != nil {
		// Release or lock the idempotency key according to WHAT WE KNOW.
		//
		// A provider REJECTION (validation, empty float) is a definite negative:
		// nothing was created, so the key is released and a retry is safe. A
		// TRANSPORT error is not — the request may or may not have been
		// processed, and the error does not say. That outcome is recorded as
		// unknown and locked, because retrying might buy a second policy and
		// giving up might strand the member. It needs reconciliation, not a guess.
		if providerAnswered(bindErr) {
			s.binds.Failed(ctx, idempotencyKey, bindErr.Error())
		} else {
			s.binds.Unknown(ctx, idempotencyKey, bindErr.Error())
		}

		// An empty provider float is a TREASURY outage, not this member's fault.
		// Trip the breaker so the next member is refused before their money moves,
		// then auto-reverse this one — they are already debited and must be made
		// whole regardless.
		if s.float != nil && errors.Is(bindErr, gateway.ErrProviderFloatExhausted) {
			s.float.RecordFloatExhausted(ctx, qr.Provider, bindErr.Error())
			s.auditSafe(ctx, userID, "insurance.provider_float_exhausted", map[string]any{
				"policy_id": p.ID, "provider": qr.Provider,
			})
		}
		return s.autoReverse(ctx, p, idempotencyKey, premiumRef, clearing.ID, bindErr)
	}
	s.binds.Succeeded(ctx, idempotencyKey, bound.ProviderPolicyRef, bound.PremiumKobo)

	// A bind that went through is PROOF the float has money in it — the only
	// evidence-based way back to "ok".
	if s.float != nil {
		s.float.RecordBindSucceeded(ctx, qr.Provider)
	}

	// SUCCESS: record provider ref + disclosure + cert; move to ACTIVE.
	var certRef *string
	if bound.CertificateRef != "" {
		certRef = &bound.CertificateRef
	}
	var effAt, expAt *time.Time
	if !bound.EffectiveAt.IsZero() {
		t := bound.EffectiveAt
		effAt = &t
	}
	if !bound.ExpiresAt.IsZero() {
		t := bound.ExpiresAt
		expAt = &t
	}
	commission := bound.CommissionKobo
	if err := s.repo.SetBound(ctx, p.ID, bound.ProviderPolicyRef, bound.Underwriter, commission, certRef, effAt, expAt, p.Version); err != nil {
		// Persisting the bind result failed; the provider bind is idempotent so a
		// reconciliation poller will pick it up. Do NOT auto-reverse — cover exists.
		log.Printf("[insurance] WARN: bind succeeded but persist failed for policy %s: %v", p.ID, err)
		return nil, fmt.Errorf("policy: bind persisted partially: %w", err)
	}

	// Commission posting to the SEPARATE commission account (the only revenue).
	if commission > 0 {
		commAcc, cErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
		if cErr == nil {
			// Move the commission slice from provider-clearing pass-through into the
			// commission revenue account (DR provider_clearing → CR commission).
			postErr := s.ledger.PostJournal(ctx, ledger.JournalEntry{
				Reference:       "insurance:commission:" + p.ID,
				IdempotencyKey:  idempotencyKey + ":commission",
				AmountKobo:      commission,
				DebitAccountID:  clearing.ID,
				CreditAccountID: commAcc.ID,
			})
			if postErr != nil && !errors.Is(postErr, ledger.ErrDuplicate) {
				log.Printf("[insurance] WARN: commission post failed for policy %s: %v", p.ID, postErr)
			}
		}
	}

	s.auditSafe(ctx, userID, "insurance.policy_active", map[string]any{
		"policy_id":   p.ID,
		"provider":    p.Provider,
		"underwriter": bound.Underwriter,
		"premium":     p.PremiumKobo,
	})
	s.notifySafe(ctx, userID, "insurance.bound", "Your "+p.ProductCode+" cover is now active.")

	return s.repo.Get(ctx, p.ID)
}

// autoReverse executes the MANDATORY auto-reverse leg: BINDING → BIND_FAILED →
// reversing CREDIT (premium back to the user wallet) → VOID. Returns the policy
// and the original bind error wrapped.
func (s *Service) autoReverse(ctx context.Context, p *Policy, idempotencyKey, premiumRef, clearingAccID string, cause error) (*Policy, error) {
	_ = s.transition(ctx, p, StateBindFailed)

	// Reverse: restore the user wallet, drain the provider-clearing hold.
	userWallet, wErr := s.ledger.GetOrCreateUserWallet(ctx, p.PolicyholderID)
	if wErr == nil {
		revErr := s.ledger.PostReversal(ctx, userWallet.ID, clearingAccID, p.PremiumKobo,
			"insurance:premium_reversal:"+p.ID, idempotencyKey+":reversal")
		if revErr != nil && !errors.Is(revErr, ledger.ErrDuplicate) {
			// Refund failed — this is the worst case. Leave the policy in BIND_FAILED
			// (NOT VOID) so the reconciliation/refund queue retries; alert loudly.
			log.Printf("[insurance] CRITICAL: auto-reverse FAILED for policy %s — debited, no cover, no refund: %v", p.ID, revErr)
			s.auditSafe(ctx, p.PolicyholderID, "insurance.auto_reverse_failed", map[string]any{
				"policy_id": p.ID, "err": revErr.Error(),
			})
			return p, fmt.Errorf("policy: bind failed AND auto-reverse failed: bind=%v reverse=%v", cause, revErr)
		}
		_ = s.repo.InsertPremiumTx(ctx, PremiumTx{
			PolicyID:        p.ID,
			WalletLedgerRef: "insurance:premium_reversal:" + p.ID,
			IdempotencyKey:  idempotencyKey + ":reversal",
			AmountKobo:      p.PremiumKobo,
			Direction:       "REVERSAL",
			Status:          "reversed",
		})
	}

	_ = s.transition(ctx, p, StateVoid)
	s.auditSafe(ctx, p.PolicyholderID, "insurance.bind_failed_reversed", map[string]any{
		"policy_id": p.ID, "premium": p.PremiumKobo, "cause": cause.Error(),
	})
	s.notifySafe(ctx, p.PolicyholderID, "insurance.refunded",
		"We couldn't bind your cover. Your premium has been refunded to your wallet.")
	return p, fmt.Errorf("policy: bind failed, premium auto-reversed: %w", cause)
}

// transition applies a guarded state change with optimistic version. It refreshes
// p in place on success.
func (s *Service) transition(ctx context.Context, p *Policy, to State) error {
	if !canTransition(p.State, to) {
		return fmt.Errorf("%w: %s → %s", ErrBadState, p.State, to)
	}
	if err := s.repo.SetState(ctx, p.ID, to, p.Version); err != nil {
		return err
	}
	p.State = to
	p.Version++
	return nil
}

// --- queries + lifecycle ops ---

// GetPolicy returns a policy with object-level authZ enforced.
func (s *Service) GetPolicy(ctx context.Context, userID, policyID string) (*Policy, error) {
	p, err := s.repo.Get(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if p.PolicyholderID != userID {
		return nil, ErrForbidden
	}
	return p, nil
}

// ListPolicies returns the caller's policy wallet.
func (s *Service) ListPolicies(ctx context.Context, userID string, limit, offset int) ([]Policy, error) {
	return s.repo.ListByUser(ctx, userID, limit, offset)
}

// Cancel cancels an ACTIVE/RENEWAL_DUE policy the caller owns (provider call +
// state transition). Refund handling for mid-term cancellation is deferred to the
// refund queue (IB1); this records the cancellation and disclosure.
func (s *Service) Cancel(ctx context.Context, userID, policyID, reason string) (*Policy, error) {
	p, err := s.GetPolicy(ctx, userID, policyID)
	if err != nil {
		return nil, err
	}
	if !canTransition(p.State, StateCancelled) {
		return nil, fmt.Errorf("%w: cannot cancel from %s", ErrBadState, p.State)
	}
	if p.ProviderPolicyRef != nil && *p.ProviderPolicyRef != "" {
		gw, _, rErr := s.router.Resolve(ctx, p.ProductCode)
		if rErr == nil {
			if _, cErr := gw.CancelPolicy(ctx, *p.ProviderPolicyRef, reason); cErr != nil {
				return nil, fmt.Errorf("policy: provider cancel failed: %w", cErr)
			}
		}
	}
	if err := s.transition(ctx, p, StateCancelled); err != nil {
		return nil, err
	}
	s.auditSafe(ctx, userID, "insurance.policy_cancelled", map[string]any{"policy_id": p.ID, "reason": reason})
	return s.repo.Get(ctx, p.ID)
}

// CertificateRef returns the stored certificate ref for a policy the caller owns.
// The handler turns this into a signed URL via R2.
func (s *Service) CertificateRef(ctx context.Context, userID, policyID string) (string, error) {
	p, err := s.GetPolicy(ctx, userID, policyID)
	if err != nil {
		return "", err
	}
	if p.CertificateRef == nil || *p.CertificateRef == "" {
		return "", fmt.Errorf("policy: certificate not yet issued")
	}
	return *p.CertificateRef, nil
}

// AddBeneficiary adds a beneficiary to a policy the caller owns.
func (s *Service) AddBeneficiary(ctx context.Context, userID, policyID string, b *Beneficiary) (*Beneficiary, error) {
	if _, err := s.GetPolicy(ctx, userID, policyID); err != nil {
		return nil, err
	}
	b.PolicyID = policyID
	return s.repo.AddBeneficiary(ctx, b)
}

// ListBeneficiaries returns beneficiaries for a policy the caller owns.
func (s *Service) ListBeneficiaries(ctx context.Context, userID, policyID string) ([]Beneficiary, error) {
	if _, err := s.GetPolicy(ctx, userID, policyID); err != nil {
		return nil, err
	}
	return s.repo.ListBeneficiaries(ctx, policyID)
}

// --- admin ---

// SearchAdmin returns policies across users (admin; RBAC gated at the route).
func (s *Service) SearchAdmin(ctx context.Context, state, productCode string, limit, offset int) ([]Policy, error) {
	return s.repo.SearchAdmin(ctx, state, productCode, limit, offset)
}

// --- safe side-effect helpers (never fail the saga) ---

func (s *Service) auditSafe(ctx context.Context, userID, action string, detail map[string]any) {
	if s.audit != nil {
		s.audit.Audit(ctx, userID, action, detail)
	}
}

func (s *Service) notifySafe(ctx context.Context, userID, kind, message string) {
	if s.notify != nil {
		s.notify.Notify(ctx, userID, kind, message)
	}
}

// providerAnswered reports whether a bind error represents a DEFINITE provider
// rejection (the provider replied and refused) as opposed to a transport failure
// where the outcome is genuinely unknown.
//
// This distinction decides whether a retry is safe, so it is deliberately
// conservative: only errors we can positively identify as provider replies count
// as answered. Anything unrecognised — a timeout, a reset connection, a context
// deadline — is treated as UNKNOWN, which locks the idempotency key for
// reconciliation instead of authorising a possible double purchase.
func providerAnswered(err error) bool {
	if err == nil {
		return false
	}
	// Adapters wrap ErrProviderRejected around every error they KNOW was a reply
	// — a validation 4xx, an empty float, an unsupported operation — and around
	// their own pre-flight refusals, which never reached the provider at all.
	// Either way nothing was created, so a retry is safe.
	//
	// Everything else (timeout, reset connection, context deadline) falls
	// through to false and is treated as an UNKNOWN outcome. Silence is never
	// read as success or as failure.
	if errors.Is(err, gateway.ErrProviderRejected) {
		return true
	}
	if errors.Is(err, gateway.ErrNoProvider) {
		return true
	}
	return false
}
