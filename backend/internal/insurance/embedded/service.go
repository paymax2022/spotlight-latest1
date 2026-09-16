package embedded

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
)

// Notifier emits user-facing notifications (cover bound / top-up offer).
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// Auditor appends an immutable audit event.
type Auditor interface {
	Audit(ctx context.Context, userID, action string, detail map[string]any)
}

// Service is the embedded-binding engine. It maps platform lifecycle events to
// catalog cover (data-driven via product_line), then runs the embedded bind saga
// REUSING the finance wallet/ledger (premium hold + release) and the gateway
// Router (provider-agnostic bind). It writes policies into the SAME
// insurance_policy table as IB0 via policy.Repository, with binding_mode=embedded
// and source_event_id set.
//
// IDEMPOTENT on source_event_id: a replayed event is a no-op. Two guards:
//  1. fast pre-check (PolicyForSourceEvent), and
//  2. the hard DB unique index uq_insurance_policy_source_event — a racing
//     duplicate Create fails and is re-resolved to the existing policy.
type Service struct {
	repo       *Repository
	policyRepo *policy.Repository
	router     *gateway.Router
	wallet     *wallet.Service
	ledger     *ledger.Service
	notify     Notifier
	audit      Auditor
}

// Deps bundles the embedded engine dependencies.
type Deps struct {
	Repo       *Repository
	PolicyRepo *policy.Repository
	Router     *gateway.Router
	Wallet     *wallet.Service
	Ledger     *ledger.Service
	Notifier   Notifier
	Auditor    Auditor
}

// NewService constructs the embedded engine.
func NewService(d Deps) *Service {
	return &Service{
		repo:       d.Repo,
		policyRepo: d.PolicyRepo,
		router:     d.Router,
		wallet:     d.Wallet,
		ledger:     d.Ledger,
		notify:     d.Notifier,
		audit:      d.Auditor,
	}
}

// Handle is the internal entrypoint the orchestrator calls from existing emit
// points (trip.started, parcel.booked, loan.disbursed, ...). It runs the embedded
// state machine end-to-end and is idempotent on ev.SourceEventID.
func (s *Service) Handle(ctx context.Context, ev EmbeddedEvent) (*Result, error) {
	if ev.SourceEventID == "" {
		return nil, fmt.Errorf("embedded: source_event_id required")
	}
	if ev.UserID == "" {
		return nil, fmt.Errorf("embedded: user_id required")
	}

	// (idempotency, guard 1) — already bound off this event? Safe no-op.
	if existingID, found, err := s.repo.PolicyForSourceEvent(ctx, ev.SourceEventID); err == nil && found {
		return &Result{State: StateActive, PolicyID: existingID, Replayed: true}, nil
	}

	// EVENT_RECEIVED → resolve cover via product_line (NO_MAPPING → no-op).
	line, ok := eventProductLine[ev.EventType]
	if !ok {
		log.Printf("[insurance][embedded] no line mapping for event %q (source=%s) — no-op", ev.EventType, ev.SourceEventID)
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

	// Create the policy row (binding_mode=embedded, source_event_id set). The
	// UNIQUE index on source_event_id is the hard idempotency guard.
	srcID := ev.SourceEventID
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
		SourceEventID:  &srcID,
	})
	if cErr != nil {
		// Racing duplicate event won the unique index — re-resolve to the winner.
		if existingID, found, gErr := s.repo.PolicyForSourceEvent(ctx, ev.SourceEventID); gErr == nil && found {
			return &Result{State: StateActive, PolicyID: existingID, Replayed: true}, nil
		}
		return nil, fmt.Errorf("embedded: create policy: %w", cErr)
	}

	idempotencyKey := "embedded:" + ev.SourceEventID
	premiumRef := "insurance:embedded_premium:" + p.ID

	// PREMIUM_HELD → idempotent debit into the provider-clearing pass-through.
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}
	_ = s.advance(ctx, p, policy.StatePendingPayment)
	if q.PremiumKobo > 0 {
		debitErr := s.wallet.Debit(ctx, ev.UserID, premiumRef, idempotencyKey+":premium", clearing.ID, q.PremiumKobo)
		if debitErr != nil && !errors.Is(debitErr, ledger.ErrDuplicate) {
			// INSUFFICIENT_FUNDS → UNCOVERED (offer top-up). Void the policy row.
			_ = s.advance(ctx, p, policy.StatePaymentFailed)
			_ = s.advance(ctx, p, policy.StateVoid)
			s.auditSafe(ctx, ev.UserID, "insurance.embedded.insufficient_funds", map[string]any{
				"policy_id": p.ID, "event": ev.EventType,
			})
			s.notifySafe(ctx, ev.UserID, "insurance.embedded.top_up",
				"We couldn't bind cover for your "+ev.EventType+" — top up your wallet to enable it.")
			return &Result{State: StateInsufficientFunds, PolicyID: p.ID, ProductCode: prod.Code, Provider: prod.Provider,
				Reason: "insufficient funds"}, nil
		}
		_ = s.policyRepo.InsertPremiumTx(ctx, policy.PremiumTx{
			PolicyID:        p.ID,
			WalletLedgerRef: premiumRef,
			IdempotencyKey:  idempotencyKey + ":premium",
			AmountKobo:      q.PremiumKobo,
			Direction:       "DEBIT",
			Status:          "posted",
		})
	}
	_ = s.advance(ctx, p, policy.StateBinding)

	// BINDING → bind at the provider (idempotent on idempotencyKey).
	bound, bErr := gw.BindPolicy(ctx, gateway.BindRequest{
		ProviderProductCode: providerProduct.Code,
		Product:             providerProduct,
		ProviderQuoteRef:    q.ProviderQuoteRef,
		Currency:            q.Currency,
		SumInsuredKobo:      sumInsured,
		PremiumKobo:         q.PremiumKobo,
		PolicyholderRef:     "ph:" + p.ID,
		IdempotencyKey:      idempotencyKey,
	})
	if bErr != nil {
		// FAILED → release the held premium → UNCOVERED.
		return s.releaseAndUncover(ctx, p, idempotencyKey, clearing.ID, q.PremiumKobo, bErr), nil
	}

	// ACTIVE → record provider ref + commission; move ACTIVE.
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
	if err := s.policyRepo.SetBound(ctx, p.ID, bound.ProviderPolicyRef, bound.Underwriter, commission, certRef, effAt, expAt, p.Version); err != nil {
		log.Printf("[insurance][embedded] WARN: bind succeeded but persist failed for policy %s: %v", p.ID, err)
		return &Result{State: StateActive, PolicyID: p.ID, ProductCode: prod.Code, Provider: prod.Provider}, nil
	}

	// Commission to the SEPARATE commission account (DR clearing → CR commission).
	if commission > 0 {
		if commAcc, cErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission); cErr == nil {
			postErr := s.ledger.PostJournal(ctx, ledger.JournalEntry{
				Reference:       "insurance:embedded_commission:" + p.ID,
				IdempotencyKey:  idempotencyKey + ":commission",
				AmountKobo:      commission,
				DebitAccountID:  clearing.ID,
				CreditAccountID: commAcc.ID,
			})
			if postErr != nil && !errors.Is(postErr, ledger.ErrDuplicate) {
				log.Printf("[insurance][embedded] WARN: commission post failed for policy %s: %v", p.ID, postErr)
			}
		}
	}

	s.auditSafe(ctx, ev.UserID, "insurance.embedded.bound", map[string]any{
		"policy_id": p.ID, "event": ev.EventType, "provider": prod.Provider, "premium": q.PremiumKobo,
	})
	s.notifySafe(ctx, ev.UserID, "insurance.embedded.active", "Cover is now active for your "+ev.EventType+".")
	return &Result{State: StateActive, PolicyID: p.ID, ProductCode: prod.Code, Provider: prod.Provider}, nil
}

