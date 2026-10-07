package embedded

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/catalog"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

// Premium-tx row vocabulary (insurance_premium_transaction.direction/status)
// and the ledger idempotency-key leg suffixes every money move derives from
// the source_event_id.
const (
	premiumTxDebit    = "DEBIT"
	premiumTxReversal = "REVERSAL"
	premiumTxPosted   = "posted"
	premiumTxReversed = "reversed"

	legPremium    = ":premium"
	legReversal   = ":reversal"
	legCommission = ":commission"
)

// Notifier emits user-facing notifications (cover bound / top-up offer).
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// Auditor appends an immutable audit event.
type Auditor interface {
	Audit(ctx context.Context, userID, action string, detail map[string]any)
}

// ErrSourceEventConflict is returned when a source_event_id is already claimed
// by a policy belonging to a DIFFERENT policyholder. The error deliberately
// carries no ids — existence of the anchor is all a caller may learn.
var ErrSourceEventConflict = errors.New("embedded: source_event_id already claimed")

// Service is the embedded-binding engine. It maps platform lifecycle events to
// catalog cover (data-driven via product_line), then runs the embedded bind saga
// REUSING the finance wallet/ledger (premium hold + release) and the gateway
// Router (provider-agnostic bind). It writes policies into the SAME
// insurance_policy table as IB0 via policy.Repository, with binding_mode=embedded
// and source_event_id set.
//
// IDEMPOTENT + CONVERGENT on source_event_id: a replayed event RESUMES the saga
// from the recorded policy state rather than lying about success. Two guards:
//  1. fast pre-check (PolicyForSourceEvent, ownership-verified), and
//  2. the hard DB unique index uq_insurance_policy_source_event — a racing
//     duplicate Create fails and is re-resolved to the existing policy.
//
// Every money leg is idempotent on a key DERIVED from source_event_id
// ("embedded:<src>:premium| :reversal| :commission"), so a crash mid-saga
// converges on retry exactly like the crowdfunding refund executor.
type Service struct {
	repo       Repo
	policyRepo *policy.Repository
	router     *gateway.Router
	wallet     *wallet.Service
	ledger     *ledger.Service
	// binds is the outbound-purchase idempotency register — MyCover documents
	// NO idempotency on its buy endpoint, so the claim INSERT is the only thing
	// stopping a retried bind from purchasing a second policy with real float.
	// Nil → every provider purchase refuses fail-closed.
	binds *policy.BindRegistry
	// float is the prefunded-provider-float breaker (optional): when the
	// provider float is empty every bind fails at once, so we refuse BEFORE the
	// member's premium moves instead of debit→reverse churn.
	float  *catalog.FloatService
	notify Notifier
	audit  Auditor
}

// Deps bundles the embedded engine dependencies.
type Deps struct {
	Repo       Repo
	PolicyRepo *policy.Repository
	Router     *gateway.Router
	Wallet     *wallet.Service
	Ledger     *ledger.Service
	// Binds is the shared outbound bind-idempotency register
	// (policy.NewBindRegistry(pool)). REQUIRED for money safety — a nil
	// registry fails every bind closed rather than risking a double purchase.
	Binds *policy.BindRegistry
	// Float is the prefunded-float breaker (catalog.NewFloatService(pool)).
	// Optional — nil skips the early outage check.
	Float    *catalog.FloatService
	Notifier Notifier
	Auditor  Auditor
}

// NewService constructs the embedded engine.
func NewService(d Deps) *Service {
	return &Service{
		repo:       d.Repo,
		policyRepo: d.PolicyRepo,
		router:     d.Router,
		wallet:     d.Wallet,
		ledger:     d.Ledger,
		binds:      d.Binds,
		float:      d.Float,
		notify:     d.Notifier,
		audit:      d.Auditor,
	}
}

