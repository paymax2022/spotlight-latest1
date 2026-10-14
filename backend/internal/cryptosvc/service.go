package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

var (
	// ErrIdempotencyConflict means a quote Idempotency-Key was reused with a different request.
	ErrIdempotencyConflict = errors.New("cryptosvc: idempotency key reused with a different request")
	// ErrQuoteExpired means the quote's validity window has passed; request a new quote.
	ErrQuoteExpired = errors.New("cryptosvc: quote expired")
	// ErrSwapNotFound is returned for an unknown swap or one owned by another user.
	ErrSwapNotFound = errors.New("cryptosvc: swap not found")
)

// UserDirectory supplies the identity fields a provider account needs.
type UserDirectory interface {
	UserRef(ctx context.Context, userID string) (cryptoprov.UserRef, error)
}

// TradeGate decides whether a user may trade at all (KYC tier, frozen, feature
// entitlement). A nil gate fails closed.
type TradeGate interface {
	CanTrade(ctx context.Context, userID string) error
}

// ServiceConfig wires the buy pipeline.
type ServiceConfig struct {
	Registry *cryptoprov.Registry
	Provider string
	Store    Store
	Settler  *Settler
	Ingest   *Ingest
	Fees     FeeSchedule
	// FeeSource, when set, supplies the live (editable) schedule per quote and Fees is only the
	// fallback shape; nil keeps the static Fees (unit tests). A source error or an invalid stored
	// schedule refuses the quote rather than pricing at a guess.
	FeeSource FeeSource
	Users     UserDirectory
	Gate      TradeGate
	// Locker serialises account creation and confirm per swap. Production MUST set it.
	Locker SwapLocker
	Now    func() time.Time
	// MinQuoteLife is the least remaining validity a quote must have to be offered.
	MinQuoteLife time.Duration
	// Audit records money-relevant actions (nil = none; production wiring sets it).
	Audit Auditor
}

// schedule returns the fee schedule a new quote is priced from. The bps and fee are stored on the
// swap at quote time, so a later schedule change never reprices a swap that already exists.
func (s *Service) schedule(ctx context.Context) (FeeSchedule, error) {
	if s.cfg.FeeSource == nil {
		return s.cfg.Fees, nil
	}
	v, err := s.cfg.FeeSource.Current(ctx)
	if err != nil {
		return FeeSchedule{}, fmt.Errorf("cryptosvc: read fee schedule: %w", err)
	}
	if err := validateStored(v); err != nil {
		return FeeSchedule{}, err
	}
	return v.Schedule, nil
}

// MaxQuoteKobo caps a single quote (10 bn NGN) so an absurd amount never reaches the provider
// or overflows principal + fee arithmetic. Tier limits still apply at the hold.
const MaxQuoteKobo int64 = 1_000_000_000_000

// Service is the buy (NGN -> crypto) pipeline: quote, then confirm.
//
// Confirm order is load-bearing (ADR-PR710): claim quoted->confirming, post the NGN hold
// to the ledger, and only THEN ask the provider to execute. A provider execution can never
// happen without the user's money already parked, and a hold with no execution is released.
type Service struct {
	cfg    ServiceConfig
	inproc keyedGate
}

// NewService builds the pipeline.
func NewService(cfg ServiceConfig) *Service {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MinQuoteLife <= 0 {
		cfg.MinQuoteLife = 5 * time.Second
	}
	return &Service{cfg: cfg}
}

func (s *Service) audit(ctx context.Context, actor, action, swapID, reason string, detail map[string]any) {
	if s.cfg.Audit == nil {
		return
	}
	s.cfg.Audit.Audit(ctx, AuditEvent{Actor: actor, Action: action, EntityID: swapID, Reason: reason, Detail: detail})
}

// QuoteRequest asks for a buy quote: spend NGNKobo to buy Asset.
type QuoteRequest struct {
	UserID         string
	IdempotencyKey string
	Asset          string
	NGNKobo        int64
}

