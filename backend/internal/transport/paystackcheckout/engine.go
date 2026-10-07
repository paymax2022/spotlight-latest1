package paystackcheckout

// Engine is the SHARED card-direct mechanism for every Mobility service that
// is not instant ride-hailing (parcel first; bus/towing/car-hire/movers/event
// transport plug in later). See docs/adr/ADR-PRTBD-mobility-card-direct.md.
//
// The money contract is identical to the ride adapter in service.go:
//
//	initiate → Paystack collects (server-quoted amount, frozen) →
//	verify server-side → amount cross-check → Domain.Book (which escrows via
//	settlement.EscrowExternal — NEVER a wallet debit, so NEVER the KYC-tier
//	gate) → on any failure after the charge, the charge is REFUNDED at the
//	gateway. Cancels refund through RefundExternalSettlement (gateway reversal +
//	settlement.RefundExternal), never settlement.Refund (a wallet credit).
//
// What a Domain adapter supplies is deliberately tiny (quote, find, book);
// everything that is easy to get wrong — idempotency, replay, claim/stale
// reclaim, amount and currency checks, refund ordering, webhook/poll races —
// lives here once.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

// Intent statuses. pending → processing → confirmed, or → refunding → refunded.
// A charge that cannot back a booking enters 'refunding' (recorded BEFORE the
// gateway is called); 'refunded' = the gateway accepted the refund;
// amount_mismatch / order_failed = the gateway DEFINITELY did not refund (the
// reconciler retries them); 'refunding' left behind = outcome unknown, resolved
// by gateway lookup (see refund.go, reconcile.go).
const (
	StatusPending        = "pending"
	StatusProcessing     = "processing"
	StatusConfirmed      = "confirmed"
	StatusAmountMismatch = "amount_mismatch"
	StatusOrderFailed    = "order_failed"
	// StatusRefunding: a gateway refund is IN FLIGHT (set, fenced, BEFORE the
	// gateway is called). Its outcome is unknown until verified with the gateway.
	StatusRefunding = "refunding"
	StatusRefunded  = "refunded"
)

// staleClaimAfter is how long a 'processing' claim is honoured before another
// confirmation attempt (webhook retry or status poll) may take it over. A
// crash between Claim and Mark would otherwise strand a verified, paid charge
// forever. Safe because Domain.Book is required to be idempotent.
const staleClaimAfter = 2 * time.Minute

// expectedCurrency is the only currency a Mobility card-direct charge may
// settle in. An empty gateway currency is treated as "adapter did not
// populate it" (provider.PaymentStatus doc) and tolerated; a non-empty
// mismatch is refunded.
const expectedCurrency = "NGN"

var (
	// ErrIdempotencyConflict: the Idempotency-Key was already used for a
	// DIFFERENT request (or by a different payer). Never silently re-served —
	// the caller would otherwise be charged for something they did not ask for.
	ErrIdempotencyConflict = errors.New("idempotency_conflict")
	// ErrInvalidIdempotencyKey: the key is empty/too long/has characters that
	// are unsafe inside a gateway reference and a verify URL path.
	ErrInvalidIdempotencyKey = errors.New("invalid_idempotency_key")
	// ErrUnknownDomain: no adapter registered for the domain / reference prefix.
	ErrUnknownDomain = errors.New("unknown_domain")
	// ErrServiceDisabled: this domain's initiate flag is off (new checkouts
	// refused; confirm / status / refund for money already collected stay live).
	ErrServiceDisabled = errors.New("service_disabled")
	// ErrReferenceMismatch: the gateway's verify answer was for a different
	// transaction reference than the one asked about.
	ErrReferenceMismatch = errors.New("gateway_reference_mismatch")
)

// idempotencyKeyRE bounds what may become part of a Paystack reference and the
// /transaction/verify/<reference> URL path. Paystack documents alphanumerics
// and - . = only (the domain prefix adds the single ':' separator).
var idempotencyKeyRE = regexp.MustCompile(`^[A-Za-z0-9._=-]{8,100}$`)

