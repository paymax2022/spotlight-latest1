package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"
)

// Operational controls for crypto (workplan RQ-ADM: market switch, global withdrawal pause,
// limits, maintenance banner). One versioned, append-only record: every change is a new
// version with who/why, written atomically with its audit row, and refused against a stale
// version — the same discipline as the fee schedule. Enforcement fails CLOSED: if the
// controls cannot be read, no quote, confirm or withdrawal proceeds. ADR-PR859.

// Banner is a customer-facing notice.
type Banner struct {
	Message  string `json:"message"`
	Severity string `json:"severity"` // info | warning | critical
}

// Controls is the operational state.
type Controls struct {
	TradingPaused     bool     `json:"trading_paused"`
	WithdrawalsPaused bool     `json:"withdrawals_paused"`
	DisabledAssets    []string `json:"disabled_assets"`
	// MaxQuoteKobo caps one quote's NGN value (both sides). 0 = the code ceiling MaxQuoteKobo.
	MaxQuoteKobo int64   `json:"max_quote_kobo"`
	Banner       *Banner `json:"banner,omitempty"`
}

// VersionedControls is a stored state with provenance. Version 0 is "nothing stored": all open.
type VersionedControls struct {
	Version int64
	Controls
	Reason    string
	CreatedBy string
	CreatedAt time.Time
}

// ControlsInput is one requested change: a complete replacement state.
type ControlsInput struct {
	Controls
	Reason          string
	Actor           string
	IdempotencyKey  string
	ExpectedVersion int64
}

// ControlsChange is the outcome of Append.
type ControlsChange struct {
	New, Old VersionedControls
	Created  bool
}

// ControlSource supplies the live controls.
type ControlSource interface {
	Current(ctx context.Context) (VersionedControls, error)
}

// ControlsStore is the editable history behind the admin API.
type ControlsStore interface {
	ControlSource
	// Append stores a new version and its audit row atomically. ErrControlsVersionConflict when
	// ExpectedVersion is stale; ErrControlsIdempotencyConflict when the key was used for a
	// different state; a replay returns the stored row with Created=false.
	Append(ctx context.Context, in ControlsInput) (ControlsChange, error)
	History(ctx context.Context, limit int) ([]VersionedControls, error)
}

var (
	ErrTradingPaused               = errors.New("cryptosvc: crypto trading is paused")
	ErrMarketDisabled              = errors.New("cryptosvc: this market is switched off")
	ErrAboveLimit                  = errors.New("cryptosvc: amount is above the current per-trade limit")
	ErrWithdrawalsPaused           = errors.New("cryptosvc: crypto withdrawals are paused")
	ErrControlsInput               = errors.New("cryptosvc: invalid controls")
	ErrControlsVersionConflict     = errors.New("cryptosvc: controls changed since they were read")
	ErrControlsIdempotencyConflict = errors.New("cryptosvc: idempotency key reused with different controls")
)

const (
	maxBannerLen      = 280
	maxControlsReason = 500
	maxDisabledAssets = 100
)

// normalised returns c with asset codes upper-cased, de-duplicated and sorted, and the banner
// trimmed, so two spellings of one state compare equal.
func (c Controls) normalised() Controls {
	out := c
	out.DisabledAssets = nil
	seen := map[string]struct{}{}
	for _, a := range c.DisabledAssets {
		a = normAsset(a)
		if _, dup := seen[a]; !dup {
			seen[a] = struct{}{}
			out.DisabledAssets = append(out.DisabledAssets, a)
		}
	}
	sort.Strings(out.DisabledAssets)
	if c.Banner != nil {
		b := Banner{Message: strings.TrimSpace(c.Banner.Message), Severity: strings.ToLower(strings.TrimSpace(c.Banner.Severity))}
		out.Banner = &b
	}
	return out
}

func sameControls(a, b Controls) bool {
	x, y := a.normalised(), b.normalised()
	if len(x.DisabledAssets) == 0 && len(y.DisabledAssets) == 0 {
		x.DisabledAssets, y.DisabledAssets = nil, nil
	}
	return reflect.DeepEqual(x, y)
}