func (s *Service) locked(ctx context.Context, key string, fn func(context.Context) error) error {
	if s.cfg.Locker == nil {
		// Without it, concurrent confirms and first quotes can double-act. Fail closed.
		return errors.New("cryptosvc: no locker configured; refusing to run")
	}
	// Queue identical requests in memory first: each caller blocked on the distributed lock
	// would otherwise pin one pooled connection, so one user could exhaust the lock pool.
	release, err := s.inproc.acquire(ctx, key)
	if err != nil {
		return err
	}
	defer release()
	return s.cfg.Locker.WithSwapLock(ctx, key, fn)
}

func (s *Service) gate(ctx context.Context, userID string) error {
	if s.cfg.Gate == nil {
		return errors.New("cryptosvc: no trade gate configured; refusing to trade")
	}
	return s.cfg.Gate.CanTrade(ctx, userID)
}

func (s *Service) provider() (cryptoprov.Provider, error) { return s.cfg.Registry.Get(s.cfg.Provider) }

// ensureAccount returns the user's provider account, creating it exactly once.
func (s *Service) ensureAccount(ctx context.Context, p cryptoprov.Provider, userID string) (string, error) {
	var acct string
	err := s.locked(ctx, "acct:"+userID, func(ctx context.Context) error {
		if a, ok, err := s.cfg.Store.ProviderAccount(ctx, userID, s.cfg.Provider); err != nil {
			return err
		} else if ok {
			acct = a
			return nil
		}
		ap, err := cryptoprov.As[cryptoprov.AccountProvider](p)
		if err != nil {
			return err
		}
		ref, err := s.cfg.Users.UserRef(ctx, userID)
		if err != nil {
			return fmt.Errorf("cryptosvc: look up user: %w", err)
		}
		made, err := ap.CreateAccount(ctx, ref)
		if err != nil {
			return fmt.Errorf("cryptosvc: create provider account: %w", err)
		}
		if made.ID == "" {
			return errors.New("cryptosvc: provider returned an empty account id")
		}
		if err := s.cfg.Store.SaveProviderAccount(ctx, userID, s.cfg.Provider, made.ID); err != nil {
			return err
		}
		saved, ok, err := s.cfg.Store.ProviderAccount(ctx, userID, s.cfg.Provider)
		if err != nil {
			return err
		}
		if !ok {
			return errors.New("cryptosvc: provider account not readable after save")
		}
		acct = saved // the stored id is the truth, even if another writer won
		return nil
	})
	return acct, err
}

func sameQuote(r SwapRecord, req QuoteRequest, asset string) bool {
	return r.Side == SideBuy && r.NGNKobo == req.NGNKobo && strings.EqualFold(r.ToCurrency, asset)
}

