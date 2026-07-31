// Package wallet implements the custodial trading fund's unitized-NAV accounting.
//
// This file is the PURE money math — no DB, no network, no LLM, no floats. Every
// value is an integer in NGN minor units (kobo) or in scaled fund units. All
// intermediate products go through big.Int so a large AUM or unit count can never
// silently overflow int64; on absurd magnitude the functions FAIL CLOSED (return
// 0) rather than wrapping to a wrong number. Truncation always rounds toward the
// POOL (existing unit-holders), never toward the transacting user — this is the
// standard fund anti-dilution rule and is the invariant the tests pin.
package wallet

import "math/big"

const (
	// UnitScale is the number of integer fund units that represent ONE whole
	// unit — i.e. fractional-unit precision (6 dp). A holding of UnitScale units
	// == "1.000000 units".
	UnitScale int64 = 1_000_000

	// ParNAVKobo is the NAV of ONE WHOLE unit at fund inception (before any P&L),
	// used to bootstrap the very first deposit when no units exist yet. ₦10,000.
	ParNAVKobo int64 = 1_000_000
)

// NAVPerUnitKobo returns the mark-to-market NAV of ONE WHOLE unit, in kobo:
//
//	nav = aumKobo * UnitScale / totalUnits
//
// When no units are outstanding the fund is at inception, so NAV is par. A fund
// whose AUM has gone to zero while units remain has NAV 0 (correctly worthless);
// the deposit path guards against minting at NAV 0.
func NAVPerUnitKobo(aumKobo, totalUnits int64) int64 {
	if totalUnits <= 0 {
		return ParNAVKobo
	}
	if aumKobo <= 0 {
		return 0
	}
	r := new(big.Int).Mul(big.NewInt(aumKobo), big.NewInt(UnitScale))
	r.Quo(r, big.NewInt(totalUnits))
	if !r.IsInt64() {
		return 0
	}
	nav := r.Int64()
	if nav <= 0 {
		// AUM is positive but tiny relative to units, so the truncated division
		// floored to 0. Returning 0 here would make BOTH mint and redeem refuse
		// (they reject NAV 0), freezing the pool — a griefable DoS. A fund that
		// still holds value floors NAV at 1 kobo/unit so mint/redeem stay
		// operable. (A near-zero NAV should also trip defensive-mode at the
		// service layer per the brief; this floor only stops the pure math from
		// bricking the fund.)
		return 1
	}
	return nav
}

// UnitsForCash returns the fund units minted for a cash deposit at a given NAV:
//
//	units = cashKobo * UnitScale / navPerUnitKobo   (truncated DOWN)
//
// Truncating down means a depositor never receives units worth more than their
// cash — the residual accrues to the pool, never diluting existing holders. Mint
// is refused (0) at non-positive NAV or cash, or on overflow.
func UnitsForCash(cashKobo, navPerUnitKobo int64) int64 {
	if cashKobo <= 0 || navPerUnitKobo <= 0 {
		return 0
	}
	r := new(big.Int).Mul(big.NewInt(cashKobo), big.NewInt(UnitScale))
	r.Quo(r, big.NewInt(navPerUnitKobo))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// CashForUnits returns the cash (kobo) a holding of units is worth at a given NAV
// — used both for redemption payout and mark-to-market valuation:
//
//	cash = units * navPerUnitKobo / UnitScale   (truncated DOWN)
//
// Truncating down means a redeemer is never paid more than their units are worth;
// the residual stays in the pool. Returns 0 on non-positive inputs or overflow.
func CashForUnits(units, navPerUnitKobo int64) int64 {
	if units <= 0 || navPerUnitKobo <= 0 {
		return 0
	}
	r := new(big.Int).Mul(big.NewInt(units), big.NewInt(navPerUnitKobo))
	r.Quo(r, big.NewInt(UnitScale))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// ValueOfUnits is CashForUnits — the mark-to-market kobo value of a unit holding.
// Named separately so valuation call sites read clearly vs redemption payout.
func ValueOfUnits(units, navPerUnitKobo int64) int64 { return CashForUnits(units, navPerUnitKobo) }