// releaseAndUncover releases the held premium back to the user wallet and moves
// the policy to VOID, returning an UNCOVERED result.
func (s *Service) releaseAndUncover(ctx context.Context, p *policy.Policy, idempotencyKey, clearingAccID string, premiumKobo int64, cause error) *Result {
	_ = s.advance(ctx, p, policy.StateBindFailed)
	if premiumKobo > 0 {
		if userWallet, wErr := s.ledger.GetOrCreateUserWallet(ctx, p.PolicyholderID); wErr == nil {
			revErr := s.ledger.PostReversal(ctx, userWallet.ID, clearingAccID, premiumKobo,
				"insurance:embedded_premium_reversal:"+p.ID, idempotencyKey+":reversal")
			if revErr != nil && !errors.Is(revErr, ledger.ErrDuplicate) {
				log.Printf("[insurance][embedded] CRITICAL: premium release FAILED for policy %s: %v", p.ID, revErr)
			} else {
				_ = s.policyRepo.InsertPremiumTx(ctx, policy.PremiumTx{
					PolicyID:        p.ID,
					WalletLedgerRef: "insurance:embedded_premium_reversal:" + p.ID,
					IdempotencyKey:  idempotencyKey + ":reversal",
					AmountKobo:      premiumKobo,
					Direction:       "REVERSAL",
					Status:          "reversed",
				})
			}
		}
	}
	_ = s.advance(ctx, p, policy.StateVoid)
	s.auditSafe(ctx, p.PolicyholderID, "insurance.embedded.bind_failed", map[string]any{
		"policy_id": p.ID, "cause": cause.Error(),
	})
	s.notifySafe(ctx, p.PolicyholderID, "insurance.embedded.uncovered",
		"We couldn't bind your cover; any held premium has been released.")
	return &Result{State: StateUncovered, PolicyID: p.ID, Reason: cause.Error()}
}

// advance applies a guarded policy state change via policy.Repository and keeps
// the in-memory version in sync. Errors are logged but never fail the saga's
// money legs (the money legs are themselves idempotent + reversible).
func (s *Service) advance(ctx context.Context, p *policy.Policy, to policy.State) error {
	if err := s.policyRepo.SetState(ctx, p.ID, to, p.Version); err != nil {
		return err
	}
	p.State = to
	p.Version++
	return nil
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

// knownEvents returns the sorted set of event types the engine maps (handy for
// the internal test route's discovery + docs). Unused branches are tolerated.
func knownEvents() string {
	out := make([]string, 0, len(eventProductLine))
	for k := range eventProductLine {
		out = append(out, k)
	}
	return strings.Join(out, ",")
}