// Handle is the internal entrypoint the orchestrator calls from existing emit
// points (trip.started, parcel.booked, loan.disbursed, ...) — in-process, or via
// the service-token HTTP route. It runs the embedded state machine end-to-end
// and is convergent on ev.SourceEventID: a replayed event resumes the recorded
// policy's saga instead of reporting a fresh success.
func (s *Service) Handle(ctx context.Context, ev EmbeddedEvent) (*Result, error) {
	if ev.SourceEventID == "" {
		return nil, errors.New("embedded: source_event_id required")
	}
	if ev.UserID == "" {
		return nil, errors.New("embedded: user_id required")
	}
	if ev.EventType == "" {
		return nil, errors.New("embedded: event_type required")
	}
	if s.repo == nil || s.policyRepo == nil || s.wallet == nil || s.ledger == nil {
		return nil, errors.New("embedded: service not fully wired")
	}

	src := ev.SourceEventID
	idempotencyKey := "embedded:" + src
	// Ledger reference is src-derived (NOT policy-id-derived): the anchor must
	// be stable before the policy row exists and across every retry.
	premiumRef := "insurance:embedded_premium:" + src

	// (guard 1) already-bound event? Ownership-verified: an event id claimed by
	// a DIFFERENT policyholder is a conflict, never a replay — before this,
	// anyone could probe another user's event id and learn policy_id/state.
	existing, found, err := s.repo.PolicyForSourceEvent(ctx, src)
	if err != nil {
		return nil, err
	}
	if found {
		if existing.PolicyholderID != ev.UserID {
			return nil, ErrSourceEventConflict
		}
		return s.resume(ctx, ev, existing, idempotencyKey, premiumRef)
	}

	// EVENT_RECEIVED → resolve cover via product_line (NO_MAPPING → no-op).
	line, ok := eventProductLine[ev.EventType]
	if !ok {
		log.Printf("[insurance][embedded] no line mapping for event %q (source=%s) — no-op", ev.EventType, src)
		return &Result{State: StateNoMapping, Reason: "no line mapping for event"}, nil
	}
	prod, err := s.repo.ResolveCoverByLine(ctx, line)
	if err != nil {
		if errors.Is(err, ErrNoMapping) {
			log.Printf("[insurance][embedded] no active embedded product for line %q (event=%s) — no-op", line, ev.EventType)
			return &Result{State: StateNoMapping, Reason: "no active product for line " + line}, nil
		}
		return nil, err
	}

	// COVER_RESOLVED → quote at the provider to learn the premium + sum insured.
	gw, providerProduct, err := s.router.Resolve(ctx, prod.Code)
	if err != nil {
		return &Result{State: StateNoMapping, ProductCode: prod.Code, Reason: "no provider for product"}, nil
	}
	sumInsured := ev.SumInsuredKobo
	if sumInsured <= 0 {
		sumInsured = fixedSumFromRules(prod.SumInsuredRules)
	}
	q, qErr := gw.GetQuote(ctx, gateway.QuoteRequest{
		ProviderProductCode: providerProduct.Code,
		Product:             providerProduct,
		Currency:            prod.Currency,
		SumInsuredKobo:      sumInsured,
		Inputs:              ev.Inputs,
	})
	if qErr != nil {
		return nil, fmt.Errorf("embedded: quote: %w", qErr)
	}
	if q.SumInsuredKobo > 0 {
		sumInsured = q.SumInsuredKobo
	}
	underwriter := q.Underwriter
	if underwriter == "" {
		underwriter = prod.UnderwriterDisplay
	}

	// Prefunded-float breaker BEFORE any money moves — mirrors policy.Bind. An
	// empty float fails every bind at once; refusing here is a clean 422, not a
	// debit→reverse incident per member.
	if s.float != nil {
		if fErr := s.float.Guard(ctx, prod.Provider); fErr != nil {
			s.auditSafe(ctx, ev.UserID, "insurance.embedded.bind_blocked_provider_float", map[string]any{
				"provider": prod.Provider, "event": ev.EventType,
			})
			return nil, fErr
		}
	}

	// Create the policy row (binding_mode=embedded, source_event_id set) BEFORE
	// any money moves — the row is the durable anchor every money leg keys off.
	// The UNIQUE index on source_event_id is the hard idempotency guard.
	p, cErr := s.policyRepo.Create(ctx, &policy.Policy{
		PolicyholderID: ev.UserID,
		ProductCode:    prod.Code,
		Provider:       prod.Provider,
		Underwriter:    underwriter,
		BindingMode:    string(gateway.BindingModeEmbedded),
		State:          policy.StateQuoted,
		SumInsuredKobo: sumInsured,
		PremiumKobo:    q.PremiumKobo,
		Currency:       q.Currency,
		SourceEventID:  &src,
	})
	if cErr != nil {
		// A racing bind won the unique index (or a foreign holder already claims
		// this event id) — converge to the committed row instead of duplicating.
		if ex, found, gErr := s.repo.PolicyForSourceEvent(ctx, src); gErr == nil && found {
			if ex.PolicyholderID != ev.UserID {
				return nil, ErrSourceEventConflict
			}
			return s.resume(ctx, ev, ex, idempotencyKey, premiumRef)
		}
		return nil, fmt.Errorf("embedded: create policy: %w", cErr)
	}

	return s.drive(ctx, ev, p, gw, providerProduct, q.ProviderQuoteRef, idempotencyKey, premiumRef)
}