// Domain is the adapter a Mobility service implements to ride the shared
// engine. Everything is keyed by `idemKey`, which the engine always passes as
// the NAMESPACED key (the full Paystack reference, e.g. "parcelorder:<key>"),
// so a settlement/entity idempotency key can never collide with another
// domain's or with the wallet path's raw key.
type Domain interface {
	// Name is the stable domain id ("parcel"): stored on the intent row and
	// the key the transport.Service external-refund registry is filed under.
	Name() string
	// ReferencePrefix is the Paystack reference prefix incl. separator
	// ("parcelorder:"). Webhook routing is by this prefix. Must be unique.
	ReferencePrefix() string
	// RoutePrefix is the path under the mobility group the engine mounts
	// POST {prefix}/initiate and GET {prefix}/:reference/status on
	// ("/parcels/paystack").
	RoutePrefix() string
	// EntityIDKey is the camelCase JSON key the status response uses for the
	// booked entity id ("parcelId"), mirroring the ride adapter's "tripId".
	EntityIDKey() string
	// Quote validates the request and returns the EXACT amount (kobo) to
	// collect, from server-side pricing only. No client-supplied amount may
	// influence it. Called at initiate time; never trusted at book time.
	Quote(ctx context.Context, payerID string, request json.RawMessage) (Quoted, error)
	// Find returns the entity already booked for idemKey for this payer.
	// Used for replay and for deciding, after a failed/ambiguous Book,
	// whether a refund is safe (found ⇒ the booking exists ⇒ NEVER refund).
	Find(ctx context.Context, payerID, idemKey string) (entityID string, found bool, err error)
	// Book books the entity funded by an already-verified external charge of
	// exactly verifiedAmountKobo. Contract: (1) independently RECOMPUTE the
	// price and refuse (CodeAmountMismatch) unless it equals verifiedAmountKobo,
	// BEFORE any write; (2) escrow only via settlement.EscrowExternal — no
	// wallet debit, no tier gate; (3) idempotent on idemKey (a repeat returns
	// the existing entity, never a second one); (4) on any failure after the
	// escrow was posted, reverse it ledger-side (settlement.RefundExternal) so
	// the engine's gateway refund leaves the books balanced.
	Book(ctx context.Context, payerID string, request json.RawMessage, pricing json.RawMessage, idemKey string, verifiedAmountKobo int64) (entityID string, err error)
}

// Quoted is what Domain.Quote returns: the exact amount to collect plus the
// opaque priced inputs (route distance/duration, pricing-config snapshot, …)
// the amount was computed from. The engine freezes Pricing in the intent and
// hands it back to Domain.Book, which MUST price from it (not re-query live
// inputs) so a traffic-aware re-route or a config edit between initiate and
// confirm cannot turn a correctly-charged order into a spurious mismatch.
type Quoted struct {
	AmountKobo int64
	Pricing    json.RawMessage
}

// Intent is the stored pending-intent row (public.transport_paystack_intents).
type Intent struct {
	Domain           string
	Reference        string
	PayerID          string
	RequestJSON      json.RawMessage
	AmountKobo       int64
	IdempotencyKey   string
	Status           string
	EntityID         *string
	AuthorizationURL string
	AccessCode       string
	RefundReference  *string
	// PricingJSON is the frozen Quoted.Pricing.
	PricingJSON json.RawMessage
	// ClaimGen is the current fence value; ClaimedAt/CreatedAt drive staleness.
	ClaimGen  Fence
	ClaimedAt time.Time
	CreatedAt time.Time
	// RefundFrom is the status to restore if the gateway DEFINITELY did not
	// refund; RefundAmountKobo is the exact amount a refund was/will be issued
	// for (the COLLECTED amount on a mismatch). Both are set on entering
	// 'refunding'.
	RefundFrom       string
	RefundAmountKobo int64
	// RefundReservedKobo / RefundedKobo are the PIECE-refund counters (partial
	// refunds, partial_refund.go): reserved = in-flight + done, refunded = done.
	// The database CHECK keeps refunded <= reserved <= AmountKobo.
	RefundReservedKobo int64
	RefundedKobo       int64
}

// Fence is the ownership token of a claim: it is bumped by every Claim /
// BeginRefund, and every state write is conditional on it, so a stalled former
// owner can never overwrite the state its successor (or a terminal state) holds.
type Fence int64

// Transition is one fenced state change. It applies only if the row is still in
// From AND still carries Fence.
type Transition struct {
	From, To        string
	Fence           Fence
	EntityID        *string
	RefundReference *string
	// RefundFrom/RefundAmountKobo are recorded when To == StatusRefunding.
	RefundFrom       string
	RefundAmountKobo int64
}

// BeginRefundResult describes a successful BeginRefund.
type BeginRefundResult struct {
	Fence Fence
	// Prev is the status the row had before this call ('refunding' ⇒ a prior
	// attempt may have reached the gateway: verify before refunding again).
	Prev             string
	RefundFrom       string
	RefundAmountKobo int64
}

