package cryptosvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// FeeSchedule is the platform markup in basis points per crypto asset, applied per
// side (buy and sell each pay it). Defaults follow the owner's suggested pricing:
// majors 0.75%, other liquid assets 1.00%, higher-volatility / lower-liquidity assets
// 1.25-1.50% subject to risk and liquidity review. Order-book trading (0.15-0.25% total
// per executed order) is a separate fee on a later slice. It is configuration, not
// policy baked into the money path: callers store the resolved bps on each swap at
// quote time, so a later schedule change never reprices an open swap.
type FeeSchedule struct {
	// Majors are priced at MajorBps. Keys are upper-case asset codes.
	Majors map[string]struct{}
	// MajorBps / OtherBps are the base markups for majors and for every other asset.
	MajorBps, OtherBps int
	// Overrides set an explicit bps for an asset (for example a higher-volatility
	// asset at 125-150). Overrides win over both bases.
	Overrides map[string]int
	// MaxBps is a hard ceiling; a schedule or override above it is rejected.
	MaxBps int
}

// ErrFeeBps is returned for a markup outside [0, MaxBps].
var ErrFeeBps = errors.New("cryptosvc: markup bps out of range")

// DefaultFeeSchedule returns the suggested pricing.
func DefaultFeeSchedule() FeeSchedule {
	return FeeSchedule{
		Majors:   map[string]struct{}{"BTC": {}, "ETH": {}, "USDT": {}, "USDC": {}},
		MajorBps: 75,
		OtherBps: 100,
		MaxBps:   150,
	}
}

// Validate checks every configured rate against the ceiling.
func (f FeeSchedule) Validate() error {
	if f.MaxBps <= 0 {
		return fmt.Errorf("%w: MaxBps must be positive", ErrFeeBps)
	}
	for name, v := range map[string]int{"MajorBps": f.MajorBps, "OtherBps": f.OtherBps} {
		if v < 0 || v > f.MaxBps {
			return fmt.Errorf("%w: %s=%d (max %d)", ErrFeeBps, name, v, f.MaxBps)
		}
	}
	for a, v := range f.Overrides {
		if v < 0 || v > f.MaxBps {
			return fmt.Errorf("%w: override %s=%d (max %d)", ErrFeeBps, a, v, f.MaxBps)
		}
	}
	return nil
}

// Bps returns the markup for a crypto asset code. An invalid schedule fails closed
// (error) rather than quietly charging nothing or too much.
func (f FeeSchedule) Bps(asset string) (int, error) {
	if err := f.Validate(); err != nil {
		return 0, err
	}
	a := strings.ToUpper(strings.TrimSpace(asset))
	if a == "" {
		return 0, errors.New("cryptosvc: asset is required to price a fee")
	}
	if v, ok := f.Overrides[a]; ok {
		return v, nil
	}
	if _, ok := f.Majors[a]; ok {
		return f.MajorBps, nil
	}
	return f.OtherBps, nil
}

// FeeKobo returns floor(ngnKobo * bps / 10000). Flooring favours the customer on the
// last kobo and makes the split exact: fee + (ngnKobo - fee) == ngnKobo.
func FeeKobo(ngnKobo int64, bps int) (int64, error) {
	if ngnKobo <= 0 {
		return 0, errors.New("cryptosvc: fee base must be positive kobo")
	}
	if bps < 0 || bps > 10_000 {
		return 0, ErrFeeBps
	}
	fee := decimal.NewFromInt(ngnKobo).Mul(decimal.NewFromInt(int64(bps))).Div(decimal.NewFromInt(10_000)).Floor()
	if !fee.IsInteger() || fee.GreaterThan(decimal.NewFromInt(ngnKobo)) {
		return 0, errors.New("cryptosvc: fee computation out of range")
	}
	return fee.IntPart(), nil
}

// HardMaxBps is the markup ceiling. It is code, not data: the editable schedule can move rates
// anywhere in [0, HardMaxBps], but raising the ceiling is a reviewed code change.
const HardMaxBps = 150

const (
	maxFeeAssets    = 50  // majors and overrides are each bounded
	maxFeeReasonLen = 500 // the free-text reason stored with every change
)

var (
	// ErrFeeInput is returned for a malformed fee-schedule edit (bad asset code, blank reason, ...).
	ErrFeeInput = errors.New("cryptosvc: invalid fee schedule input")
	// ErrFeeVersionConflict means the writer's expected version is no longer the current one.
	ErrFeeVersionConflict = errors.New("cryptosvc: fee schedule changed since it was read")
	// ErrFeeIdempotencyConflict means an Idempotency-Key was reused with a different schedule.
	ErrFeeIdempotencyConflict = errors.New("cryptosvc: idempotency key reused with a different fee schedule")

	assetCodeRe = regexp.MustCompile(`^[A-Z0-9]{2,12}$`)
)

// FeeScheduleInput is one requested edit: a complete replacement schedule plus who, why and the
// version the editor was looking at.
type FeeScheduleInput struct {
	MajorBps, OtherBps int
	Majors             []string
	Overrides          map[string]int
	Reason             string
	Actor              string
	IdempotencyKey     string
	// ExpectedVersion is the schedule version the editor read (0 = none stored yet). A write
	// against any other version is refused so two admins cannot silently overwrite each other.
	ExpectedVersion int64
}

func normAsset(a string) string { return strings.ToUpper(strings.TrimSpace(a)) }

