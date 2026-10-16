package pricing

import (
	"math/big"

	"spotlight/backend/internal/orchestration"
)

// RoundDir is the single rounding policy: amounts the customer RECEIVES round
// DOWN, amounts they PAY round UP, at the currency's minor unit. Never half-up,
// never float.
type RoundDir int

const (
	RoundReceiveDown RoundDir = iota // receive side: floor
	RoundPayUp                       // pay side: ceil
)

const bpsDenom = 10_000

func toInt64(r *big.Int) (int64, error) {
	if !r.IsInt64() {
		return 0, ErrOverflow
	}
	return r.Int64(), nil
}

// divRound divides num/den (den > 0) with floor or ceil semantics.
func divRound(num, den *big.Int, dir RoundDir) (int64, error) {
	q, m := new(big.Int).DivMod(num, den, new(big.Int)) // Euclidean: m >= 0, so q is floor for den > 0
	if dir == RoundPayUp && m.Sign() != 0 {
		q.Add(q, big.NewInt(1))
	}
	return toInt64(q)
}

// BPSOf returns bps basis points of an integer minor amount, rounded per dir.
func BPSOf(amountMinor, bps int64, dir RoundDir) (int64, error) {
	n := new(big.Int).Mul(big.NewInt(amountMinor), big.NewInt(bps))
	return divRound(n, big.NewInt(bpsDenom), dir)
}

// ConvertMinor converts money to dst at rate (dst-major per 1 src-major), moving
// between each currency's minor-unit exponent exactly in big.Rat and rounding
// once per dir to dst's minor unit (JPY-style 0-decimal handled).
func ConvertMinor(src Money, dst string, rate *big.Rat, dir RoundDir) (Money, error) {
	if rate == nil || rate.Sign() <= 0 {
		return Money{}, ErrInvalidInput
	}
	es, ed := orchestration.MinorExponent(src.Currency), orchestration.MinorExponent(dst)
	v := new(big.Rat).SetInt64(src.AmountMinor)
	v.Mul(v, rate)
	p := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(absInt(ed-es))), nil)
	if ed >= es {
		v.Mul(v, new(big.Rat).SetInt(p))
	} else {
		v.Quo(v, new(big.Rat).SetInt(p))
	}
	out, err := divRound(v.Num(), v.Denom(), dir)
	if err != nil {
		return Money{}, err
	}
	return NewMoney(out, dst), nil
}

func absInt(i int) int {
	if i < 0 {
		return -i
	}
	return i
}

// Compute returns the L1 fee for amount: clamp(flat + ceil(pct*amount), min, max).
// The fee is a pay-side amount, so the percentage rounds UP.
func (f FeeSpec) Compute(amountMinor int64) (int64, error) {
	pct, err := BPSOf(amountMinor, f.PctBPS, RoundPayUp)
	if err != nil {
		return 0, err
	}
	fee := f.FlatMinor + pct
	if fee < f.FlatMinor { // overflow wrap
		return 0, ErrOverflow
	}
	if fee < f.MinMinor {
		fee = f.MinMinor
	}
	if f.MaxMinor != 0 && fee > f.MaxMinor {
		fee = f.MaxMinor
	}
	return fee, nil
}

// SenderTotalForTarget is the fee-on-top gross-up: the sender must pay
// S = T + flat + p*T (pay side, rounds up) for the receiver to get exactly T.
func SenderTotalForTarget(target int64, f FeeSpec) (int64, error) {
	fee, err := f.Compute(target)
	if err != nil {
		return 0, err
	}
	s := target + fee
	if s < target {
		return 0, ErrOverflow
	}
	return s, nil
}

// TargetFromSenderTotal is the sender-fixed-total gross-down: the largest
// target T (receive side, rounds down) such that T + fee(T) <= S. For a
// flat+pct fee this equals floor((S - flat)/(1+p)); with min/max clamps the
// fee is monotone so a binary search yields the exact answer.
func TargetFromSenderTotal(sendTotal int64, f FeeSpec) (int64, error) {
	if sendTotal < 0 {
		return 0, ErrInvalidInput
	}
	if f.MinMinor == 0 && f.MaxMinor == 0 {
		if sendTotal < f.FlatMinor {
			return 0, nil
		}
		n := new(big.Int).Mul(big.NewInt(sendTotal-f.FlatMinor), big.NewInt(bpsDenom))
		return divRound(n, big.NewInt(bpsDenom+f.PctBPS), RoundReceiveDown)
	}
	fee0, err := f.Compute(0)
	if err != nil || fee0 > sendTotal {
		return 0, err
	}
	lo, hi := int64(0), sendTotal // max T in [0, S] with T+fee(T) <= S
	for lo < hi {
		mid := lo + (hi-lo+1)/2
		fee, err := f.Compute(mid)
		if err != nil {
			return 0, err
		}
		if mid+fee <= sendTotal {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo, nil
}
