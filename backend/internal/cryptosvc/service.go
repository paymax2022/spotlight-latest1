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
	Users    UserDirectory
	Gate     TradeGate
	// Locker serialises account creation and confirm per swap. Production MUST set it.
	Locker SwapLocker
	Now    func() time.Time
	// MinQuoteLife is the least remaining validity a quote must have to be offered.
	MinQuoteLife time.Duration
}

// Service is the buy (NGN -> crypto) pipeline: quote, then confirm.
//
// Confirm order is load-bearing (ADR-PR710): claim quoted->confirming, post the NGN hold
// to the ledger, and only THEN ask the provider to execute. A provider execution can never
// happen without the user's money already parked, and a hold with no execution is released.
type Service struct{ cfg ServiceConfig }

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
	bps, err := s.cfg.Fees.Bps(asset)
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
			if err := s.gate(ctx, userID); err != nil {
				return err
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
		case errors.Is(err, ErrPermanent):
			if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "hold refused permanently: "+err.Error()); terr != nil {
				return rec, errors.Join(err, terr)
			}
		}
		return rec, err // other errors are transient: stay confirming, the caller retries
	}

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
				return rec, cerr
			}
			// Unknown outcome: the swap may have executed. Keep the hold and park it.
			if terr := s.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider outcome unknown: "+cerr.Error()); terr != nil {
				return rec, errors.Join(cerr, terr)
			}
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