// Store persists intents. Implemented over pgx (PGStore) and by in-memory
// fakes in tests.
type Store interface {
	// Put inserts a pending intent; on a (domain, idempotency_key) conflict it
	// returns the EXISTING row and inserted=false.
	Put(ctx context.Context, in Intent) (existing *Intent, inserted bool, err error)
	Get(ctx context.Context, reference string) (*Intent, error)
	GetByEntity(ctx context.Context, domain, entityID string) (*Intent, error)
	SaveAuthorization(ctx context.Context, reference, authorizationURL, accessCode string) error
	// Claim atomically moves pending → processing, or takes over a
	// 'processing' row whose claim is older than staleAfter, and returns the
	// new Fence. Exactly one concurrent caller wins.
	Claim(ctx context.Context, reference string, staleAfter time.Duration) (Fence, bool, error)
	// BeginRefund atomically moves a row currently in one of `from` (or a
	// 'refunding' row older than staleAfter) to 'refunding' under a NEW fence.
	BeginRefund(ctx context.Context, reference string, from []string, staleAfter time.Duration) (*BeginRefundResult, bool, error)
	// Mark applies t iff the row is still in t.From with t.Fence; applied=false
	// (no error) means the fence was lost or the state moved on — the caller
	// must stop and re-read, never retry blindly.
	Mark(ctx context.Context, reference string, t Transition) (applied bool, err error)
	// ListForSweep returns intents in any of statuses whose last activity
	// (claimed_at, else created_at) is older than olderThan and — when
	// maxAge > 0 — created less than maxAge ago, oldest first.
	ListForSweep(ctx context.Context, statuses []string, olderThan, maxAge time.Duration, limit int) ([]Intent, error)
}

// Checkout is what the initiate endpoint returns to the client. Status is
// "pending" for a fresh/replayed-unpaid intent; for a replay of an already
// processed key it is the terminal status and AuthorizationURL is empty (the
// client should poll status instead of re-opening the gateway).
type Checkout struct {
	Reference        string `json:"reference"`
	AuthorizationURL string `json:"authorizationUrl,omitempty"`
	AccessCode       string `json:"accessCode,omitempty"`
	AmountKobo       int64  `json:"amountKobo"`
	Status           string `json:"status"`
}

// Result is the outcome of OnChargeSuccess / CheckStatus.
type Result struct {
	Reference  string
	Status     string
	EntityID   *string
	AmountKobo int64
}

// EngineGateway is the gateway slice the shared engine needs: the ride
// adapter's Gateway plus a refund LOOKUP (so an ambiguous refund reply is
// resolved by asking the gateway, never by guessing). Kept separate from
// Gateway so the ride adapter and its fakes are untouched.
type EngineGateway interface {
	Gateway
	// LookupRefund returns the refund recorded at the gateway for the
	// transaction `reference`, or (nil, nil) when none exists.
	LookupRefund(ctx context.Context, reference string) (*provider.RefundResult, error)
}

// CancelSweepResult is what one domain's cancelled-but-still-escrowed refund
// sweep did.
type CancelSweepResult struct{ Completed, Failed int }

// CancelledRefundSweeper is OPTIONAL on a Domain. A customer cancel flips the
// booking to 'cancelled' BEFORE the refund is attempted, so a failed gateway
// call (or no refunder wired at that moment) can leave a cancelled booking whose
// external settlement is still escrowed — money held for nobody. The reconciler
// asks each domain that implements this to drive those refunds through the SAME
// refund path a customer re-POST of cancel uses. minAge keeps it from racing a
// cancel that is still in flight.
type CancelledRefundSweeper interface {
	SweepCancelledRefunds(ctx context.Context, minAge time.Duration, limit int) (CancelSweepResult, error)
}

// cancelledRefundSweepBooker is the optional slice of transport.Service the
// per-service adapters use to implement CancelledRefundSweeper.
type cancelledRefundSweepBooker interface {
	SweepCancelledCardRefunds(ctx context.Context, domain string, minAge time.Duration, limit int) (transport.CancelSweepResult, error)
}

// LedgerReverser is the slice of settlement.Service the engine needs.
type LedgerReverser interface {
	SettlementReverser
	// RefundExternalByKeyPrefix reverses EVERY external settlement the charge
	// funded — the one keyed idempotencyKey and any "<idempotencyKey>:<suffix>"
	// siblings (car hire: fare + deposit) — ledger-side; nil when none exists
	// (idempotent). The single-settlement domains are unaffected: for them the
	// match is exactly the one key.
	RefundExternalByKeyPrefix(ctx context.Context, idempotencyKey, reason string) error
	GetByID(ctx context.Context, settlementID string) (*settlement.Settlement, error)
}

// Engine is the multi-domain card-direct orchestrator.
type Engine struct {
	gateway    EngineGateway
	store      Store
	settlement LedgerReverser

	callbackHosts   []string
	initiateEnabled map[string]bool // domain → initiate mounted/allowed (absent = true)

	// Partial (piece) refunds — see partial_refund.go. Nil until
	// EnablePartialRefunds: a domain that needs them then fails CLOSED.
	partialGW    PartialGateway
	partialStore PartialRefundStore
	partialLag   time.Duration // 0 = defaultPartialLagBound

	mu       sync.RWMutex
	domains  map[string]Domain // by Name
	prefixes []Domain          // registration order, for prefix routing
}

func NewEngine(gateway EngineGateway, store Store, settlement LedgerReverser) *Engine {
	return &Engine{gateway: gateway, store: store, settlement: settlement, domains: map[string]Domain{}, initiateEnabled: map[string]bool{}}
}