// Quote prices a buy and persists it. A repeat of the same Idempotency-Key returns the
// same quote; the same key with a different body is ErrIdempotencyConflict.
func (s *Service) Quote(ctx context.Context, req QuoteRequest) (SwapRecord, error) {
	asset := strings.ToUpper(strings.TrimSpace(req.Asset))
	switch {
	case req.UserID == "" || req.IdempotencyKey == "":
		return SwapRecord{}, errors.New("cryptosvc: user id and an Idempotency-Key are required")
	case asset == "" || asset == "NGN":
		return SwapRecord{}, errors.New("cryptosvc: a crypto asset is required")
	case req.NGNKobo <= 0:
		return SwapRecord{}, errors.New("cryptosvc: NGN amount must be positive kobo")
	case req.NGNKobo > MaxQuoteKobo:
		return SwapRecord{}, errors.New("cryptosvc: NGN amount is above the per-quote maximum")
	}
	if err := s.gate(ctx, req.UserID); err != nil {
		return SwapRecord{}, err
	}
	if prev, ok, err := s.cfg.Store.SwapByIdempotencyKey(ctx, req.UserID, req.IdempotencyKey); err != nil {
		return SwapRecord{}, err
	} else if ok {
		if !sameQuote(prev, req, asset) {
			return SwapRecord{}, ErrIdempotencyConflict
		}
		return prev, nil
	}
	fees, err := s.schedule(ctx)
	if err != nil {
		return SwapRecord{}, err
	}
	bps, err := fees.Bps(asset)
	if err != nil {
		return SwapRecord{}, err
	}
	fee, err := FeeKobo(req.NGNKobo, bps)
	if err != nil {
		return SwapRecord{}, err
	}
	p, err := s.provider()
	if err != nil {
		return SwapRecord{}, err
	}
	sp, err := cryptoprov.As[cryptoprov.SwapProvider](p)
	if err != nil {
		return SwapRecord{}, err
	}
	acct, err := s.ensureAccount(ctx, p, req.UserID)
	if err != nil {
		return SwapRecord{}, err
	}
	ngn := decimal.New(req.NGNKobo, -2)
	q, err := sp.QuoteSwap(ctx, cryptoprov.SwapQuoteRequest{AccountID: acct, From: "NGN", To: asset, FromAmount: ngn})
	if err != nil {
		return SwapRecord{}, fmt.Errorf("cryptosvc: provider quote: %w", err)
	}
	switch {
	case q.QuoteID == "":
		return SwapRecord{}, errors.New("cryptosvc: provider quote has no id")
	case !q.FromAmt.Equal(ngn):
		return SwapRecord{}, fmt.Errorf("cryptosvc: provider quoted %s NGN for a %s NGN request", q.FromAmt, ngn)
	case !q.ToAmt.IsPositive() || !q.Price.IsPositive():
		return SwapRecord{}, errors.New("cryptosvc: provider quote has a non-positive amount or price")
	case q.ExpiresAt.Before(s.cfg.Now().Add(s.cfg.MinQuoteLife)):
		return SwapRecord{}, errors.New("cryptosvc: provider quote is too close to expiry to offer")
	}
	rec, created, err := s.cfg.Store.InsertSwap(ctx, NewSwap{
		UserID: req.UserID, Provider: s.cfg.Provider, ProviderAccountID: acct, ProviderQuoteID: q.QuoteID,
		IdempotencyKey: req.IdempotencyKey, FromCurrency: "NGN", ToCurrency: asset, Side: SideBuy,
		FromAmount: ngn, QuotedToAmount: q.ToAmt, QuotedPrice: q.Price, NGNKobo: req.NGNKobo,
		FeeBps: bps, FeeKobo: fee, ExpiresAt: q.ExpiresAt,
	})
	if err != nil {
		return SwapRecord{}, err
	}
	if !created && !sameQuote(rec, req, asset) { // lost a race to a concurrent request with this key
		return SwapRecord{}, ErrIdempotencyConflict
	}
	if created {
		s.audit(ctx, req.UserID, "crypto.swap.quote", rec.ID, "", map[string]any{"asset": asset, "ngn_kobo": rec.NGNKobo, "fee_kobo": rec.FeeKobo, "fee_bps": rec.FeeBps})
	}
	return rec, nil
}

// isHoldRefusal reports a definitive refusal of the NGN hold: nothing was taken.
func isHoldRefusal(err error) bool {
	return errors.Is(err, ledger.ErrInsufficientFunds) ||
		errors.Is(err, tiers.ErrWalletDisabled) ||
		errors.Is(err, tiers.ErrDailyLimitExceeded) ||
		errors.Is(err, tiers.ErrCheckoutAllowanceExceeded)
}

// isDefiniteRefusal is an ALLOWLIST of provider answers that prove the swap did not
// execute: an explicit client-side rejection (400, 404, 422) or a rate refusal (429/444,
// which the provider rejects before executing). 401/403/408/409/425 and every 5xx or
// transport failure are ambiguous: the provider may have executed (or failed open).
func isDefiniteRefusal(err error) bool {
	var api *cryptoprov.APIError
	if !errors.As(err, &api) {
		return false
	}
	switch api.Status {
	case 400, 404, 422, 429, 444:
		return true
	}
	return false
}