// Validate checks a requested change.
func (in ControlsInput) Validate() error {
	c := in.Controls.normalised()
	reason := strings.TrimSpace(in.Reason)
	switch {
	case in.ExpectedVersion < 0:
		return fmt.Errorf("%w: expected version must not be negative", ErrControlsInput)
	case strings.TrimSpace(in.Actor) == "":
		return fmt.Errorf("%w: an actor is required", ErrControlsInput)
	case reason == "" || len(reason) > maxControlsReason:
		return fmt.Errorf("%w: a reason of 1-%d characters is required", ErrControlsInput, maxControlsReason)
	case c.MaxQuoteKobo < 0 || c.MaxQuoteKobo > MaxQuoteKobo:
		return fmt.Errorf("%w: the per-trade limit must be between 0 (default) and %d kobo", ErrControlsInput, MaxQuoteKobo)
	case len(c.DisabledAssets) > maxDisabledAssets:
		return fmt.Errorf("%w: at most %d disabled markets", ErrControlsInput, maxDisabledAssets)
	}
	for _, a := range c.DisabledAssets {
		if !assetCodeRe.MatchString(a) || a == "NGN" {
			return fmt.Errorf("%w: %q is not a crypto asset code", ErrControlsInput, a)
		}
	}
	if b := c.Banner; b != nil {
		switch {
		case b.Message == "" || len([]rune(b.Message)) > maxBannerLen:
			return fmt.Errorf("%w: a banner needs a message of 1-%d characters", ErrControlsInput, maxBannerLen)
		case b.Severity != "info" && b.Severity != "warning" && b.Severity != "critical":
			return fmt.Errorf("%w: banner severity must be info, warning or critical", ErrControlsInput)
		}
	}
	return nil
}

// AssetEnabled reports whether trading in asset is switched on.
func (c Controls) AssetEnabled(asset string) bool {
	a := normAsset(asset)
	for _, d := range c.DisabledAssets {
		if normAsset(d) == a {
			return false
		}
	}
	return true
}

// QuoteLimitKobo is the effective per-quote NGN cap.
func (c Controls) QuoteLimitKobo() int64 {
	if c.MaxQuoteKobo > 0 && c.MaxQuoteKobo < MaxQuoteKobo {
		return c.MaxQuoteKobo
	}
	return MaxQuoteKobo
}

// controls reads the live state. No source configured = all open (unit tests); a read error
// is returned so callers refuse rather than trade blind.
func (s *Service) controls(ctx context.Context) (Controls, error) {
	if s.cfg.Controls == nil {
		return Controls{}, nil
	}
	v, err := s.cfg.Controls.Current(ctx)
	if err != nil {
		return Controls{}, fmt.Errorf("cryptosvc: read operational controls: %w", err)
	}
	return v.Controls, nil
}

// tradeAllowed applies the trading pause and the market switch.
func (c Controls) tradeAllowed(asset string) error {
	if c.TradingPaused {
		return ErrTradingPaused
	}
	if !c.AssetEnabled(asset) {
		return ErrMarketDisabled
	}
	return nil
}

// WithdrawalGate returns a check other packages (the legacy withdrawal path) call before any
// payout: it refuses while withdrawals are paused and fails closed when the state is unknown.
func WithdrawalGate(src ControlSource) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		if src == nil {
			return fmt.Errorf("%w: controls are not configured", ErrWithdrawalsPaused)
		}
		v, err := src.Current(ctx)
		if err != nil {
			return fmt.Errorf("%w: controls unreadable: %v", ErrWithdrawalsPaused, err)
		}
		if v.WithdrawalsPaused {
			return ErrWithdrawalsPaused
		}
		return nil
	}
}

// TradeGateFunc is the same check for the legacy (internal-ledger) trade endpoints.
func TradeGateFunc(src ControlSource) func(ctx context.Context, asset string) error {
	return func(ctx context.Context, asset string) error {
		if src == nil {
			return fmt.Errorf("%w: controls are not configured", ErrTradingPaused)
		}
		v, err := src.Current(ctx)
		if err != nil {
			return fmt.Errorf("%w: controls unreadable: %v", ErrTradingPaused, err)
		}
		return v.tradeAllowed(asset)
	}
}