// resume converges an existing (caller-owned) policy row to a terminal saga
// state. It NEVER reports success for an unfinished saga — the previous code
// answered ACTIVE+Replayed for ANY existing row, so a crash between debit and
// bind left the premium parked in provider_clearing while every retry claimed
// the member was covered.
func (s *Service) resume(ctx context.Context, ev EmbeddedEvent, p *policy.Policy, idempotencyKey, premiumRef string) (*Result, error) {
	switch p.State {
	case policy.StateActive, policy.StateRenewalDue:
		return &Result{State: StateActive, PolicyID: p.ID, ProductCode: p.ProductCode,
			Provider: p.Provider, Replayed: true}, nil

	case policy.StateCancelled, policy.StateExpired, policy.StateVoid:
		// Terminal — the cover is gone; a replay must not re-debit.
		return &Result{State: StateUncovered, PolicyID: p.ID, Replayed: true,
			Reason: "event already processed (policy " + string(p.State) + ")"}, nil

	case policy.StatePaymentFailed:
		// Mid-converge crash between PAYMENT_FAILED and VOID — finish it.
		if err := s.advance(ctx, p, policy.StateVoid); err != nil {
			return nil, fmt.Errorf("embedded: converge payment_failed: %w", err)
		}
		return &Result{State: StateUncovered, PolicyID: p.ID, Replayed: true}, nil

	case policy.StateBindFailed:
		// The auto-reverse either finished or died mid-flight — PostReversal is
		// idempotent, so re-running the release converges it.
		return s.releaseAndUncover(ctx, p, idempotencyKey,
			errors.New("resumed a failed bind"))

	case policy.StateQuoted, policy.StatePendingPayment, policy.StateBinding:
		// Resume mid-saga: re-resolve the gateway and re-quote — provider quote
		// refs expire and Octamile forwards quote_reference at bind time, so the
		// stored row alone cannot rebuild BindRequest.
		gw, providerProduct, err := s.router.Resolve(ctx, p.ProductCode)
		if err != nil {
			// Product/provider gone for good — the cover can never bind; release
			// any held premium and void the row.
			return s.releaseAndUncover(ctx, p, idempotencyKey, fmt.Errorf("product unresolvable: %w", err))
		}
		if s.float != nil {
			if fErr := s.float.Guard(ctx, p.Provider); fErr != nil {
				// Transient treasury outage — leave the row BINDING/PENDING and
				// let the retry converge; releasing on an outage only churns.
				return nil, fErr
			}
		}
		q, qErr := gw.GetQuote(ctx, gateway.QuoteRequest{
			ProviderProductCode: providerProduct.Code,
			Product:             providerProduct,
			Currency:            p.Currency,
			SumInsuredKobo:      p.SumInsuredKobo,
			Inputs:              ev.Inputs,
		})
		if qErr != nil {
			return nil, fmt.Errorf("embedded: resume quote: %w", qErr)
		}
		return s.drive(ctx, ev, p, gw, providerProduct, q.ProviderQuoteRef, idempotencyKey, premiumRef)

	default:
		return nil, fmt.Errorf("embedded: policy %s in unhandled state %s", p.ID, p.State)
	}
}