// ErrOutcomeUnknown means the provider was already asked to execute and we do not know
// what happened; the swap is parked and the hold kept.
var ErrOutcomeUnknown = errors.New("cryptosvc: provider outcome unknown; swap parked for review")

// mustTo performs a state transition that has to land, on a context that survives request
// cancellation, retrying transient errors. A false return from the conditional update
// means another writer moved the swap, which is not an error here.
func (s *Service) mustTo(ctx context.Context, rec SwapRecord, to cryptoprov.SwapState, reason string) error {
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if _, err = s.cfg.Store.TransitionSwap(cctx, rec.ID, rec.State, to, decimal.Zero, reason); err == nil {
			return nil
		}
	}
	return fmt.Errorf("cryptosvc: could not move swap %s to %s: %w", rec.ID, to, err)
}

func (s *Service) reload(ctx context.Context, userID, id string) (SwapRecord, error) {
	r, ok, err := s.cfg.Store.SwapByID(ctx, userID, id)
	if err != nil {
		return SwapRecord{}, err
	}
	if !ok {
		return SwapRecord{}, ErrSwapNotFound
	}
	return r, nil
}

// Confirm executes a quoted buy. Safe to call repeatedly: each call resumes from wherever
// the last one stopped and never holds or executes twice.
func (s *Service) Confirm(ctx context.Context, userID, swapID string) (SwapRecord, error) {
	if _, err := s.reload(ctx, userID, swapID); err != nil {
		return SwapRecord{}, err
	}
	var out SwapRecord
	err := s.locked(ctx, "confirm:"+swapID, func(ctx context.Context) error {
		rec, err := s.reload(ctx, userID, swapID)
		if err != nil {
			return err
		}
		out = rec
		if rec.State == cryptoprov.SwapStateQuoted {
			if err := s.gate(ctx, userID); err != nil {
				return err
			}
			if !s.cfg.Now().Before(rec.ExpiresAt) {
				_ = s.mustTo(ctx, rec, cryptoprov.SwapStateExpired, "quote expired before confirm")
				out, _ = s.reload(ctx, userID, swapID)
				return ErrQuoteExpired
			}
			applied, err := s.cfg.Store.TransitionSwap(ctx, rec.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
			if err != nil {
				return err
			}
			if !applied {
				out, err = s.reload(ctx, userID, swapID)
				return err
			}
			rec.State = cryptoprov.SwapStateConfirming
		}
		if rec.State != cryptoprov.SwapStateConfirming {
			return nil // processing or final: nothing to execute
		}
		if rec.ProviderSwapID == "" && !rec.ExecuteAttempted {
			// Not yet at the provider: a user frozen or de-tiered since the claim stops here.
			if gerr := s.gate(ctx, userID); gerr != nil {
				// Nothing has reached the provider, so any hold already posted is safe to
				// release; otherwise a user frozen mid-confirm would be stranded.
				in := SwapLedgerInput{SwapID: rec.ID, UserID: rec.UserID, Side: SideBuy, NGNKobo: rec.NGNKobo, FeeKobo: rec.FeeKobo, FeeBps: rec.FeeBps}
				if ferr := s.cfg.Settler.FailBuy(ctx, in); ferr != nil {
					return errors.Join(gerr, ferr)
				}
				if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateFailed, "trade gate refused before execution: "+gerr.Error()); terr != nil {
					return errors.Join(gerr, terr)
				}
				return gerr
			}
		}
		out, err = s.execute(ctx, rec)
		return err
	})
	if err != nil {
		if fresh, rerr := s.reload(ctx, userID, swapID); rerr == nil {
			out = fresh
		}
		return out, err
	}
	return out, nil
}