// SetCallbackHosts sets the exact hostnames a client-supplied callback_url may
// point at (https only). Anything else is DROPPED (Paystack then uses the
// dashboard default) — never forwarded: an attacker-chosen redirect target on a
// genuine Paystack checkout page is a phishing primitive.
func (e *Engine) SetCallbackHosts(hosts ...string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.callbackHosts = append([]string(nil), hosts...)
}

// SetInitiateEnabled turns a domain's INITIATE on/off (default on). Off keeps
// the domain registered — confirmer, status route and refunder stay live for
// money already collected — and only refuses new checkouts.
func (e *Engine) SetInitiateEnabled(domainName string, enabled bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.initiateEnabled[domainName] = enabled
}

// Register adds a domain adapter. Panics on a duplicate name or an
// overlapping reference prefix: both are wiring bugs that would mis-route
// money, and must fail at boot, not at 2am.
func (e *Engine) Register(d Domain) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if d.Name() == "" || d.ReferencePrefix() == "" || !strings.HasSuffix(d.ReferencePrefix(), ":") {
		panic("paystackcheckout: domain needs a name and a ':'-terminated reference prefix")
	}
	if _, dup := e.domains[d.Name()]; dup {
		panic("paystackcheckout: duplicate domain " + d.Name())
	}
	for _, o := range e.prefixes {
		if strings.HasPrefix(o.ReferencePrefix(), d.ReferencePrefix()) || strings.HasPrefix(d.ReferencePrefix(), o.ReferencePrefix()) {
			panic("paystackcheckout: overlapping reference prefix " + d.ReferencePrefix() + " vs " + o.ReferencePrefix())
		}
	}
	e.domains[d.Name()] = d
	e.prefixes = append(e.prefixes, d)
}

// HasDomain reports whether a domain adapter is registered under name (wiring tests).
func (e *Engine) HasDomain(name string) bool {
	_, ok := e.domain(name)
	return ok
}

func (e *Engine) domain(name string) (Domain, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	d, ok := e.domains[name]
	return d, ok
}

func (e *Engine) domainForReference(reference string) (Domain, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, d := range e.prefixes {
		if strings.HasPrefix(reference, d.ReferencePrefix()) {
			return d, true
		}
	}
	return nil, false
}

// Prefixes lists the registered reference prefixes (webhook wiring).
func (e *Engine) Prefixes() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]string, 0, len(e.prefixes))
	for _, d := range e.prefixes {
		out = append(out, d.ReferencePrefix())
	}
	return out
}

// terminal reports whether the confirm flow has nothing left to do for status:
// anything other than pending/processing is either finished or owned by the
// refund machinery ('refunding'), never re-claimed by a confirmer.
func terminal(status string) bool {
	return status != StatusPending && status != StatusProcessing
}

// canonicalJSON re-marshals through a generic value so key order and
// whitespace never make two semantically identical requests look different.
func canonicalJSON(raw json.RawMessage) (json.RawMessage, error) {
	var v any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return json.Marshal(v)
}