// drive executes the PAYMENT → BINDING → ACTIVE legs from wherever the policy
// row currently sits. Every step is idempotent or version-guarded, so a retry
// after any crash converges: posted legs no-op, un-posted legs run.
func (s *Service) drive(ctx context.Context, ev EmbeddedEvent, p *policy.Policy,
	gw gateway.UnderwriterGateway, providerProduct gateway.ProviderProduct,
	providerQuoteRef, idempotencyKey, premiumRef string) (*Result, error) {

	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}

	// PAYMENT leg — runs only while the row sits before BINDING. A QUOTED row
	// advances through PENDING_PAYMENT into the same leg, so resume from either
	// state converges identically.
	if p.State == policy.StateQuoted {
		if err := s.advance(ctx, p, policy.StatePendingPayment); err != nil {
			return nil, fmt.Errorf("embedded: mark pending payment: %w", err)
		}
	}
	if p.State == policy.StatePendingPayment {
		if p.PremiumKobo > 0 {
			debitErr := s.wallet.Debit(ctx, p.PolicyholderID, premiumRef,
				idempotencyKey+legPremium, clearing.ID, p.PremiumKobo)
			switch {
			case debitErr == nil || errors.Is(debitErr, ledger.ErrDuplicate):
				// Provenance check: the balanced pair MUST be on the ledger of
				// record. An ErrDuplicate that is only a Redis-lock shadow (the
				// posting never landed) must not fulfil the premium leg.
				posted, pErr := s.ledger.Posted(ctx, idempotencyKey+legPremium)
				if pErr != nil {
					return nil, fmt.Errorf("embedded: verify premium posting: %w", pErr)
				}
				if !posted {
					return nil, errors.New("embedded: premium debit not durable — refusing to bind unfunded cover")
				}
			case errors.Is(debitErr, ledger.ErrInsufficientFunds):
				// INSUFFICIENT_FUNDS → PAYMENT_FAILED → VOID (offer top-up).
				// Nothing was debited, so nothing needs reversing.
				if err := s.advance(ctx, p, policy.StatePaymentFailed); err != nil {
					return nil, fmt.Errorf("embedded: mark payment failed: %w", err)
				}
				if err := s.advance(ctx, p, policy.StateVoid); err != nil {
					return nil, fmt.Errorf("embedded: void failed-payment policy: %w", err)
				}
				s.auditSafe(ctx, ev.UserID, "insurance.embedded.insufficient_funds", map[string]any{
					"policy_id": p.ID, "event": ev.EventType,
				})
				s.notifySafe(ctx, ev.UserID, "insurance.embedded.top_up",
					"We couldn't bind cover for your "+ev.EventType+" — top up your wallet to enable it.")
				return &Result{State: StateInsufficientFunds, PolicyID: p.ID, ProductCode: p.ProductCode,
					Provider: p.Provider, Reason: "insufficient funds"}, nil
			default:
				return nil, fmt.Errorf("embedded: premium debit: %w", debitErr)
			}
			if err := s.policyRepo.InsertPremiumTx(ctx, policy.PremiumTx{
				PolicyID:        p.ID,
				WalletLedgerRef: premiumRef,
				IdempotencyKey:  idempotencyKey + legPremium,
				AmountKobo:      p.PremiumKobo,
				Direction:       premiumTxDebit,
				Status:          premiumTxPosted,
			}); err != nil {
				return nil, fmt.Errorf("embedded: record premium tx: %w", err)
			}
		}
		if err := s.advance(ctx, p, policy.StateBinding); err != nil {
			return nil, fmt.Errorf("embedded: mark binding: %w", err)
		}
	}
	if p.State != policy.StateBinding {
		return nil, fmt.Errorf("embedded: cannot drive policy %s from state %s", p.ID, p.State)
	}

	// OUTBOUND PURCHASE IDEMPOTENCY — claim the key BEFORE calling the provider.
	// MyCover documents no idempotency on its buy endpoint, so this INSERT is
	// the only guard against a retried bind purchasing a second policy.
	// FAILS CLOSED: no claim, no provider call — the premium stays held in
	// provider_clearing until a retry or reconciliation resolves it.
	if s.binds == nil {
		return nil, errors.New("embedded: bind registry unavailable — refusing provider purchase")
	}
	claim, claimErr := s.binds.Claim(ctx, idempotencyKey, p.Provider, p.ProductCode, p.ID)
	if claimErr != nil {
		// ErrBindInFlight (concurrent attempt) and ErrBindOutcomeUnknown (a
		// purchase possibly already made) both leave the row BINDING — surfaced
		// via UnresolvedCount for reconciliation, never guessed at.
		return nil, fmt.Errorf("embedded: bind claim: %w", claimErr)
	}

	var bound gateway.Policy
	if !claim.Fresh {
		// This purchase already succeeded under this key — replay the recorded
		// outcome, never buy again. Rebuild the bound view from the provider so
		// commission/certificate/effective dates survive the persist below.
		bound = gateway.Policy{
			ProviderPolicyRef: claim.ProviderPolicyRef,
			PremiumKobo:       p.PremiumKobo,
			SumInsuredKobo:    p.SumInsuredKobo,
			Currency:          p.Currency,
			Underwriter:       p.Underwriter,
		}
		if fetched, gErr := gw.GetPolicy(ctx, claim.ProviderPolicyRef); gErr == nil {
			bound = fetched
		} else {
			log.Printf("[insurance][embedded] WARN: could not refetch provider policy %s for policy %s: %v — persisting stored ref",
				claim.ProviderPolicyRef, p.ID, gErr)
		}
	} else {
		b, bindErr := gw.BindPolicy(ctx, gateway.BindRequest{
			ProviderProductCode: providerProduct.Code,
			Product:             providerProduct,
			ProviderQuoteRef:    providerQuoteRef,
			Currency:            p.Currency,
			SumInsuredKobo:      p.SumInsuredKobo,
			PremiumKobo:         p.PremiumKobo,
			PolicyholderRef:     "ph:" + p.ID,
			IdempotencyKey:      idempotencyKey,
			Inputs:              ev.Inputs,
		})
		if bindErr != nil {
			// Record what we actually know: a provider REPLY is a definite
			// negative (retry safe), a transport failure is UNKNOWN (never
			// auto-retried — reconciled instead). Mirrors policy.Bind.
			if providerAnswered(bindErr) {
				s.binds.Failed(ctx, idempotencyKey, bindErr.Error())
			} else {
				s.binds.Unknown(ctx, idempotencyKey, bindErr.Error())
			}
			if s.float != nil && errors.Is(bindErr, gateway.ErrProviderFloatExhausted) {
				s.float.RecordFloatExhausted(ctx, p.Provider, bindErr.Error())
				s.auditSafe(ctx, ev.UserID, "insurance.embedded.provider_float_exhausted", map[string]any{
					"policy_id": p.ID, "provider": p.Provider,
				})
			}
			return s.releaseAndUncover(ctx, p, idempotencyKey, bindErr)
		}
		bound = b
		s.binds.Succeeded(ctx, idempotencyKey, bound.ProviderPolicyRef, bound.PremiumKobo)
		// A bind that went through is proof the float has money — evidence-based
		// recovery of the breaker.
		if s.float != nil {
			s.float.RecordBindSucceeded(ctx, p.Provider)
		}
	}

	return s.persistBound(ctx, ev, p, bound, idempotencyKey, clearing.ID)
}