// execute runs the confirming step: hold, then provider execution.
func (s *Service) execute(ctx context.Context, rec SwapRecord) (SwapRecord, error) {
	in := SwapLedgerInput{SwapID: rec.ID, UserID: rec.UserID, Side: SideBuy, NGNKobo: rec.NGNKobo, FeeKobo: rec.FeeKobo, FeeBps: rec.FeeBps}

	// A hold that was already released means the user was made whole (for example the
	// provider refused and only the final state write was lost). Finish the failure; never
	// resume into a provider call.
	if released, err := s.cfg.Settler.IsReleased(ctx, in); err != nil {
		return rec, err
	} else if released {
		if err := s.mustTo(ctx, rec, cryptoprov.SwapStateFailed, "hold was already released"); err != nil {
			return rec, err
		}
		return rec, fmt.Errorf("%w: swap was refused and refunded", ErrSettlementConflict)
	}

	if err := s.cfg.Settler.HoldBuy(ctx, in); err != nil {
		switch {
		case isHoldRefusal(err):
			if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateFailed, "hold refused: "+err.Error()); terr != nil { // nothing was taken
				return rec, errors.Join(err, terr)
			}
			s.audit(ctx, rec.UserID, "crypto.swap.failed", rec.ID, "hold refused", nil)
		case errors.Is(err, ErrPermanent):
			if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "hold refused permanently: "+err.Error()); terr != nil {
				return rec, errors.Join(err, terr)
			}
		}
		return rec, err // other errors are transient: stay confirming, the caller retries
	}
	s.audit(ctx, rec.UserID, "crypto.swap.hold", rec.ID, "", map[string]any{"held_kobo": rec.NGNKobo + rec.FeeKobo})

	if rec.ProviderSwapID == "" {
		// Stamp the attempt BEFORE the call. If a previous attempt already did, its outcome is
		// unknown: re-calling could execute twice, and a 4xx on the re-call would wrongly look
		// like "not executed". Park it with the hold kept.
		first, err := s.cfg.Store.MarkExecuteAttempt(ctx, rec.ID)
		if err != nil {
			return rec, err // no provider call has been made; safe to retry
		}
		if !first {
			if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "a previous provider call has an unknown outcome"); terr != nil {
				return rec, errors.Join(ErrOutcomeUnknown, terr)
			}
			s.audit(ctx, rec.UserID, "crypto.swap.parked", rec.ID, "previous provider call has an unknown outcome", map[string]any{"held_kobo": rec.NGNKobo + rec.FeeKobo})
			return rec, ErrOutcomeUnknown
		}

		p, err := s.provider()
		if err != nil {
			return rec, err
		}
		sp, err := cryptoprov.As[cryptoprov.SwapProvider](p)
		if err != nil {
			return rec, err
		}
		sw, cerr := sp.ConfirmSwap(ctx, rec.ProviderAccountID, rec.ProviderQuoteID)
		if cerr != nil {
			if isDefiniteRefusal(cerr) {
				// The provider explicitly refused: nothing executed, so give the money back.
				if ferr := s.cfg.Settler.FailBuy(ctx, in); ferr != nil {
					_ = s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider refused but the hold release failed: "+ferr.Error())
					return rec, errors.Join(cerr, ferr)
				}
				if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateFailed, "provider refused: "+cerr.Error()); terr != nil {
					return rec, errors.Join(cerr, terr)
				}
				s.audit(ctx, rec.UserID, "crypto.swap.released", rec.ID, "provider refused", map[string]any{"released_kobo": rec.NGNKobo + rec.FeeKobo})
				return rec, cerr
			}
			// Unknown outcome: the swap may have executed. Keep the hold and park it.
			if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider outcome unknown: "+cerr.Error()); terr != nil {
				return rec, errors.Join(cerr, terr)
			}
			s.audit(ctx, rec.UserID, "crypto.swap.parked", rec.ID, "provider outcome unknown", map[string]any{"held_kobo": rec.NGNKobo + rec.FeeKobo})
			return rec, cerr
		}
		if sw.ID == "" {
			_ = s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider confirm returned no swap id")
			return rec, errors.New("cryptosvc: provider confirm returned no swap id")
		}
		// The provider has executed. Recording its id must not be lost to a transient error.
		var ok bool
		var serr error
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		for attempt := 0; attempt < 3; attempt++ {
			if ok, serr = s.cfg.Store.SetProviderSwapID(sctx, rec.ID, sw.ID); serr == nil {
				break
			}
		}
		cancel()
		if serr != nil || !ok {
			reason := fmt.Sprintf("provider executed swap %s but its id could not be recorded", sw.ID)
			_ = s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, reason)
			if serr == nil {
				serr = errors.New("cryptosvc: provider swap id conflict")
			}
			return rec, fmt.Errorf("%s: %w", reason, serr)
		}
		rec.ProviderSwapID = sw.ID
		s.audit(ctx, rec.UserID, "crypto.swap.executed", rec.ID, "", nil)
	}

	if applied, err := s.cfg.Store.TransitionSwap(ctx, rec.ID, cryptoprov.SwapStateConfirming, cryptoprov.SwapStateProcessing, decimal.Zero, ""); err != nil {
		return rec, err
	} else if applied {
		rec.State = cryptoprov.SwapStateProcessing
	}
	// The provider may already have finished; settle now rather than wait for a webhook.
	if s.cfg.Ingest != nil {
		if _, err := s.cfg.Ingest.ResolveSwap(ctx, s.cfg.Provider, rec); err != nil {
			return rec, err
		}
	}
	return rec, nil
}