// freezeRequest drops the gateway-only fields (email, callback_url) and any
// client-sent amount-ish field is irrelevant (Quote ignores them) but is also
// dropped so the frozen row never suggests one was honoured.
func freezeRequest(raw json.RawMessage) (json.RawMessage, error) {
	var m map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil || m == nil {
		return nil, fmt.Errorf("request body must be a JSON object")
	}
	for _, k := range []string{"email", "callback_url", "amount", "amount_kobo", "idempotency_key"} {
		delete(m, k)
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return canonicalJSON(b)
}

// Initiate starts (or idempotently replays) a checkout. body is the raw
// client request; the engine strips gateway-only fields, asks the domain for
// the server-side quote, freezes both, then initializes the gateway
// transaction.
func (e *Engine) Initiate(ctx context.Context, domainName, payerID string, body json.RawMessage, idemKey, email, callbackURL string) (*Checkout, error) {
	if payerID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(idemKey) == "" {
		return nil, ErrIdempotencyRequired
	}
	if !idempotencyKeyRE.MatchString(idemKey) {
		return nil, ErrInvalidIdempotencyKey
	}
	d, ok := e.domain(domainName)
	if !ok {
		return nil, ErrUnknownDomain
	}
	frozen, err := freezeRequest(body)
	if err != nil {
		return nil, transport.NewCodedError(http.StatusBadRequest, "invalid_input", err.Error())
	}
	callbackURL = e.sanitizeCallbackURL(callbackURL)
	reference := d.ReferencePrefix() + idemKey

	// Replay first: an existing intent must be answered from what was
	// FROZEN, never re-quoted (pricing may have moved) and never re-charged.
	// A replay is served even when the service's initiate flag is off — the
	// customer may be mid-payment on a checkout that was legitimately opened.
	probe, perr := e.store.Get(ctx, reference)
	if perr == nil && probe != nil {
		return e.replay(ctx, probe, payerID, frozen, email, callbackURL, idemKey)
	}
	if !e.initiateAllowed(d.Name()) {
		return nil, ErrServiceDisabled
	}

	q, err := d.Quote(ctx, payerID, frozen)
	if err != nil {
		return nil, err
	}
	amount := q.AmountKobo
	if amount <= 0 {
		// A zero/negative quote is a pricing-configuration fault, not a server
		// crash: surface a coded 4xx the client can act on (L-d).
		log.Printf("[transport/paystackcheckout] domain %s quoted a non-positive amount %d — refusing checkout", d.Name(), amount)
		return nil, transport.NewCodedError(http.StatusUnprocessableEntity, "invalid_quote",
			"This service cannot be priced right now. Please try again later.")
	}
	existing, inserted, err := e.store.Put(ctx, Intent{
		Domain: d.Name(), Reference: reference, PayerID: payerID, RequestJSON: frozen,
		AmountKobo: amount, IdempotencyKey: idemKey, Status: StatusPending, PricingJSON: q.Pricing,
	})
	if err != nil {
		return nil, err
	}
	if !inserted && existing != nil { // lost a race with a concurrent initiate
		return e.replay(ctx, existing, payerID, frozen, email, callbackURL, idemKey)
	}
	return e.initializeGateway(ctx, &Intent{Reference: reference, AmountKobo: amount, Status: StatusPending}, email, callbackURL, idemKey, false)
}

func (e *Engine) initiateAllowed(domainName string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.initiateAllowedLocked(domainName)
}

// initiateAllowedLocked requires e.mu held (read or write).
func (e *Engine) initiateAllowedLocked(domainName string) bool {
	if v, ok := e.initiateEnabled[domainName]; ok {
		return v
	}
	return true
}

// sanitizeCallbackURL forwards a client-supplied callback_url to the gateway
// only if it is https, carries no userinfo, uses the default port and its host
// is on the configured allowlist (SetCallbackHosts). Anything else is dropped
// (returned empty): an attacker-chosen post-payment redirect on a genuine
// Paystack page is a phishing primitive.
func (e *Engine) sanitizeCallbackURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return ""
	}
	if p := u.Port(); p != "" && p != "443" {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, h := range e.callbackHosts {
		if host == strings.ToLower(strings.TrimSpace(h)) {
			return raw
		}
	}
	return ""
}

func (e *Engine) replay(ctx context.Context, rec *Intent, payerID string, frozen json.RawMessage, email, callbackURL, idemKey string) (*Checkout, error) {
	if rec.PayerID != payerID {
		return nil, ErrIdempotencyConflict
	}
	a, aerr := canonicalJSON(rec.RequestJSON)
	if aerr != nil || !bytes.Equal(a, frozen) {
		return nil, ErrIdempotencyConflict
	}
	if rec.Status != StatusPending {
		return &Checkout{Reference: rec.Reference, AmountKobo: rec.AmountKobo, Status: rec.Status}, nil
	}
	if rec.AuthorizationURL != "" {
		return &Checkout{Reference: rec.Reference, AuthorizationURL: rec.AuthorizationURL, AccessCode: rec.AccessCode, AmountKobo: rec.AmountKobo, Status: StatusPending}, nil
	}
	return e.initializeGateway(ctx, rec, email, callbackURL, idemKey, true)
}

// ErrAuthorizationUnavailable code: the gateway transaction exists but its
// checkout URL was never persisted (store failure at initiate), and Paystack
// refuses to initialize the same reference twice. The customer must start a new
// checkout (new Idempotency-Key). Money is NOT at risk: if they already paid,
// the reference still confirms by webhook / poll / sweeper.
const codeAuthorizationUnavailable = "authorization_unavailable"

func (e *Engine) initializeGateway(ctx context.Context, rec *Intent, email, callbackURL, idemKey string, replay bool) (*Checkout, error) {
	resp, err := e.gateway.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email: email, AmountKobo: rec.AmountKobo, Reference: rec.Reference,
		CallbackURL: callbackURL, IdempotencyKey: idemKey,
	})
	if err != nil {
		if replay && strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return nil, transport.NewCodedError(http.StatusConflict, codeAuthorizationUnavailable,
				"This checkout can no longer be re-opened. Start a new checkout; if you already paid, your payment will be confirmed automatically.")
		}
		return nil, err
	}
	if resp.Reference != "" && resp.Reference != rec.Reference {
		// The frozen row is keyed on OUR reference; a gateway that rewrote it
		// would orphan the charge from its intent. Refuse rather than guess.
		return nil, fmt.Errorf("paystackcheckout: gateway returned reference %q, expected %q", resp.Reference, rec.Reference)
	}
	// The stored URL is the only way to re-serve this checkout (Paystack
	// refuses a second initialize of the same reference), so a transient store
	// failure is retried; a persistent one still returns the URL — the customer
	// can pay and the reference confirms by lookup — and a later replay gets the
	// recoverable authorization_unavailable answer.
	var serr error
	for attempt := 0; attempt < 3; attempt++ {
		if serr = e.store.SaveAuthorization(ctx, rec.Reference, resp.AuthorizationURL, resp.AccessCode); serr == nil {
			break
		}
		time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
	}
	if serr != nil {
		log.Printf("[transport/paystackcheckout] save authorization failed for %s after retries: %v — replay will answer %s", rec.Reference, serr, codeAuthorizationUnavailable)
	}
	return &Checkout{Reference: rec.Reference, AuthorizationURL: resp.AuthorizationURL, AccessCode: resp.AccessCode, AmountKobo: rec.AmountKobo, Status: StatusPending}, nil
}

