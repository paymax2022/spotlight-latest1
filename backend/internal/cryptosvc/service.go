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
		return fn(ctx)
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
		acct = made.ID
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

func (s *Service) to(ctx context.Context, rec SwapRecord, to cryptoprov.SwapState, reason string) {
	// Best effort: a lost conditional update means another writer already moved the swap.
	_, _ = s.cfg.Store.TransitionSwap(ctx, rec.ID, rec.State, to, decimal.Zero, reason)
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
				s.to(ctx, rec, cryptoprov.SwapStateExpired, "quote expired before confirm")
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

	if err := s.cfg.Settler.HoldBuy(ctx, in); err != nil {
		switch {
		case isHoldRefusal(err):
			s.to(ctx, rec, cryptoprov.SwapStateFailed, "hold refused: "+err.Error()) // nothing was taken
		case errors.Is(err, ErrPermanent):
			s.to(ctx, rec, cryptoprov.SwapStateNeedsReview, "hold refused permanently: "+err.Error())
		}
		return rec, err // other errors are transient: stay confirming, the caller retries
	}

	if rec.ProviderSwapID == "" {
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
			if cryptoprov.IsDefinitive(cerr) {
				// The provider refused: nothing executed, so give the money back.
				if ferr := s.cfg.Settler.FailBuy(ctx, in); ferr != nil {
					s.to(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider refused but the hold release failed: "+ferr.Error())
					return rec, errors.Join(cerr, ferr)
				}
				s.to(ctx, rec, cryptoprov.SwapStateFailed, "provider refused: "+cerr.Error())
				return rec, cerr
			}
			// Unknown outcome: the swap may have executed. Keep the hold and park it.
			s.to(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider outcome unknown: "+cerr.Error())
			return rec, cerr
		}
		if sw.ID == "" {
			s.to(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider confirm returned no swap id")
			return rec, errors.New("cryptosvc: provider confirm returned no swap id")
		}
		ok, err := s.cfg.Store.SetProviderSwapID(ctx, rec.ID, sw.ID)
		if err != nil {
			return rec, err
		}
		if !ok {
			s.to(ctx, rec, cryptoprov.SwapStateNeedsReview, "provider swap id conflicts with the recorded one")
			return rec, errors.New("cryptosvc: provider swap id conflict")
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