// persistBound records the provider outcome and moves the policy ACTIVE, then
// posts commission. SetBound errors PROPAGATE — the claim registry already has
// the outcome, so a retry converges through the !claim.Fresh replay branch.
func (s *Service) persistBound(ctx context.Context, ev EmbeddedEvent, p *policy.Policy,
	bound gateway.Policy, idempotencyKey, clearingAccID string) (*Result, error) {

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
	if err := s.policyRepo.SetBound(ctx, p.ID, bound.ProviderPolicyRef, bound.Underwriter,
		commission, certRef, effAt, expAt, p.Version); err != nil {
		return nil, fmt.Errorf("embedded: bind persist: %w", err)
	}
	p.State = policy.StateActive
	p.Version++

	// Commission to the SEPARATE commission account (DR clearing → CR
	// commission). Best-effort like policy.Bind: a miss here is a workbench
	// reconciliation gap, never a failed bind — the money truth (premium hold +
	// ACTIVE cover) is already durable.
	if commission > 0 {
		if commAcc, cErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission); cErr == nil {
			postErr := s.ledger.PostJournal(ctx, ledger.JournalEntry{
				Reference:       "insurance:embedded_commission:" + p.ID,
				IdempotencyKey:  idempotencyKey + legCommission,
				AmountKobo:      commission,
				DebitAccountID:  clearingAccID,
				CreditAccountID: commAcc.ID,
			})
			if postErr != nil && !errors.Is(postErr, ledger.ErrDuplicate) {
				log.Printf("[insurance][embedded] WARN: commission post failed for policy %s: %v", p.ID, postErr)
			}
		}
	}

	s.auditSafe(ctx, ev.UserID, "insurance.embedded.bound", map[string]any{
		"policy_id": p.ID, "event": ev.EventType, "provider": p.Provider, "premium": p.PremiumKobo,
	})
	s.notifySafe(ctx, ev.UserID, "insurance.embedded.active", "Cover is now active for your "+ev.EventType+".")
	return &Result{State: StateActive, PolicyID: p.ID, ProductCode: p.ProductCode, Provider: p.Provider}, nil
}

// releaseAndUncover releases the held premium back to the user wallet and moves
// the policy to VOID, returning an UNCOVERED result. Every leg is idempotent
// (PostReversal + InsertPremiumTx are keyed), so a mid-flight crash converges
// on retry; a reversal that cannot post leaves the row in BIND_FAILED — loud,
// and resumable, never silently VOIDed over parked money.
func (s *Service) releaseAndUncover(ctx context.Context, p *policy.Policy, idempotencyKey string, cause error) (*Result, error) {
	if p.State == policy.StateBinding {
		if err := s.advance(ctx, p, policy.StateBindFailed); err != nil {
			return nil, fmt.Errorf("embedded: mark bind failed: %w", err)
		}
	}

	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}
	userWallet, err := s.ledger.GetOrCreateUserWallet(ctx, p.PolicyholderID)
	if err != nil {
		return nil, err
	}

	// Provenance: reverse only what THIS event's debit actually posted on THIS
	// policyholder's wallet — the recorded amount, not the request's claim.
	// (Mirrors VoteDebitReverse's double-provenance check.)
	held, found, hErr := s.ledger.EntryAmount(ctx, userWallet.ID, idempotencyKey+legPremium+":debit")
	if hErr != nil {
		return nil, fmt.Errorf("embedded: read held premium: %w", hErr)
	}
	if found && held > 0 {
		revErr := s.ledger.PostReversal(ctx, userWallet.ID, clearing.ID, held,
			"insurance:embedded_premium_reversal:"+p.ID, idempotencyKey+legReversal)
		if revErr != nil && !errors.Is(revErr, ledger.ErrDuplicate) {
			log.Printf("[insurance][embedded] CRITICAL: premium release FAILED for policy %s: %v", p.ID, revErr)
			s.auditSafe(ctx, p.PolicyholderID, "insurance.embedded.auto_reverse_failed", map[string]any{
				"policy_id": p.ID, "err": revErr.Error(),
			})
			return nil, fmt.Errorf("embedded: bind failed AND auto-reverse failed: bind=%w reverse=%w", cause, revErr)
		}
		// The reversal must be durable — an ErrDuplicate that is only a
		// Redis-lock shadow would leave the premium parked forever.
		if _, ok, vErr := s.ledger.EntryAmount(ctx, userWallet.ID, idempotencyKey+legReversal+":rev_debit"); vErr != nil {
			return nil, fmt.Errorf("embedded: verify premium reversal: %w", vErr)
		} else if !ok {
			log.Printf("[insurance][embedded] CRITICAL: premium reversal reported but not durable for policy %s", p.ID)
			return nil, errors.New("embedded: premium reversal not durable")
		}
		if err := s.policyRepo.InsertPremiumTx(ctx, policy.PremiumTx{
			PolicyID:        p.ID,
			WalletLedgerRef: "insurance:embedded_premium_reversal:" + p.ID,
			IdempotencyKey:  idempotencyKey + legReversal,
			AmountKobo:      held,
			Direction:       premiumTxReversal,
			Status:          premiumTxReversed,
		}); err != nil {
			return nil, fmt.Errorf("embedded: record premium reversal: %w", err)
		}
	}

	if err := s.advance(ctx, p, policy.StateVoid); err != nil {
		return nil, fmt.Errorf("embedded: void policy: %w", err)
	}
	s.auditSafe(ctx, p.PolicyholderID, "insurance.embedded.bind_failed", map[string]any{
		"policy_id": p.ID, "cause": cause.Error(),
	})
	s.notifySafe(ctx, p.PolicyholderID, "insurance.embedded.uncovered",
		"We couldn't bind your cover; any held premium has been released.")
	return &Result{State: StateUncovered, PolicyID: p.ID, Reason: cause.Error()}, nil
}