// claimWindow bounds everything a claim owner does to the stale-claim window,
// so an owner can never still be working when its successor takes over: each
// phase gets min(its own budget, time left before claim+staleClaimAfter).
type claimWindow struct {
	base     context.Context
	deadline time.Time
}

func newClaimWindow(ctx context.Context) *claimWindow {
	// Detached from the caller's cancellation (a webhook's 10s handler timeout
	// or a disconnected poll must not abort a money step half way) but bounded.
	return &claimWindow{base: context.WithoutCancel(ctx), deadline: time.Now().Add(staleClaimAfter - 5*time.Second)}
}

func (w *claimWindow) phase(budget time.Duration) (context.Context, context.CancelFunc) {
	d := time.Now().Add(budget)
	if d.After(w.deadline) {
		d = w.deadline
	}
	return context.WithDeadline(w.base, d)
}

// OnChargeSuccess confirms a charge: called by the shared Paystack webhook
// (by reference prefix) AND by CheckStatus (self-heal) AND by the reconciler.
// Safe to call any number of times, concurrently.
func (e *Engine) OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (*Result, error) {
	rec, err := e.store.Get(ctx, reference)
	if err != nil || rec == nil {
		return nil, ErrUnknownReference
	}
	d, ok := e.domain(rec.Domain)
	if !ok {
		return nil, ErrUnknownDomain
	}
	if rec.Status != StatusPending && rec.Status != StatusProcessing {
		return resultOf(rec), nil // confirmed / refunding / refunded / failed: nothing to claim
	}

	status, err := e.gateway.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrVerifyUnavailable, err)
	}
	if status != nil && status.Reference != reference {
		// A verify answer about a DIFFERENT transaction must never confirm (or
		// refund) this intent — even if its status/amount happen to look right.
		return nil, fmt.Errorf("%w: asked for %q, gateway answered for %q", ErrReferenceMismatch, reference, status.Reference)
	}
	if status == nil || strings.ToLower(status.Status) != "success" {
		return nil, ErrChargeNotSuccessful
	}

	fence, claimed, err := e.store.Claim(ctx, reference, staleClaimAfter)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return e.currentResult(ctx, reference), nil
	}
	win := newClaimWindow(ctx)

	if status.Currency != "" && !strings.EqualFold(status.Currency, expectedCurrency) {
		return e.failAfterCharge(win, rec, d, fence, status.AmountKobo, StatusAmountMismatch, ErrAmountMismatch)
	}
	if status.AmountKobo != rec.AmountKobo {
		return e.failAfterCharge(win, rec, d, fence, status.AmountKobo, StatusAmountMismatch, ErrAmountMismatch)
	}

	bookCtx, cancel := win.phase(staleClaimAfter / 2)
	entityID, berr := d.Book(bookCtx, rec.PayerID, rec.RequestJSON, rec.PricingJSON, reference, status.AmountKobo)
	cancel()
	if berr != nil {
		// A failed Book is NOT proof nothing was booked (commit-then-error,
		// timeout after commit). Refunding a charge that backs a real booking
		// would hand the customer a free service. So: look first.
		findCtx, fcancel := win.phase(30 * time.Second)
		id, found, ferr := d.Find(findCtx, rec.PayerID, reference)
		fcancel()
		switch {
		case ferr != nil || bookInterrupted(berr):
			// Cannot tell — a Book that merely timed out / was cancelled proves
			// NOTHING (the commit may have landed after the deadline), and Find
			// "absent" right now is not proof either: it can race that commit. Leave 'processing' (the stale-claim path retries the
			// idempotent Book); do NOT refund on a guess.
			log.Printf("[transport/paystackcheckout] book failed and the outcome is unknowable for %s (domain=%s): book=%v find=%v — left processing for retry", reference, d.Name(), berr, ferr)
			return nil, fmt.Errorf("paystackcheckout: book %s: %w", d.Name(), berr)
		case found:
			entityID = id // the booking exists; fall through to confirm
		default:
			return e.failAfterCharge(win, rec, d, fence, status.AmountKobo, StatusOrderFailed,
				fmt.Errorf("paystackcheckout: book %s: %w", d.Name(), berr))
		}
	}

	markCtx, mcancel := win.phase(10 * time.Second)
	defer mcancel()
	applied, merr := e.store.Mark(markCtx, reference, Transition{From: StatusProcessing, To: StatusConfirmed, Fence: fence, EntityID: &entityID})
	switch {
	case merr != nil:
		log.Printf("[transport/paystackcheckout] mark confirmed failed for %s (entity=%s): %v — stale-claim retry will converge (Book is idempotent)", reference, entityID, merr)
	case !applied:
		// Fence lost: a successor owns (or already finished) this charge. Report
		// ITS state, never ours.
		return e.currentResult(ctx, reference), nil
	}
	return &Result{Reference: reference, Status: StatusConfirmed, EntityID: &entityID, AmountKobo: status.AmountKobo}, nil
}

