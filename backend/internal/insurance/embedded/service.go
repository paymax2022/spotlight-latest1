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
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

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
		return nil, errors.New("embedded: source_event_id required")
	}
	if ev.UserID == "" {
		return nil, errors.New("embedded: user_id required")
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

// Register wires the internal/member embedded-engine routes. The engine is
// primarily driven by Handle() from existing emit points; these routes exist for
// testing + manual triggers.
//   - member/internal:
//     POST /embedded/events   (trigger an embedded bind; idempotent on source_event_id)
//     GET  /embedded/events   (list mapped event types)
func Register(member *gin.RouterGroup, h *Handler) {
	g := member.Group("/embedded")
	g.POST("/events", h.Trigger)
	g.GET("/events", h.KnownEvents)
}

// Handler exposes an internal/member route for exercising the embedded engine
// (testing + manual triggers). In production the engine is driven by Handle()
// called from existing platform emit points, not by this route.
type Handler struct {
	svc *Service
}

// NewHandler constructs the embedded handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Trigger (member/internal): POST /embedded/events
// body: {source_event_id, event_type, user_id?, sum_insured_kobo?, inputs?}
// For the member-authenticated variant the caller's user_id is used unless an
// admin override is supplied.
func (h *Handler) Trigger(c *gin.Context) {
	var body struct {
		SourceEventID  string         `json:"source_event_id" binding:"required"`
		EventType      string         `json:"event_type" binding:"required"`
		UserID         string         `json:"user_id"`
		SumInsuredKobo int64          `json:"sum_insured_kobo"`
		Inputs         map[string]any `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	uid := body.UserID
	if uid == "" {
		uid = ginutil.UserID(c)
	}
	if uid == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "user_id required"})
		return
	}
	res, err := h.svc.Handle(c.Request.Context(), EmbeddedEvent{
		SourceEventID:  body.SourceEventID,
		EventType:      body.EventType,
		UserID:         uid,
		SumInsuredKobo: body.SumInsuredKobo,
		Inputs:         body.Inputs,
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// KnownEvents (member/internal): GET /embedded/events — lists the mapped event
// types (discovery for clients/tests).
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
// The engine is IDEMPOTENT on source_event_id — a replayed platform event never
// double-binds (enforced by uq_insurance_policy_source_event + a pre-check).
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
	// with the same id is a safe no-op (never double-binds).
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

// Repository is the read side the embedded engine needs that IB0 did not expose:
// resolving the active EMBEDDED product for a product_line, and a fast
// source_event_id idempotency pre-check against insurance_policy. All queries are
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

// PolicyForSourceEvent returns (policyID, found) for an existing embedded policy
// bound off a source_event_id. This is the fast idempotency pre-check; the DB
// unique index (uq_insurance_policy_source_event) is the hard guard.
func (r *Repository) PolicyForSourceEvent(ctx context.Context, sourceEventID string) (string, bool, error) {
	if r.db == nil || sourceEventID == "" {
		return "", false, nil
	}
	var id string
	err := r.db.QueryRow(ctx, `
		SELECT id FROM public.insurance_policy WHERE source_event_id = $1 LIMIT 1`, sourceEventID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return id, true, nil
}