// ListByState returns swaps in state for the admin review surface. It is read-only: it
// delegates straight to the store and reloads or mutates nothing. The caller bounds
// limit/offset.
func (s *Service) ListByState(ctx context.Context, state cryptoprov.SwapState, limit, offset int) ([]SwapRecord, error) {
	return s.cfg.Store.ListByState(ctx, state, limit, offset)
}

// openBacklogStates are the states a swap sits in while money is held or a decision is pending,
// in the order the status view reports them.
var openBacklogStates = []cryptoprov.SwapState{
	cryptoprov.SwapStateNeedsReview, cryptoprov.SwapStateConfirming,
	cryptoprov.SwapStateProcessing, cryptoprov.SwapStateQuoted,
}

// Backlog returns one rollup per open state, zero-filled so "no swaps" is distinguishable from
// "not reported". Read-only.
func (s *Service) Backlog(ctx context.Context) ([]BacklogState, error) {
	rows, err := s.cfg.Store.Backlog(ctx)
	if err != nil {
		return nil, err
	}
	by := make(map[cryptoprov.SwapState]BacklogState, len(rows))
	for _, r := range rows {
		by[r.State] = r
	}
	out := make([]BacklogState, 0, len(openBacklogStates))
	for _, st := range openBacklogStates {
		b := by[st]
		b.State = st
		out = append(out, b)
	}
	return out, nil
}

// ResolveDecision is a human operator's choice for a swap parked in needs_review.
type ResolveDecision string

const (
	// DecisionRetry re-polls the provider and applies the authoritative outcome. Allowed ONLY
	// when a provider swap id exists — otherwise there is nothing to poll.
	DecisionRetry ResolveDecision = "retry"
	// DecisionRelease reverses the NGN hold back to the user's wallet and fails the swap. Allowed
	// ONLY when NO provider swap id exists (the provider outcome is unknown): releasing a swap the
	// provider already received could pay the user back AND deliver the crypto.
	DecisionRelease ResolveDecision = "release"
)

var (
	// ErrNotParked means the swap is not in needs_review, so there is nothing to resolve.
	ErrNotParked = errors.New("cryptosvc: swap is not parked for review")
	// ErrNothingToRetry means retry was asked for a swap with no provider swap id. There is no
	// provider state to poll; the safe action is release.
	ErrNothingToRetry = errors.New("cryptosvc: swap has no provider swap id to retry; release it instead")
	// ErrReleaseUnsafe means release was asked for a swap that has a provider swap id. The provider
	// received the swap, so retry (re-poll) is the only safe path; a blind release could double-pay.
	ErrReleaseUnsafe = errors.New("cryptosvc: swap has a provider swap id; retry instead of releasing")
	// ErrUnknownDecision means the decision was neither retry nor release.
	ErrUnknownDecision = errors.New("cryptosvc: unknown resolve decision")
)