// bookInterrupted reports whether a Book failed only because its context ended
// (deadline / cancellation). That says nothing about whether the booking
// committed, so it is handled exactly like a failed Find: no refund, leave the
// intent 'processing', and let the idempotent stale-claim retry converge (L-a).
func bookInterrupted(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}

func resultOf(rec *Intent) *Result {
	return &Result{Reference: rec.Reference, Status: rec.Status, EntityID: rec.EntityID, AmountKobo: rec.AmountKobo}
}

func (e *Engine) currentResult(ctx context.Context, reference string) *Result {
	if cur, err := e.store.Get(ctx, reference); err == nil && cur != nil {
		return resultOf(cur)
	}
	return &Result{Reference: reference, Status: StatusProcessing}
}

// failAfterCharge handles a verified charge that cannot back a booking: the
// customer is refunded (see refund.go) and the caller gets failErr — unless the
// claim was lost mid-way, in which case the successor's state is reported.
func (e *Engine) failAfterCharge(win *claimWindow, rec *Intent, d Domain, fence Fence, collectedKobo int64, failStatus string, failErr error) (*Result, error) {
	// An order_failed charge may have escrowed before Book failed; make the
	// ledger side balanced BEFORE the customer's money goes back. A charge that
	// failed the amount/currency check never reached Book: nothing to reverse.
	ctx, cancel := win.phase(staleClaimAfter / 2)
	defer cancel()
	switch e.refundUnbooked(ctx, rec, fence, collectedKobo, failStatus, failStatus == StatusOrderFailed) {
	case refundLost:
		return e.currentResult(ctx, rec.Reference), nil
	}
	return nil, failErr
}

// CheckStatus is the client-poll self-heal (Paystack cannot webhook a
// localhost callback, and a webhook can simply be late): a still-pending or
// stale-processing intent is driven through OnChargeSuccess.
func (e *Engine) CheckStatus(ctx context.Context, reference string) (*Result, error) {
	rec, err := e.store.Get(ctx, reference)
	if err != nil || rec == nil {
		return nil, ErrUnknownReference
	}
	if terminal(rec.Status) {
		return &Result{Reference: reference, Status: rec.Status, EntityID: rec.EntityID, AmountKobo: rec.AmountKobo}, nil
	}
	res, err := e.OnChargeSuccess(ctx, reference, reference)
	if errors.Is(err, ErrChargeNotSuccessful) || errors.Is(err, ErrVerifyUnavailable) {
		return &Result{Reference: reference, Status: StatusPending}, nil
	}
	return res, err
}

// Owner resolves which payer a reference belongs to (status-endpoint authz).
func (e *Engine) Owner(ctx context.Context, reference string) (string, error) {
	rec, err := e.store.Get(ctx, reference)
	if err != nil || rec == nil {
		return "", ErrUnknownReference
	}
	return rec.PayerID, nil
}

// ConfirmFromWebhook is the webhooks.PrefixConfirmer shape: the shared
// Paystack webhook calls it for any reference carrying a registered prefix.
func (e *Engine) ConfirmFromWebhook(ctx context.Context, reference, gatewayRef string) (any, error) {
	return e.OnChargeSuccess(ctx, reference, gatewayRef)
}

// webhookConfirmer adapts the Engine to webhooks.PrefixConfirmer.
type webhookConfirmer struct{ e *Engine }

func (c webhookConfirmer) OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (any, error) {
	return c.e.ConfirmFromWebhook(ctx, reference, gatewayRef)
}

// Confirmer returns the value to hand to
// webhooks.PaystackHandler.RegisterPrefixConfirmer.
func (e *Engine) Confirmer() interface {
	OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (any, error)
} {
	return webhookConfirmer{e}
}

// domainRefunder is the transport.ExternalRefunder for one domain.
type domainRefunder struct {
	e      *Engine
	domain string
}