// allowedTransitions mirrors the guarded policy lifecycle FSM
// (insurance/policy transitions table — unexported there). The engine must
// never write a state jump the lifecycle forbids.
var allowedTransitions = map[policy.State][]policy.State{
	policy.StateQuoted:         {policy.StatePendingPayment, policy.StateExpired},
	policy.StatePendingPayment: {policy.StateBinding, policy.StatePaymentFailed},
	policy.StateBinding:        {policy.StateActive, policy.StateBindFailed},
	policy.StateActive:         {policy.StateRenewalDue, policy.StateCancelled, policy.StateExpired},
	policy.StateRenewalDue:     {policy.StateActive, policy.StateExpired, policy.StateCancelled},
	policy.StateBindFailed:     {policy.StateVoid},
	policy.StatePaymentFailed:  {policy.StateVoid},
}

// advance applies a guarded policy state change via policy.Repository and keeps
// the in-memory version in sync. Errors PROPAGATE — the caller decides whether
// the saga can continue; a failed transition before a money leg must stop the
// leg, not silently skip it.
func (s *Service) advance(ctx context.Context, p *policy.Policy, to policy.State) error {
	allowed := false
	for _, t := range allowedTransitions[p.State] {
		if t == to {
			allowed = true
			break
		}
	}
	if !allowed {
		return fmt.Errorf("embedded: illegal policy transition %s → %s", p.State, to)
	}
	if err := s.policyRepo.SetState(ctx, p.ID, to, p.Version); err != nil {
		return err
	}
	p.State = to
	p.Version++
	return nil
}

// providerAnswered reports whether a bind error is a DEFINITE provider reply
// (safe to retry) versus a transport failure whose outcome is unknown (never
// auto-retried — reconciled). Mirrors insurance/policy's helper; duplicated
// because that one is unexported and the policy package is outside this lane.
func providerAnswered(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gateway.ErrProviderRejected) {
		return true
	}
	return errors.Is(err, gateway.ErrNoProvider)
}

// fixedSumFromRules extracts a fixed sum-insured (kobo) from a product's
// sum_insured_rules JSON (e.g. {"fixed_kobo":50000000}). Returns 0 when none.
func fixedSumFromRules(rules map[string]any) int64 {
	if rules == nil {
		return 0
	}
	if v, ok := rules["fixed_kobo"]; ok {
		switch n := v.(type) {
		case float64:
			return int64(n)
		case int64:
			return n
		case int:
			return int64(n)
		}
	}
	return 0
}

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

// Register wires the embedded-engine routes.
//   - member (user JWT, /api/finance/insurance/embedded):
//     GET /events — read-only discovery of mapped event types.
//   - internal (SERVICE TOKEN, /internal/insurance/embedded):
//     POST /events — trigger an embedded bind.
//
// The POST is deliberately NOT a member route: it debits the policyholder's
// wallet and the caller chooses the source_event_id that anchors every money
// leg. Only the platform may declare a lifecycle event — a member-facing
// trigger would let any authenticated user mint unlimited arbitrary events
// against their own wallet AND against the provider's real buy endpoints.
// Production emit points call Service.Handle in-process; the HTTP route exists
// for service-to-service emission and manual/ops triggers, authenticated by
// middleware.RequireServiceToken applied at the mount.
func Register(member *gin.RouterGroup, internal *gin.RouterGroup, h *Handler) {
	g := member.Group("/embedded")
	g.GET("/events", h.KnownEvents)
	if internal != nil {
		internal.POST("/embedded/events", h.Trigger)
	}
}

// Engine is the slice of Service the handler drives (the test seam).
type Engine interface {
	Handle(ctx context.Context, ev EmbeddedEvent) (*Result, error)
}

// Handler exposes the internal embedded trigger. In production the engine is
// driven by Handle() called from platform emit points.
type Handler struct {
	svc Engine
}

// NewHandler constructs the embedded handler.
func NewHandler(svc Engine) *Handler { return &Handler{svc: svc} }