// AdminResolve resolves a swap parked in needs_review. It is the ONLY human resolution path and
// never settles crypto we cannot prove was bought (see ADR-PR728):
//   - retry   (provider swap id present): re-poll the provider and apply the authoritative outcome,
//     which itself settles or releases through the normal ingest path.
//   - release (no provider swap id): reverse the NGN hold back to the user's wallet and fail the swap.
//
// actor identifies the operator for the audit trail; idemKey is the request's Idempotency-Key,
// recorded on the audit event; note is the mandatory operator reason. The whole decision runs
// under a per-swap lock, and both the ledger release (FailBuy) and the state transition are
// idempotent, so a repeated resolve is a no-op rather than a double credit.
func (s *Service) AdminResolve(ctx context.Context, actor, idemKey, swapID string, decision ResolveDecision, note string) (SwapRecord, error) {
	var out SwapRecord
	err := s.locked(ctx, "resolve:"+swapID, func(ctx context.Context) error {
		rec, ok, err := s.cfg.Store.SwapByIDAny(ctx, swapID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrSwapNotFound
		}
		out = rec
		if rec.State != cryptoprov.SwapStateNeedsReview {
			return ErrNotParked
		}
		switch decision {
		case DecisionRetry:
			if rec.ProviderSwapID == "" {
				return ErrNothingToRetry
			}
			if s.cfg.Ingest == nil {
				return errors.New("cryptosvc: ingest not configured")
			}
			// Re-poll first; only audit a retry that actually reached the provider.
			if _, err := s.cfg.Ingest.ResolveSwap(ctx, s.cfg.Provider, rec); err != nil {
				return err
			}
			s.audit(ctx, actor, "crypto.swap.admin_retry", rec.ID, note, map[string]any{"idempotency_key": idemKey})
		case DecisionRelease:
			if rec.ProviderSwapID != "" {
				return ErrReleaseUnsafe
			}
			in := SwapLedgerInput{SwapID: rec.ID, UserID: rec.UserID, Side: rec.Side, NGNKobo: rec.NGNKobo, FeeKobo: rec.FeeKobo, FeeBps: rec.FeeBps}
			if err := s.cfg.Settler.FailBuy(ctx, in); err != nil {
				return err
			}
			// Conditional transition: audit the release only when THIS call moved the swap, so a
			// lost race never writes a release event it did not perform.
			applied, terr := s.cfg.Store.TransitionSwap(ctx, rec.ID, cryptoprov.SwapStateNeedsReview, cryptoprov.SwapStateFailed, decimal.Zero, "admin release: "+note)
			if terr != nil {
				return terr
			}
			if applied {
				s.audit(ctx, actor, "crypto.swap.admin_release", rec.ID, note, map[string]any{"released_kobo": rec.NGNKobo + rec.FeeKobo, "idempotency_key": idemKey})
			}
		default:
			return ErrUnknownDecision
		}
		return nil
	})
	if err == nil {
		// Return the post-mutation view; a reload failure after a successful mutation is surfaced
		// rather than returning a stale needs_review record.
		if fresh, ok, rerr := s.cfg.Store.SwapByIDAny(ctx, swapID); rerr != nil {
			return out, rerr
		} else if ok {
			out = fresh
		}
	}
	return out, err
}

// Resolve re-reads the provider and applies the authoritative state (settling the ledger).
func (s *Service) Resolve(ctx context.Context, userID, swapID string) (SwapRecord, error) {
	rec, err := s.reload(ctx, userID, swapID)
	if err != nil {
		return SwapRecord{}, err
	}
	if rec.ProviderSwapID == "" || s.cfg.Ingest == nil {
		return rec, nil
	}
	if _, err := s.cfg.Ingest.ResolveSwap(ctx, s.cfg.Provider, rec); err != nil {
		return rec, err
	}
	return s.reload(ctx, userID, swapID)
}