// normalised returns the input with asset codes upper-cased, de-duplicated and sorted and the
// reason trimmed, so two spellings of the same schedule compare equal.
func (in FeeScheduleInput) normalised() FeeScheduleInput {
	out := FeeScheduleInput{MajorBps: in.MajorBps, OtherBps: in.OtherBps, Reason: strings.TrimSpace(in.Reason)}
	seen := map[string]struct{}{}
	for _, m := range in.Majors {
		a := normAsset(m)
		if _, dup := seen[a]; !dup {
			seen[a] = struct{}{}
			out.Majors = append(out.Majors, a)
		}
	}
	sort.Strings(out.Majors)
	if len(in.Overrides) > 0 {
		out.Overrides = make(map[string]int, len(in.Overrides))
		for k, v := range in.Overrides {
			out.Overrides[normAsset(k)] = v
		}
	}
	return out
}

// Schedule validates the edit and returns the resulting schedule, capped at HardMaxBps.
func (in FeeScheduleInput) Schedule() (FeeSchedule, error) {
	switch {
	case in.ExpectedVersion < 0:
		return FeeSchedule{}, fmt.Errorf("%w: expected version must not be negative", ErrFeeInput)
	case strings.TrimSpace(in.Actor) == "":
		return FeeSchedule{}, fmt.Errorf("%w: an actor is required", ErrFeeInput)
	case strings.TrimSpace(in.Reason) == "":
		return FeeSchedule{}, fmt.Errorf("%w: a reason is required", ErrFeeInput)
	case len(strings.TrimSpace(in.Reason)) > maxFeeReasonLen:
		return FeeSchedule{}, fmt.Errorf("%w: reason is longer than %d characters", ErrFeeInput, maxFeeReasonLen)
	case len(in.Majors) > maxFeeAssets || len(in.Overrides) > maxFeeAssets:
		return FeeSchedule{}, fmt.Errorf("%w: at most %d majors and %d overrides", ErrFeeInput, maxFeeAssets, maxFeeAssets)
	}
	n := in.normalised()
	sch := FeeSchedule{MajorBps: n.MajorBps, OtherBps: n.OtherBps, MaxBps: HardMaxBps, Majors: map[string]struct{}{}, Overrides: n.Overrides}
	for _, a := range n.Majors {
		if !assetCodeRe.MatchString(a) {
			return FeeSchedule{}, fmt.Errorf("%w: %q is not an asset code", ErrFeeInput, a)
		}
		sch.Majors[a] = struct{}{}
	}
	for a := range n.Overrides {
		if !assetCodeRe.MatchString(a) {
			return FeeSchedule{}, fmt.Errorf("%w: %q is not an asset code", ErrFeeInput, a)
		}
	}
	if err := sch.Validate(); err != nil {
		return FeeSchedule{}, err
	}
	return sch, nil
}

// VersionedFees is a stored schedule with its provenance. Version 0 is the code default.
type VersionedFees struct {
	Version   int64
	Schedule  FeeSchedule
	Reason    string
	CreatedBy string
	CreatedAt time.Time
}

// asInput turns a stored schedule back into the editable shape, for comparing a replayed request.
func (v VersionedFees) asInput() FeeScheduleInput {
	in := FeeScheduleInput{MajorBps: v.Schedule.MajorBps, OtherBps: v.Schedule.OtherBps, Reason: v.Reason, Overrides: v.Schedule.Overrides}
	for m := range v.Schedule.Majors {
		in.Majors = append(in.Majors, m)
	}
	return in
}

// FeeChange is the outcome of Append.
type FeeChange struct {
	New, Old VersionedFees
	Created  bool
}

// validateStored refuses a stored schedule that could silently mis-price: a rate above the
// ceiling, or an asset code that is not in canonical upper-case form (it would never match the
// asset being quoted and that asset would quietly fall through to the other-assets rate).
func validateStored(v VersionedFees) error {
	if v.Schedule.MaxBps != HardMaxBps {
		return fmt.Errorf("%w: stored schedule ceiling is %d, want %d", ErrFeeBps, v.Schedule.MaxBps, HardMaxBps)
	}
	for m := range v.Schedule.Majors {
		if !assetCodeRe.MatchString(m) {
			return fmt.Errorf("%w: stored major %q is not a canonical asset code", ErrFeeInput, m)
		}
	}
	for a := range v.Schedule.Overrides {
		if !assetCodeRe.MatchString(a) {
			return fmt.Errorf("%w: stored override %q is not a canonical asset code", ErrFeeInput, a)
		}
	}
	return v.Schedule.Validate()
}

// FeeSource supplies the schedule quotes are priced from.
type FeeSource interface {
	// Current returns the active schedule (Version 0 and the code default when none is stored).
	Current(ctx context.Context) (VersionedFees, error)
}

// FeeStore is the editable, append-only schedule history behind the admin API.
type FeeStore interface {
	FeeSource
	// Append stores a new version AND its audit record in one atomic step, so a change can never
	// exist without its audit row. It returns ErrFeeVersionConflict when in.ExpectedVersion is not
	// the current version, and ErrFeeIdempotencyConflict when in.IdempotencyKey was used for a
	// different schedule. A repeat of the same request returns the stored row with Created=false
	// and writes nothing. Old is the version that was current under the same lock.
	Append(ctx context.Context, in FeeScheduleInput) (FeeChange, error)
	// History returns up to limit versions, newest first.
	History(ctx context.Context, limit int) ([]VersionedFees, error)
}

func overridesJSON(o map[string]int) ([]byte, error) {
	if len(o) == 0 {
		return []byte("{}"), nil
	}
	return json.Marshal(o)
}