// Trigger (service-token): POST /internal/insurance/embedded/events
// body: {source_event_id, event_type, user_id, sum_insured_kobo?, inputs?}
// Idempotency-Key header REQUIRED (iron rule for money mutations). The durable
// idempotency anchor is source_event_id itself — platform-issued and unique —
// so retries under the same event id converge regardless of the header value.
// user_id is the policyholder the cover binds for (the caller is an internal
// service acting on behalf of the platform, not the policyholder's own JWT).
func (h *Handler) Trigger(c *gin.Context) {
	if _, ok := ginutil.RequireIdempotencyKey(c); !ok {
		return
	}
	var body struct {
		SourceEventID  string         `json:"source_event_id" binding:"required"`
		EventType      string         `json:"event_type" binding:"required"`
		UserID         string         `json:"user_id" binding:"required"`
		SumInsuredKobo int64          `json:"sum_insured_kobo"`
		Inputs         map[string]any `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.Handle(c.Request.Context(), EmbeddedEvent{
		SourceEventID:  body.SourceEventID,
		EventType:      body.EventType,
		UserID:         body.UserID,
		SumInsuredKobo: body.SumInsuredKobo,
		Inputs:         body.Inputs,
	})
	if err != nil {
		if errors.Is(err, ErrSourceEventConflict) {
			// Mirrors the transfers caller-scoped-replay contract: a foreign
			// anchor collision is a 409, not a leak.
			c.JSON(http.StatusConflict, gin.H{keyError: "idempotency_key_conflict"})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// KnownEvents (member): GET /embedded/events — lists the mapped event types
// (discovery for clients/tests). Read-only.
func (h *Handler) KnownEvents(c *gin.Context) {
	events := make([]string, 0, len(eventProductLine))
	for k := range eventProductLine {
		events = append(events, k)
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"events": strings.Join(events, ","), "as_of": time.Now().UTC()}})
}

// State is the embedded-binding engine state (PRD §10.3).
//
//	EVENT_RECEIVED → COVER_RESOLVED → PREMIUM_HELD → BINDING → ACTIVE
//	        └─ NO_MAPPING (no-op, log)
//
// The engine is CONVERGENT on source_event_id — a replayed platform event
// resumes the recorded saga state and never double-binds or double-debits
// (enforced by uq_insurance_policy_source_event + derived ledger keys + the
// outbound bind registry).
type State string

const (
	StateEventReceived     State = "EVENT_RECEIVED"
	StateCoverResolved     State = "COVER_RESOLVED"
	StatePremiumHeld       State = "PREMIUM_HELD"
	StateBinding           State = "BINDING"
	StateActive            State = "ACTIVE"
	StateFailed            State = "FAILED"
	StateUncovered         State = "UNCOVERED"
	StateNoMapping         State = "NO_MAPPING"
	StateInsufficientFunds State = "INSUFFICIENT_FUNDS"
)

// EmbeddedEvent is a normalised platform lifecycle event that may trigger an
// embedded bind. SourceEventID is the platform's unique event id and is the
// idempotency key for the whole bind. ProductLine resolves the cover via the
// catalog (data-driven routing — no event→product branching in code beyond the
// well-known mapping table).
type EmbeddedEvent struct {
	// SourceEventID is the globally-unique platform event id. A replayed event
	// with the same id converges to the recorded outcome (never double-binds).
	SourceEventID string `json:"source_event_id"`
	// EventType is the platform event name, e.g. "trip.started", "loan.disbursed".
	EventType string `json:"event_type"`
	// UserID is the policyholder the cover binds for.
	UserID string `json:"user_id"`
	// SumInsuredKobo is an optional declared cover amount (e.g. parcel value); 0
	// lets the product's sum_insured_rules drive it.
	SumInsuredKobo int64 `json:"sum_insured_kobo"`
	// Inputs are product-specific, schema-minimised fields (trip_id, imei, ...).
	Inputs map[string]any `json:"inputs"`
}

// Result is the outcome of handling an embedded event.
type Result struct {
	State       State  `json:"state"`
	PolicyID    string `json:"policy_id,omitempty"`
	ProductCode string `json:"product_code,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Reason      string `json:"reason,omitempty"`
	// Replayed is true when the event was already processed (idempotent no-op).
	Replayed bool `json:"replayed,omitempty"`
}

// eventProductLine maps a platform event type to the catalog product_line whose
// active product carries the cover. This is the §13/§B embedded event catalog
// (PRD lines 347-355). The actual provider + product code are resolved from the
// catalog (single source of truth) — this table only names the line.
//
//	trip.started            -> transport  (Octamile passenger/rider)
//	parcel.booked           -> logistics  (Octamile GIT per-shipment)
//	bus.seat_booked         -> transport  (Octamile passenger)
//	consignment.created     -> logistics  (Octamile haulage/GIT)
//	loan.disbursed          -> credit-life (MyCover credit-life)
//	device.purchased        -> device     (MyCover device cover)
//	wallet.funded           -> wallet     (MyCover wallet insurance)
//	spotlight.event_created -> spotlight-event (MyCover event cover)
//	contestant.enrolled     -> spotlight-contestant (MyCover contestant cover)
var eventProductLine = map[string]string{
	"trip.started":            "transport",
	"parcel.booked":           "logistics",
	"bus.seat_booked":         "transport",
	"consignment.created":     "logistics",
	"loan.disbursed":          "credit-life",
	"device.purchased":        "device",
	"wallet.funded":           "wallet",
	"spotlight.event_created": "spotlight-event",
	"contestant.enrolled":     "spotlight-contestant",
}

// Repo is the read side the embedded engine needs (implemented by *Repository).
// Interface-typed so tests can drive Handle/resume without a database.
type Repo interface {
	// ResolveCoverByLine returns the active EMBEDDED product for a product_line.
	ResolveCoverByLine(ctx context.Context, line string) (*EmbeddedProduct, error)
	// PolicyForSourceEvent returns the policy row anchored to a source_event_id
	// (any owner) — the caller enforces ownership; see Handle.
	PolicyForSourceEvent(ctx context.Context, sourceEventID string) (*policy.Policy, bool, error)
}

// Repository is the concrete read side the embedded engine needs that IB0 did
// not expose: resolving the active EMBEDDED product for a product_line, and the
// source_event_id anchor lookup against insurance_policy. All queries are
// read-only + parameterized; the engine writes policies via policy.Repository.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the embedded repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// EmbeddedProduct is the slice of the catalog the engine needs to resolve cover.
type EmbeddedProduct struct {
	Code                string
	Provider            string
	ProviderProductCode string
	UnderwriterDisplay  string
	Currency            string
	SumInsuredRules     map[string]any
}

// ErrNoMapping is returned when no active embedded product exists for a line.
var ErrNoMapping = errors.New("embedded: no active product mapped for line")

// ResolveCoverByLine returns the active EMBEDDED product for a product_line. The
// catalog is the single source of truth for product → provider routing; this
// query never branches on the event type. When multiple embedded products exist
// for a line, the most recently updated active one wins.
func (r *Repository) ResolveCoverByLine(ctx context.Context, line string) (*EmbeddedProduct, error) {
	if r.db == nil {
		return nil, ErrNoMapping
	}
	var p EmbeddedProduct
	var sumRules []byte
	err := r.db.QueryRow(ctx, `
		SELECT code, provider, provider_product_code, underwriter_display, sum_insured_rules
		FROM public.insurance_products
		WHERE product_line = $1 AND binding_mode = 'embedded' AND active = true
		ORDER BY updated_at DESC
		LIMIT 1`, line).Scan(&p.Code, &p.Provider, &p.ProviderProductCode, &p.UnderwriterDisplay, &sumRules)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoMapping
		}
		return nil, err
	}
	_ = json.Unmarshal(sumRules, &p.SumInsuredRules)
	p.Currency = "NGN"
	return &p, nil
}

