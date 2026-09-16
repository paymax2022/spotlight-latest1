package tiers

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ── Checkout spend allowance for unverified accounts (ADR-043) ───────────────
//
// ADR-042 let a Tier-0 account fund its wallet by card for a purchase it is
// completing right now, under a capped allowance. That only helps if the SPEND is
// also permitted: the tier-gated modules call EnforceWalletDebitLimit, which
// refuses Tier 0 outright, so a Tier-0 customer would have been charged, credited,
// and then blocked at escrow — holding money they cannot spend and (Tier 0) cannot
// withdraw. Strictly worse than the clean "complete KYC" refusal they got before.
//
// EnforceCheckoutDebitLimit is the spend-side half. It is a SEPARATE method, not a
// relaxation of EnforceWalletDebitLimit, so that the call sites which must keep the
// strict gate cannot inherit the weaker one by accident, and so `grep` shows
// exactly which money paths run relaxed. Deliberately NOT using it:
//
//   - restaurant merchant withdrawals  — cash OUT
//   - wallet-to-wallet + bank transfers — cash OUT
//   - fractionalre subscribe / secondary — investment purchases, which warrant
//     stricter KYC than consumer spending, not looser
//
// The whole justification in ADR-042 is that a Tier-0 account cannot get value
// back out. Relaxing any cash-out path would void it.

// Checkout allowance for Tier 0. These MIRROR the top-up side in
// frontend-web/src/server/wallet/topup-gate.ts (CHECKOUT_TOPUP_MAX_SINGLE_KOBO /
// CHECKOUT_TOPUP_ALLOWANCE_KOBO). They are COMPLIANCE parameters — change them
// together, or a customer can be funded for an amount they are then unable to
// spend, which is the exact trap this file exists to close.
const (
	CheckoutMaxSingleKobo int64 = 1_000_000 // ₦10,000 per purchase
	CheckoutAllowanceKobo int64 = 2_000_000 // ₦20,000 per rolling 24h
)

// checkoutWindow matches the top-up gate's rolling window, so the amount a
// customer may be funded and the amount they may spend are measured the same way.
const checkoutWindow = 24 * time.Hour

// ErrCheckoutAllowanceExceeded is returned when an unverified account's capped
// checkout allowance would be exceeded. Distinct from ErrDailyLimitExceeded so
// handlers can tell "verify to raise your limit" from "you hit today's cap".
var ErrCheckoutAllowanceExceeded = errors.New("tiers: checkout allowance exceeded for an unverified account — complete KYC to raise it")

// WithCheckoutAllowance enables the Tier-0 checkout allowance, from
// FEATURE_CHECKOUT_TOPUP_TIER0 — the SAME flag as the top-up gate, so the funding
// side and the spending side can never be switched on independently and strand a
// customer between them.
//
// Default off: a Service built without this call refuses Tier-0 spends exactly as
// before, so an unwired call site is stricter, never looser.
func (s *Service) WithCheckoutAllowance(enabled bool) *Service {
	s.checkoutAllowance = enabled
	return s
}

// EnforceCheckoutDebitLimit gates a wallet debit that pays for a purchase the
// customer is completing now.
//
// Tier 1+ is unchanged — it delegates to EnforceWalletDebitLimit verbatim. Only
// Tier 0 differs, and only when the allowance is enabled.
//
// Fail-closed: any error reading the tier or the spend history blocks the debit.
func (s *Service) EnforceCheckoutDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	tier, err := s.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("tiers: enforce checkout limit (fail closed): %w", err)
	}
	// Everything above Tier 0 keeps the ordinary daily limits. Routing it through
	// the same method means this cannot drift from the strict gate.
	if tier != Tier0 {
		return s.EnforceWalletDebitLimit(ctx, userID, amountKobo)
	}
	// Cheap refusals first, so an obviously oversized request costs no history read.
	if err := checkoutDecision(s.checkoutAllowance, amountKobo, 0); err != nil {
		return err
	}

	used, err := s.debitedSince(ctx, userID, time.Now().UTC().Add(-checkoutWindow))
	if err != nil {
		return fmt.Errorf("tiers: get checkout window spend (fail closed): %w", err)
	}
	return checkoutDecision(s.checkoutAllowance, amountKobo, used)
}

// checkoutDecision is the whole Tier-0 rule, with the two DB reads (tier, window
// spend) already resolved by the caller. It is a real production function rather
// than logic inlined above so tests exercise THIS code — a test that re-implements
// the rule passes just as happily when the rule changes underneath it.
func checkoutDecision(enabled bool, amountKobo, usedKobo int64) error {
	if !enabled {
		return ErrWalletDisabled
	}
	if amountKobo <= 0 {
		return fmt.Errorf("tiers: checkout amount must be positive, got %d", amountKobo)
	}
	if amountKobo > CheckoutMaxSingleKobo {
		return ErrCheckoutAllowanceExceeded
	}
	// used + THIS amount, so the debit that crosses the cap is the one refused
	// rather than the one after it.
	if usedKobo+amountKobo > CheckoutAllowanceKobo {
		return ErrCheckoutAllowanceExceeded
	}
	return nil
}

// debitedSince totals wallet debits in a rolling window. getDailyDebited measures
// from midnight UTC, which would let a Tier-0 account spend a full allowance either
// side of midnight; the rolling window keeps the spend cap aligned with the funding
// cap that authorised it.
func (s *Service) debitedSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(le.amount_kobo), 0)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1
		  AND la.type = 'user_wallet'
		  AND le.type = 'DEBIT'
		  AND le.created_at >= $2`
	var total int64
	err := s.db.QueryRow(ctx, q, userID, since).Scan(&total)
	return total, err
}