// RefunderFor returns the transport.ExternalRefunder to file under
// transport.Service.SetDomainExternalRefunder(domainName, …).
func (e *Engine) RefunderFor(domainName string) transport.ExternalRefunder {
	return domainRefunder{e: e, domain: domainName}
}

// ───────────────────────── HTTP ─────────────────────────

// EngineHandler exposes initiate + status routes for every registered domain.
type EngineHandler struct{ e *Engine }

// RegisterRoutes mounts POST {RoutePrefix}/initiate and
// GET {RoutePrefix}/:reference/status for each registered domain on the
// mobility member group. Call AFTER every Register.
// RouteOption customises RegisterRoutes.
type RouteOption func(*routeOpts)

type routeOpts struct{ initiateMW []gin.HandlerFunc }

// WithInitiateMiddleware runs mw (e.g. a per-user rate limiter) in front of
// every domain's initiate route only — never the status route.
func WithInitiateMiddleware(mw ...gin.HandlerFunc) RouteOption {
	return func(o *routeOpts) { o.initiateMW = append(o.initiateMW, mw...) }
}

func (e *Engine) RegisterRoutes(group *gin.RouterGroup, opts ...RouteOption) *EngineHandler {
	h := &EngineHandler{e: e}
	o := &routeOpts{}
	for _, f := range opts {
		f(o)
	}
	if group == nil {
		return h
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, d := range e.prefixes {
		d := d
		if e.initiateAllowedLocked(d.Name()) {
			group.POST(d.RoutePrefix()+"/initiate", append(append([]gin.HandlerFunc{}, o.initiateMW...), func(c *gin.Context) { h.initiate(c, d) })...)
		}
		group.GET(d.RoutePrefix()+"/:reference/status", func(c *gin.Context) { h.status(c, d) })
	}
	return h
}

const maxInitiateBody = 64 << 10

func (h *EngineHandler) fail(c *gin.Context, err error) {
	if ce, ok := errors.AsType[*transport.CodedError](err); ok {
		c.JSON(ce.Status, ce.Body())
		return
	}
	switch {
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", keyMessage: httperr.Msg(c, http.StatusUnauthorized, err)})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", keyMessage: "Idempotency-Key is required"})
	case errors.Is(err, ErrInvalidIdempotencyKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_idempotency_key", keyMessage: "Idempotency-Key must be 8-100 characters of A-Z a-z 0-9 . _ = -"})
	case errors.Is(err, ErrIdempotencyConflict):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_conflict", keyMessage: "This Idempotency-Key was already used for a different request"})
	case errors.Is(err, ErrServiceDisabled):
		c.JSON(http.StatusNotFound, gin.H{"error": "service_disabled", keyMessage: "card checkout is not available for this service right now"})
	case errors.Is(err, ErrReferenceMismatch):
		c.JSON(http.StatusBadGateway, gin.H{"error": "gateway_reference_mismatch", keyMessage: "payment verification could not be matched to this checkout"})
	case errors.Is(err, ErrUnknownReference), errors.Is(err, ErrUnknownDomain):
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference", keyMessage: "unknown reference"})
	case errors.Is(err, ErrChargeNotSuccessful):
		c.JSON(http.StatusConflict, gin.H{"error": "charge_not_successful", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func (h *EngineHandler) initiate(c *gin.Context, d Domain) {
	u, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, maxInitiateBody+1))
	if err != nil || len(raw) > maxInitiateBody {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", keyMessage: "request body unreadable or too large"})
		return
	}
	var gw struct {
		Email       string `json:"email"`
		CallbackURL string `json:"callback_url"`
	}
	if err := json.Unmarshal(raw, &gw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", keyMessage: "request body must be a JSON object"})
		return
	}
	// Idempotency-Key is the HEADER only (money-path rule); a body key is
	// ignored by freezeRequest.
	out, err := h.e.Initiate(c.Request.Context(), d.Name(), u, raw, ginutil.IdempotencyKey(c), gw.Email, gw.CallbackURL)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *EngineHandler) status(c *gin.Context, d Domain) {
	u, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	reference := c.Param("reference")
	// A reference of another domain must not resolve through this route.
	if !strings.HasPrefix(reference, d.ReferencePrefix()) {
		h.fail(c, ErrUnknownReference)
		return
	}
	owner, err := h.e.Owner(c.Request.Context(), reference)
	if err != nil || owner != u {
		h.fail(c, ErrUnknownReference) // 404 for both: never confirm another user's reference exists
		return
	}
	res, err := h.e.CheckStatus(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	body := gin.H{"reference": res.Reference, "status": res.Status}
	if res.AmountKobo > 0 {
		body["amountKobo"] = res.AmountKobo
	}
	if res.EntityID != nil {
		body[d.EntityIDKey()] = *res.EntityID
	}
	c.JSON(http.StatusOK, gin.H{"data": body})
}