// PolicyForSourceEvent returns the embedded policy row bound off a
// source_event_id, regardless of owner. The CALLER enforces ownership —
// returning the row to the service is safe, returning it to a non-owner is not
// (previously the pre-check handed a cross-user policy_id + ACTIVE state to any
// caller who guessed an event id). The DB unique index
// uq_insurance_policy_source_event is the hard idempotency guard.
func (r *Repository) PolicyForSourceEvent(ctx context.Context, sourceEventID string) (*policy.Policy, bool, error) {
	if r.db == nil || sourceEventID == "" {
		return nil, false, nil
	}
	row := r.db.QueryRow(ctx, `
		SELECT `+policyCols+` FROM public.insurance_policy WHERE source_event_id = $1 LIMIT 1`, sourceEventID)
	p, err := scanEmbeddedPolicy(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return p, true, nil
}

// policyCols/scanEmbeddedPolicy mirror the policy package's own column list —
// duplicated rather than exported because policy's scanner is unexported and
// outside this lane. The SELECT lists every column the saga resume needs
// (state, version, stored premium/currency for the money legs).
const policyCols = `id, policyholder_user_id, product_code, provider, provider_policy_ref,
	underwriter, binding_mode, state, sum_insured_kobo, premium_amount_kobo, currency,
	commission_kobo, certificate_ref, effective_at, expires_at, source_event_id,
	created_at, updated_at, version`

func scanEmbeddedPolicy(row interface {
	Scan(dest ...any) error
}) (*policy.Policy, error) {
	var p policy.Policy
	if err := row.Scan(
		&p.ID, &p.PolicyholderID, &p.ProductCode, &p.Provider, &p.ProviderPolicyRef,
		&p.Underwriter, &p.BindingMode, &p.State, &p.SumInsuredKobo, &p.PremiumKobo, &p.Currency,
		&p.CommissionKobo, &p.CertificateRef, &p.EffectiveAt, &p.ExpiresAt, &p.SourceEventID,
		&p.CreatedAt, &p.UpdatedAt, &p.Version,
	); err != nil {
		return nil, err
	}
	return &p, nil
}
