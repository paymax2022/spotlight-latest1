package crypto

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
)

// This file adds the extended crypto money paths: asset→asset swap, the address
// allow-list, deposit-address issuance, and the withdrawal state machine. All
// reuse the existing conventions: integer minor units, Idempotency-Key on every
// money mutation, balanced double-entry cash legs on the finance ledger (never
// mint), audit on every mutation, and fail-closed object-level authorization.

// SwapQuote returns a pre-trade estimate for swapping fromUnits of asset A into
// asset B at the current quotes, net of the default spread (retained as fee).
// Display-only: the server re-prices at execution time.
func (s *Service) SwapQuote(ctx context.Context, userID, fromAssetID, toAssetID string, fromUnits int64) (*SwapQuote, error) {
	q, _, _, _, err := s.priceSwap(ctx, fromAssetID, toAssetID, fromUnits) //nolint:dogsled // tuple: quote path only
	return q, err
}

// priceSwap computes the swap economics with integer arithmetic only. It returns
// the quote plus the resolved from/to assets for reuse by Swap.
func (s *Service) priceSwap(ctx context.Context, fromAssetID, toAssetID string, fromUnits int64) (*SwapQuote, *Asset, *Asset, int, error) {
	if fromUnits <= 0 {
		return nil, nil, nil, 0, ErrBadRequest
	}
	if fromAssetID == toAssetID {
		return nil, nil, nil, 0, ErrSameAsset
	}
	from, err := s.repo.GetAsset(ctx, fromAssetID)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	to, err := s.repo.GetAsset(ctx, toAssetID)
	if err != nil {
		return nil, nil, nil, 0, err
	}
	if !from.IsActive || !to.IsActive {
		return nil, nil, nil, 0, ErrAssetInactive
	}
	fromPrice, ok := s.price.PriceKobo(ctx, from.Symbol)
	if !ok || fromPrice <= 0 {
		return nil, nil, nil, 0, ErrNotFound
	}
	toPrice, ok := s.price.PriceKobo(ctx, to.Symbol)
	if !ok || toPrice <= 0 {
		return nil, nil, nil, 0, ErrNotFound
	}

	// Indicative NGN value of the sell leg (integer kobo).
	cashKobo := cashForUnits(fromUnits, fromPrice, from.MinorUnitScale)
	if cashKobo <= 0 {
		return nil, nil, nil, 0, ErrAmountTooSmall
	}
	// Spread (fee) retained to paymax_revenue; buy leg gets cash net of spread.
	spreadBps := DefaultSwapSpreadBps
	spreadKobo := cashKobo * int64(spreadBps) / 10_000
	netCash := cashKobo - spreadKobo
	toUnits := unitsForCash(netCash, toPrice, to.MinorUnitScale)
	if toUnits <= 0 {
		return nil, nil, nil, 0, ErrAmountTooSmall
	}

	q := &SwapQuote{
		FromAssetID: from.ID, FromSymbol: from.Symbol,
		ToAssetID: to.ID, ToSymbol: to.Symbol,
		FromUnits: fromUnits, ToUnits: toUnits,
		FromPriceKobo: fromPrice, ToPriceKobo: toPrice,
		CashKobo: cashKobo, SpreadKobo: spreadKobo, SpreadBps: spreadBps,
		Source: s.price.Name(), AsOf: time.Now().UTC(),
	}
	return q, from, to, spreadBps, nil
}

// Swap executes an atomic two-leg asset→asset order. Money model (all balanced,
// nothing minted):
//   - Holdings: from-asset units DEBIT, to-asset units CREDIT (one DB tx).
//   - Cash legs (finance ledger, one idempotency envelope):
//     buy  B : wallet → escrow DEBIT     (−cashKobo gross, ONE gated journal —
//     the daily cap is evaluated once on
//     the full charge, so a cap-boundary
//     split between the buy and spread
//     legs is impossible; F-5)
//     sell A : escrow → wallet CREDIT   (+cashKobo)
//     spread : escrow → paymax_revenue   (−spreadKobo, standing-account
//     journal — no wallet debit, never
//     cap-refused)
//     Net wallet delta is zero (cashKobo = netCash + spreadKobo), so a swap needs
//     no NGN balance; the spread is retained revenue. Fail-closed: an oversell is
//     rejected by the holdings CHECK before any ledger post is finalised.
func (s *Service) Swap(ctx context.Context, userID, fromAssetID, toAssetID string, fromUnits int64, idemKey string) (*SwapOrder, error) {
	if idemKey == "" {
		return nil, ErrBadRequest
	}
	q, from, to, spreadBps, err := s.priceSwap(ctx, fromAssetID, toAssetID, fromUnits)
	if err != nil {
		return nil, err
	}

	// Replay anchor BEFORE the holdings check: the order row records LAST in
	// this flow, so a found row means every leg is durable — a completed swap
	// already consumed its from-holdings, and re-checking them would refuse a
	// convergent retry with ErrInsufficient. Identity is verified: a key held
	// by a different order fails closed, never adopts.
	if existing, err := s.repo.SwapOrderByIdem(ctx, idemKey); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.UserID != userID || existing.FromAssetID != fromAssetID || existing.ToAssetID != toAssetID {
			return nil, errors.New("crypto: swap idempotency key held by a different order")
		}
		// Re-emit the fill's audit event if it was lost (R-5): the original
		// emit runs AFTER RecordSwapFill, so a crash between them leaves a
		// filled order with no audit row — and a bare anchor return would
		// never re-emit it. Deduped on (action, entity_id) so convergent
		// replays can't duplicate the event.
		if err := s.ensureSwapAudit(ctx, existing); err != nil {
			return nil, err
		}
		return existing, nil
	}

	// Fail-closed holdings check before any movement.
	held, err := s.repo.HoldingUnits(ctx, userID, from.ID)
	if err != nil {
		return nil, err
	}
	if held < fromUnits {
		return nil, ErrInsufficient
	}

	o := SwapOrder{
		UserID: userID, FromAssetID: from.ID, FromSymbol: from.Symbol,
		ToAssetID: to.ID, ToSymbol: to.Symbol,
		FromUnits: fromUnits, ToUnits: q.ToUnits,
		FromPriceKobo: q.FromPriceKobo, ToPriceKobo: q.ToPriceKobo,
		CashKobo: q.CashKobo, SpreadKobo: q.SpreadKobo, SpreadBps: spreadBps,
		Reference: "crypto:swap:" + from.Symbol + "->" + to.Symbol, idem: idemKey,
	}

	// Tier gate (fail-closed, E2E-FIN-046): the swap's cash legs DEBIT the wallet
	// (buy B + retained spread = gross cashKobo), so the same
	// EnforceWalletDebitLimit the transfer rail applies runs BEFORE the order and
	// holdings are recorded — a refused attempt moves nothing. Skipped only when
	// the buy leg is already durably posted (led.Posted): a replay of a completed
	// swap must re-drive to the filled result, not refuse on today's usage.
	if posted, err := s.led.Posted(ctx, idemKey+":buy"); err != nil {
		return nil, err
	} else if !posted {
		if err := s.enforceDebitLimit(ctx, userID, q.CashKobo); err != nil {
			return nil, err
		}
	}

	// 1) Cash legs BEFORE the order/holdings record (F-5): a cap or balance
	//    refusal posts zero legs and records NOTHING — the old ordering
	//    recorded a 'filled' order and moved holdings first, so a refused cash
	//    leg left assets moved with no payment. Every leg is keyed on idemKey,
	//    so a crash between the legs and the order record converges on retry.
	escrow, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	revenue, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return nil, err
	}
	wallet, err := s.led.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Tombstone (R-1): if unwindSwapSell already reversed this key's :sell
	// credit, the key is permanently dead — the stale :sell legs would
	// re-verify below and let a fresh :buy post with NO proceeds to offset it
	// (the member pays cashKobo AND loses fromUnits). Refuse before any leg
	// posts; the in-tx guard in swapBuyGuard closes the same hole against a
	// concurrent unwind landing between this check and the buy commit.
	if unwound, err := s.sellUnwound(ctx, escrow.ID, idemKey, o.Reference+":sell", q.CashKobo); err != nil {
		return nil, err
	} else if unwound {
		return nil, ErrSwapUnwound
	}
	// sell A: escrow → wallet CREDIT (+cashKobo) FIRST — the swap is
	// self-funding by construction: the sale proceeds are what cover the gross
	// wallet debit below, so a member needs no NGN balance to swap. If the
	// debit is refused the credit is unwound (unwindSwapSell) — a refused swap
	// mints nothing. KNOWN EXPOSURE (R-7): a crash or kill between this commit
	// and the :buy post abandons +cashKobo on the member wallet with holdings
	// untouched — an unbacked mint recon-visible by the ":sell" key but with no
	// automated sweeper to claw it back (the error-return paths unwind; a
	// process death can't). A reaper over orphaned ":sell"-with-no-":buy" keys
	// is the documented follow-up.
	if err := s.led.Credit(ctx, userID, o.Reference+":sell", idemKey+":sell", escrow.ID, q.CashKobo); err != nil {
		if !errors.Is(err, ledger.ErrDuplicate) {
			return nil, err
		}
		if verr := s.verifySwapLeg(ctx, ledger.JournalEntry{
			Reference: o.Reference + ":sell", IdempotencyKey: idemKey + ":sell",
			AmountKobo: q.CashKobo, DebitAccountID: escrow.ID, CreditAccountID: wallet.ID,
		}); verr != nil {
			return nil, verr
		}
	}
	// buy B: wallet → escrow DEBIT for the GROSS cashKobo (net + spread), keyed
	// ":buy". F-5: the wallet charge is ONE gated journal — the daily cap and
	// the balance check are evaluated exactly once, atomically, under the
	// wallet advisory lock. The old split (:buy gated netCash, then :spread
	// gated wallet→revenue) could post :buy and then refuse :spread at the cap
	// boundary — a filled order with the spread uncollected. A single wallet
	// debit for the full amount makes that wedge impossible; the revenue split
	// below carries no wallet debit and can never be cap-refused.
	// The guard is swapBuyGuard (strict cap + the unwind tombstone evaluated
	// INSIDE the buy tx under the wallet lock, R-1): a concurrent unwind and
	// this commit serialise on the same advisory lock, so whichever wins
	// decides — a post-unwind commit attempt sees the tombstone and refuses.
	buy := ledger.JournalEntry{
		Reference:       o.Reference + ":buy",
		IdempotencyKey:  idemKey + ":buy",
		AmountKobo:      q.CashKobo,
		DebitAccountID:  wallet.ID,
		CreditAccountID: escrow.ID,
	}
	if err := s.led.PostJournalWithGuard(ctx, buy, userID,
		s.swapBuyGuard(idemKey, o.Reference+":sell", escrow.ID, q.CashKobo)); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// The duplicate claim is never proof — verify the committed legs
			// are exactly this journal before treating the debit as done.
			if verr := s.verifySwapLeg(ctx, buy); verr != nil {
				return nil, verr
			}
		} else {
			// Refused or failed — unwind the sell credit (idempotent keyed
			// reversal, identity-verified, run under the same wallet lock the
			// buy holds) so no proceeds linger on a swap that never filled.
			// unwindSwapSell no-ops when the buy journal actually committed
			// (ambiguous commit) or when the unwind already landed — and once
			// it lands, this key tombstones permanently (ErrSwapUnwound).
			if uwErr := s.unwindSwapSell(ctx, userID, idemKey, o.Reference+":sell", wallet.ID, escrow.ID, q.CashKobo); uwErr != nil {
				return nil, fmt.Errorf("crypto: unwind swap sell leg after buy refused: %w", uwErr)
			}
			return nil, err
		}
	}
	// spread: escrow → paymax_revenue (−spreadKobo). A standing-account
	// journal, not a wallet debit — it cannot be refused at the cap. A hard
	// failure leaves the spread parked in escrow and a same-key retry
	// converges; the order is never left filled with the spread unpayable.
	if q.SpreadKobo > 0 {
		spread := ledger.JournalEntry{
			Reference:       o.Reference + ":spread",
			IdempotencyKey:  idemKey + ":spread",
			AmountKobo:      q.SpreadKobo,
			DebitAccountID:  escrow.ID,
			CreditAccountID: revenue.ID,
		}
		if err := s.led.PostJournal(ctx, spread); err != nil {
			if !errors.Is(err, ledger.ErrDuplicate) {
				return nil, err
			}
			if verr := s.verifySwapLeg(ctx, spread); verr != nil {
				return nil, verr
			}
		}
	}

	// 2) Asset legs LAST: record the order + move both holdings atomically,
	//    only once every cash leg is durable. A replay is a no-op (dup →
	//    holdings untouched).
	orderID, dup, err := s.repo.RecordSwapFill(ctx, o)
	if err != nil {
		return nil, err
	}
	o.ID = orderID

	if dup {
		o.Status = "filled"
		return &o, nil
	}
	// 3) Snapshot both quotes + audit (audit failure fatal for a money mutation).
	_ = s.repo.InsertSnapshot(ctx, from.ID, q.FromPriceKobo, s.price.Name())
	_ = s.repo.InsertSnapshot(ctx, to.ID, q.ToPriceKobo, s.price.Name())
	if err := s.audit.log(ctx, userID, "crypto.swap", "crypto_swap_order", orderID, "",
		nil, map[string]any{
			"from": from.Symbol, "to": to.Symbol, "from_units": fromUnits, "to_units": q.ToUnits,
			"cash_kobo": q.CashKobo, "spread_kobo": q.SpreadKobo, "spread_bps": spreadBps,
		}); err != nil {
		return nil, err
	}
	o.Status = "filled"
	return &o, nil
}

// SwapOrders returns the caller's swap history.
func (s *Service) SwapOrders(ctx context.Context, userID string, limit, offset int) ([]SwapOrder, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.SwapOrdersForUser(ctx, userID, limit, offset)
}

// AddAddress whitelists a destination address for the caller. The address is
// validated (non-trivial length) and screened via the provider seam before it can
// be used as a withdrawal target.
func (s *Service) AddAddress(ctx context.Context, userID, assetID, label, network, address string) (*Address, error) {
	if len(trimmed(address)) < 8 {
		return nil, ErrInvalidAddress
	}
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	addr, dup, err := s.repo.AddAddress(ctx, userID, a.ID, label, network, trimmed(address))
	if err != nil {
		return nil, err
	}
	addr.Symbol = a.Symbol
	if !dup {
		_ = s.audit.log(ctx, userID, "crypto.address.add", "crypto_address", addr.ID, "",
			nil, map[string]any{"asset": a.Symbol, "network": network})
	}
	return addr, nil
}

// ListAddresses returns the caller's whitelisted addresses (optional asset filter).
func (s *Service) ListAddresses(ctx context.Context, userID, assetID string) ([]Address, error) {
	if assetID != "" {
		if a, err := s.repo.GetAsset(ctx, assetID); err == nil {
			assetID = a.ID
		}
	}
	return s.repo.ListAddresses(ctx, userID, assetID)
}

// DeleteAddress soft-removes an owned whitelisted address.
func (s *Service) DeleteAddress(ctx context.Context, userID, id string) error {
	if err := s.repo.DeleteAddress(ctx, userID, id); err != nil {
		return err
	}
	_ = s.audit.log(ctx, userID, "crypto.address.delete", "crypto_address", id, "", nil, nil)
	return nil
}

// DepositAddress returns (issuing + persisting on first request) the caller's
// deposit address for an asset. Generated deterministically via the provider seam
// so it is stable across calls.
func (s *Service) DepositAddress(ctx context.Context, userID, assetID, network string) (*DepositAddress, error) {
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	provider := "mock-custody"
	return s.repo.GetOrCreateDepositAddress(ctx, userID, a, network, provider, deriveDepositAddress)
}

// ScreenAddress runs a lightweight pre-save validation on a candidate destination
// address via the provider seam's rules (no money moved; no persistence). It is the
// same allow-list gate AddAddress applies, exposed so the client can pre-flight a
// paste before committing it to the book. Returns (risk, reason).
func (s *Service) ScreenAddress(_ context.Context, address string) (risk, reason string) {
	if len(trimmed(address)) < 8 {
		return "flagged", "This address failed validation. Check you copied the full address."
	}
	return "clear", ""
}

// WithdrawalEligibility reports whether the caller may withdraw and the operative
// limits. It is a read-only gate summary (no money moved). Crypto withdrawals are
// routed through manual compliance review for the MVP (mirrors the client rule);
// the actual state machine still enforces the whitelist + holdings at execution.
type WithdrawalEligibility struct {
	Gate                string `json:"gate"` // eligible|blocked
	ManualReviewOnly    bool   `json:"manual_review_only"`
	DailyLimitKobo      int64  `json:"daily_limit_kobo"`
	DailyUsedKobo       int64  `json:"daily_used_kobo"`
	ManualReviewMinKobo int64  `json:"manual_review_threshold_kobo"`
	Message             string `json:"message"`
}

// WithdrawalEligibilityFor returns the caller's current withdrawal gate. Daily-used
// is derived from the caller's own non-failed withdrawals today (marked at fill
// price), so the number is a projection of persisted rows — never a mutated counter.
func (s *Service) WithdrawalEligibilityFor(ctx context.Context, userID string) (*WithdrawalEligibility, error) {
	used, err := s.repo.WithdrawnKoboToday(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &WithdrawalEligibility{
		Gate:                "eligible",
		ManualReviewOnly:    true,
		DailyLimitKobo:      DefaultWithdrawDailyLimitKobo,
		DailyUsedKobo:       used,
		ManualReviewMinKobo: DefaultWithdrawReviewMinKobo,
		Message:             "Withdrawals are reviewed by compliance before broadcast.",
	}, nil
}

// WithdrawalQuote is a pre-trade preview: the in-asset network fee and the net
// amount the destination receives. Display-only; the server re-computes the fee at
// execution time (networkFeeUnits) so the quote is advisory.
type WithdrawalQuote struct {
	AssetID         string `json:"asset_id"`
	Symbol          string `json:"symbol"`
	Network         string `json:"network"`
	Units           int64  `json:"units"`
	NetworkFeeUnits int64  `json:"network_fee_units"`
	ReceiveUnits    int64  `json:"receive_units"`
	PaymaxFeeKobo   int64  `json:"paymax_fee_kobo"`
	FiatValueKobo   int64  `json:"fiat_value_kobo"`
	RequiresReview  bool   `json:"requires_review"`
}

// QuoteWithdrawal computes the fee/receive preview for a candidate withdrawal. It
// reuses the exact execution-time fee function (networkFeeUnits) so the preview and
// the fill agree. No money is moved and nothing is persisted.
func (s *Service) QuoteWithdrawal(ctx context.Context, userID, assetID, network string, units int64) (*WithdrawalQuote, error) {
	if units <= 0 {
		return nil, ErrBadRequest
	}
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if !a.IsActive {
		return nil, ErrAssetInactive
	}
	fee := networkFeeUnits(units)
	if units <= fee {
		return nil, ErrWithdrawTooSmall
	}
	priceKobo, _ := s.price.PriceKobo(ctx, a.Symbol)
	return &WithdrawalQuote{
		AssetID: a.ID, Symbol: a.Symbol, Network: network,
		Units: units, NetworkFeeUnits: fee, ReceiveUnits: units - fee,
		PaymaxFeeKobo:  DefaultWithdrawFeeKobo,
		FiatValueKobo:  cashForUnits(units, priceKobo, a.MinorUnitScale),
		RequiresReview: true,
	}, nil
}

// networkFeeUnits estimates the in-asset miner fee (0.05% of the amount, floored at
// one minor unit). Integer arithmetic only.
func networkFeeUnits(units int64) int64 {
	fee := max(
		// 0.05%
		units/2000, 1)
	return fee
}

// Withdraw opens a withdrawal against a whitelisted address and PARKS it for AML
// review. It does NOT dispatch to the provider — the broadcast is gated behind an
// admin compliance approval (see AdminDecideWithdrawal). Money model:
//   - Asset side: `units` leave the holding into the withdrawal row (parked; no mint).
//   - Fiat side: a processing fee (feeKobo) debits the wallet to paymax_revenue.
//   - State machine (member path): requested → pending_review. THE MEMBER PATH STOPS
//     HERE. Funds are parked/held and NOT sent. A compliance officer must approve
//     (pending_review → approved → broadcast) before anything leaves; a reject
//     (pending_review → failed) returns the parked units. No provider dispatch
//     happens on the member path — enforcing the AML gate before any broadcast.
//
// Requires an Idempotency-Key (replay-safe) and the destination to be an owned,
// active, whitelisted address for the same asset (allow-list enforced).
func (s *Service) Withdraw(ctx context.Context, userID, assetID, addressID string, units, feeKobo int64, idemKey string) (*Withdrawal, error) {
	if units <= 0 || idemKey == "" {
		return nil, ErrBadRequest
	}
	// The fiat processing fee is platform policy, not client input — a request
	// could otherwise pass fee_kobo=0 and skip the paymax_revenue leg entirely.
	// The parameter stays for signature compatibility but is overridden with the
	// same constant QuoteWithdrawal advertises.
	feeKobo = DefaultWithdrawFeeKobo
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if !a.IsActive {
		return nil, ErrAssetInactive
	}
	// Allow-list: the destination MUST be an owned, active address for this asset.
	addr, err := s.repo.GetAddress(ctx, userID, addressID)
	if err != nil {
		return nil, err
	}
	if addr.AssetID != a.ID {
		return nil, ErrAddressNotFound
	}
	netFee := networkFeeUnits(units)
	if units <= netFee {
		return nil, ErrWithdrawTooSmall
	}
	// Fail-closed holdings check before any movement.
	held, err := s.repo.HoldingUnits(ctx, userID, a.ID)
	if err != nil {
		return nil, err
	}
	if held < units {
		return nil, ErrInsufficient
	}
	priceKobo, _ := s.price.PriceKobo(ctx, a.Symbol)

	w := Withdrawal{
		UserID: userID, AssetID: a.ID, Symbol: a.Symbol, AddressID: addr.ID,
		Units: units, NetworkFeeUnits: netFee, FeeKobo: feeKobo, PriceKobo: priceKobo,
		Provider: s.withdraw.Name(), Reference: "crypto:withdraw:" + a.Symbol, idem: idemKey,
	}

	// Tier gate (fail-closed, E2E-FIN-046): the fiat processing fee DEBITS the
	// wallet below, and a Tier-0 wallet must not open an asset withdrawal at all,
	// so the same EnforceWalletDebitLimit the transfer rail applies runs BEFORE
	// any units are parked — a refused attempt creates no withdrawal row and
	// posts zero ledger legs. Skipped only when the fee leg is already durably
	// posted (led.Posted): a replay then falls through to the dup return below
	// instead of refusing on today's usage.
	if posted, err := s.led.Posted(ctx, idemKey+":fee"); err != nil {
		return nil, err
	} else if !posted {
		if err := s.enforceDebitLimit(ctx, userID, feeKobo); err != nil {
			return nil, err
		}
	}

	// 1) Create the withdrawal + park the units atomically (state=requested). A
	//    replay returns the existing row (dup) without re-parking or re-charging.
	wid, dup, err := s.repo.CreateWithdrawal(ctx, w)
	if err != nil {
		return nil, err
	}
	w.ID = wid
	if dup {
		return s.repo.GetWithdrawal(ctx, userID, wid)
	}

	// 2) Charge the fiat processing fee (wallet → paymax_revenue). Idempotent per
	//    suffix. Insufficient NGN fails the fee; we then fail the withdrawal and
	//    return the parked units so no state is left inconsistent.
	if feeKobo > 0 {
		revenue, rerr := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if rerr != nil {
			return nil, rerr
		}
		if ferr := s.led.DebitGated(ctx, userID, w.Reference+":fee", idemKey+":fee", revenue.ID, feeKobo); ferr != nil && !errors.Is(ferr, ledger.ErrDuplicate) {
			_, _ = s.repo.TransitionWithdrawal(ctx, userID, wid, WithdrawalRequested, WithdrawalFailed,
				userID, "fee charge failed: "+ferr.Error(), "", "", ferr.Error(), units)
			_ = s.audit.log(ctx, userID, "crypto.withdraw.failed", "crypto_withdrawal", wid, ferr.Error(), nil, nil)
			return nil, ferr
		}
	}

	// 3) requested → pending_review. THE MEMBER PATH STOPS HERE (AML gate). The units
	//    are parked and held; NOTHING is dispatched to the provider. A compliance
	//    officer must approve via AdminDecideWithdrawal before any broadcast fires.
	out, err := s.repo.TransitionWithdrawal(ctx, userID, wid, WithdrawalRequested, WithdrawalPendingReview,
		userID, "parked for AML review", "", "", "", 0)
	if err != nil {
		return nil, err
	}
	if err := s.audit.log(ctx, userID, "crypto.withdraw.requested", "crypto_withdrawal", wid, "",
		nil, map[string]any{
			"asset": a.Symbol, "units": units, "network_fee_units": netFee,
			"fee_kobo": feeKobo, "address_id": addr.ID, "status": WithdrawalPendingReview,
		}); err != nil {
		return nil, err
	}
	return out, nil
}

// broadcastApprovedWithdrawal dispatches an admin-approved withdrawal to the
// provider and advances approved → broadcast — the ONLY place the provider is
// called (admin approve path AFTER the AML gate, never the member path). A
// provider error fails the withdrawal and returns the parked units. Idempotent
// via the guarded transition + the provider's own idempotency on the key.
// TODO(crypto-worker): enqueue to an asynq worker for production so the admin
// approve call returns immediately; today it runs inline.
func (s *Service) broadcastApprovedWithdrawal(ctx context.Context, w *AdminWithdrawal) (*AdminWithdrawal, error) {
	// Provider needs the net units, the destination address + network, and a stable
	// idempotency key. Derive the provider idem key from the withdrawal id (stable).
	netUnits := w.Units - w.NetworkFeeUnits
	if netUnits <= 0 {
		netUnits = w.Units
	}
	// A real provider needs the asset's minor-unit scale to format the on-chain amount.
	// Best-effort lookup; a missing scale (0) makes a real adapter error → the withdrawal
	// safely parks in `approved` rather than sending a wrong amount.
	var scale int64
	if a, aerr := s.repo.GetAsset(ctx, w.AssetID); aerr == nil && a != nil {
		scale = a.MinorUnitScale
	}
	res, berr := s.withdraw.Broadcast(ctx, BroadcastRequest{
		WithdrawalID: w.ID, Symbol: w.Symbol, Network: w.Network, Address: w.Address,
		Units: netUnits, MinorUnitScale: scale, ProviderIdemKey: "crypto:withdraw:" + w.ID,
	})
	if berr != nil {
		// Ambiguous / transport failure. Per the WithdrawalProvider contract, KEEP the
		// withdrawal in `approved` (parked) for retry / manual reconciliation — do NOT
		// return the parked units (the provider may have already accepted the send, so
		// refunding would double-spend) and do NOT fabricate a broadcast. The guarded
		// approved→broadcast transition makes a later retry idempotent.
		_ = s.audit.log(ctx, "custody:"+s.withdraw.Name(), "crypto.withdraw.broadcast_error",
			"crypto_withdrawal", w.ID, berr.Error(), nil,
			map[string]any{"asset": w.Symbol, "units": w.Units})
		return nil, berr
	}
	if !res.Accepted {
		// Explicit provider rejection: the provider definitively did NOT send (e.g. failed
		// custodian-side address screening) → move to failed and return the parked units.
		reason := "provider rejected withdrawal"
		out, terr := s.repo.AdminTransitionWithdrawal(ctx, w.ID, WithdrawalApproved, WithdrawalFailed,
			"custody:"+s.withdraw.Name(), reason, reason, w.Units)
		if terr != nil {
			return nil, terr
		}
		_ = s.audit.log(ctx, "custody:"+s.withdraw.Name(), "crypto.withdraw.failed", "crypto_withdrawal", w.ID, reason,
			nil, map[string]any{"asset": w.Symbol, "units": w.Units})
		return out, nil
	}

	out, err := s.repo.AdminTransitionWithdrawalProvider(ctx, w.ID, WithdrawalApproved, WithdrawalBroadcast,
		"custody:"+s.withdraw.Name(), "submitted to provider", res.ProviderRef, res.TxHash)
	if err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, "custody:"+s.withdraw.Name(), "crypto.withdraw.broadcast", "crypto_withdrawal", w.ID, "",
		nil, map[string]any{
			"asset": w.Symbol, "units": w.Units, "provider_ref": res.ProviderRef, "tx_hash": res.TxHash,
		})
	return out, nil
}

// ConfirmWithdrawal advances a broadcast withdrawal to confirmed (parked units are
// burned — sent on-chain). This is the reconciliation-worker / provider-webhook
// seam; exposed as an owner-driven action here for the mock. Idempotent: a
// double-confirm is rejected by the guarded transition.
func (s *Service) ConfirmWithdrawal(ctx context.Context, userID, id, txHash string) (*Withdrawal, error) {
	out, err := s.repo.TransitionWithdrawal(ctx, userID, id, WithdrawalBroadcast, WithdrawalConfirmed,
		userID, "confirmed on-chain", "", txHash, "", 0)
	if err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, userID, "crypto.withdraw.confirmed", "crypto_withdrawal", id, "",
		nil, map[string]any{"tx_hash": txHash})
	return out, nil
}

// GetWithdrawal returns an owned withdrawal (object-level authZ).
func (s *Service) GetWithdrawal(ctx context.Context, userID, id string) (*Withdrawal, error) {
	return s.repo.GetWithdrawal(ctx, userID, id)
}

// Withdrawals returns the caller's withdrawal history.
func (s *Service) Withdrawals(ctx context.Context, userID string, limit, offset int) ([]Withdrawal, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.ListWithdrawals(ctx, userID, limit, offset)
}

// verifySwapLeg decides what an ErrDuplicate on a swap cash-leg journal means —
// the duplicate claim itself is NEVER proof (a bare Redis-lock "duplicate" can
// carry zero legs). Reads the durable ledger:
//   - both legs committed with exactly j's identity → true replay, benign;
//   - key claimed but no legs → ErrLedgerReconPending (retryable — the caller
//     retries, never proceeds as though the debit posted);
//   - legs under different accounts/types/amount/reference → a foreign claim —
//     fail closed, loudly.
func (s *Service) verifySwapLeg(ctx context.Context, j ledger.JournalEntry) error {
	posted, err := s.led.Posted(ctx, j.IdempotencyKey)
	if err != nil {
		return err
	}
	if !posted {
		return ErrLedgerReconPending
	}
	d, ok, err := s.led.EntryByKey(ctx, j.IdempotencyKey+":debit")
	if err != nil {
		return err
	}
	if !ok || d.AccountID != j.DebitAccountID || d.Type != ledger.EntryDebit ||
		d.AmountKobo != j.AmountKobo || d.Reference != j.Reference {
		return ledger.ErrDuplicate
	}
	c, ok, err := s.led.EntryByKey(ctx, j.IdempotencyKey+":credit")
	if err != nil {
		return err
	}
	if !ok || c.AccountID != j.CreditAccountID || c.Type != ledger.EntryCredit ||
		c.AmountKobo != j.AmountKobo || c.Reference != j.Reference {
		return ledger.ErrDuplicate
	}
	return nil
}

// unwindSwapSell reverses the committed :sell credit after the :buy journal
// refused or failed — a caller must never keep the sale proceeds of a swap
// that never filled (F-5; the business unwindCacLeg pattern). The probe,
// identity check and reversal pair all run inside ONE transaction holding
// pg_advisory_xact_lock("wallet:"+userID) — the same advisory-lock namespace
// DebitWithBalanceCheck/PostJournalWithGuard take (R-1): an unlocked
// probe+reversal could interleave with a concurrent same-key retry's buy
// commit, draining the sell credit while the buy lands — the phantom charge
// the tombstone exists to prevent. Serialised, whichever holds the lock
// decides: a buy that committed first is visible to this probe (no unwind),
// and a buy that commits after the unwind sees the tombstone in its in-tx
// guard (swapBuyGuard) and refuses.
// The reversal runs only when the :sell journal verifies as OURS (escrow
// debit / wallet credit, exact reference + amount on both legs): a foreign
// claim under the key is refused, never answered by minting a reversal off
// someone else's legs. No-ops when the :buy journal turns out durable after
// all — an ambiguous commit means the retry converges, not unwinds.
// Idempotent on "<idem>:unwind:sell" — a retried unwind is a no-op. The legs
// are written raw (PostReversal owns its own transaction and can't join this
// one); the on-lock EXISTS probe makes the plain inserts safe.
func (s *Service) unwindSwapSell(ctx context.Context, userID, idemKey, sellRef, walletID, escrowID string, amountKobo int64) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("crypto: begin unwind tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "wallet:"+userID); err != nil {
		return fmt.Errorf("crypto: unwind wallet lock: %w", err)
	}

	// In-tx re-probe: a :buy that committed before this lock was taken is
	// durable here — do NOT unwind, the same-key retry converges.
	var buyHeld bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE idempotency_key=$1)`,
		idemKey+":buy:debit").Scan(&buyHeld); err != nil {
		return fmt.Errorf("crypto: re-probe buy leg before unwind: %w", err)
	}
	if buyHeld {
		return nil // ambiguous commit — the buy landed; nothing to unwind
	}

	// Idempotent: the unwind already landed under this key → nothing to do.
	var already bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE idempotency_key=$1)`,
		idemKey+":unwind:sell:rev_debit").Scan(&already); err != nil {
		return fmt.Errorf("crypto: re-probe unwind tombstone: %w", err)
	}
	if already {
		return nil
	}

	// Verify the :sell legs are OURS before reversing — read inside this tx so
	// the identity check and the reversal pair are one serialised decision.
	type legRow struct {
		accountID, typ, ref string
		amt                 int64
	}
	readLeg := func(key string) (legRow, bool, error) {
		var l legRow
		err := tx.QueryRow(ctx,
			`SELECT account_id::text, type, reference, amount_kobo FROM ledger_entries WHERE idempotency_key=$1`,
			key).Scan(&l.accountID, &l.typ, &l.ref, &l.amt)
		if errors.Is(err, pgx.ErrNoRows) {
			return legRow{}, false, nil
		}
		return l, err == nil, err
	}
	dr, drFound, err := readLeg(idemKey + ":sell:debit")
	if err != nil {
		return fmt.Errorf("crypto: read sell debit leg: %w", err)
	}
	cr, crFound, err := readLeg(idemKey + ":sell:credit")
	if err != nil {
		return fmt.Errorf("crypto: read sell credit leg: %w", err)
	}
	ours := drFound && crFound &&
		dr.accountID == escrowID && dr.typ == string(ledger.EntryDebit) &&
		dr.ref == sellRef && dr.amt == amountKobo &&
		cr.accountID == walletID && cr.typ == string(ledger.EntryCredit) &&
		cr.ref == sellRef && cr.amt == amountKobo
	if !ours {
		return fmt.Errorf("%w: sell key %s held by a different journal — refusing to reverse", ledger.ErrDuplicate, idemKey+":sell")
	}

	// Reversal pair (escrow restored +cashKobo, wallet drained −cashKobo) —
	// the exact inverse of the :sell journal, keyed "<idem>:unwind:sell".
	// Landing this row is what tombstones the key for every later attempt.
	if _, err := tx.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES
		 ($1, 'REVERSAL_DEBIT',  $3, $4, $5),
		 ($2, 'REVERSAL_CREDIT', $3, $4, $6)`,
		escrowID, walletID, amountKobo, sellRef+":unwind",
		idemKey+":unwind:sell:rev_debit", idemKey+":unwind:sell:rev_credit"); err != nil {
		return fmt.Errorf("crypto: insert unwind reversal pair: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("crypto: commit unwind reversal: %w", err)
	}
	return nil
}

// sellUnwound reports whether the unwind tombstone is durable for this key —
// and verifies the tombstone's identity before believing it (a foreign
// REVERSAL_DEBIT parked on the key is a collision, not our unwind; either way
// the key is dead, but a collision fails closed as a conflict rather than
// silently adopting the claim).
func (s *Service) sellUnwound(ctx context.Context, escrowID, idemKey, sellRef string, amountKobo int64) (bool, error) {
	e, ok, err := s.led.EntryByKey(ctx, idemKey+":unwind:sell:rev_debit")
	if err != nil {
		return false, fmt.Errorf("crypto: unwind tombstone probe: %w", err)
	}
	if !ok {
		return false, nil
	}
	if e.AccountID != escrowID || e.Type != ledger.EntryReversalDebit ||
		e.Reference != sellRef+":unwind" || e.AmountKobo != amountKobo {
		return false, fmt.Errorf("%w: unwind key %s held by a different journal — refusing to adopt it", ledger.ErrDuplicate, idemKey)
	}
	return true, nil
}

// swapBuyGuard composes the unwind tombstone check with the ledger's resolved
// debit guard (strict daily cap by default, or a SetDebitGuard override) so
// BOTH run inside the :buy posting tx under the wallet advisory lock (R-1).
// The tombstone MUST live here, not only at the call site: a same-key retry
// that passed its early probe can still reach this commit while a concurrent
// unwindSwapSell lands — under the shared lock this guard then sees the
// durable tombstone and refuses, and the unwind's own in-tx :buy probe sees
// this commit and no-ops. Exactly one of {buy commits, unwind commits} can
// win; the loser's outcome is consistent either way.
func (s *Service) swapBuyGuard(idemKey, sellRef, escrowID string, amountKobo int64) ledger.DebitGuard {
	strict := s.led.ResolvedDebitGuard()
	tombKey := idemKey + ":unwind:sell:rev_debit"
	tombRef := sellRef + ":unwind"
	return func(ctx context.Context, tx pgx.Tx, userID string, amt int64) error {
		var unwound bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM ledger_entries
			WHERE idempotency_key=$1 AND type='REVERSAL_DEBIT'
			  AND reference=$2 AND account_id=$3 AND amount_kobo=$4)`,
			tombKey, tombRef, escrowID, amountKobo).Scan(&unwound); err != nil {
			return fmt.Errorf("crypto: unwind tombstone check: %w", err)
		}
		if unwound {
			return ErrSwapUnwound
		}
		if strict == nil {
			return ledger.ErrDebitGuardUnwired
		}
		return strict(ctx, tx, userID, amt)
	}
}

// ensureSwapAudit re-emits the crypto.swap audit event for a filled order when
// the original emit was lost (R-5): RecordSwapFill commits the order and the
// audit insert runs after it in a separate statement, so a crash in between
// leaves a filled order with no audit row — and the SwapOrderByIdem anchor
// path returns the order without ever re-emitting. The emit is deduped on
// (action, entity_id): a convergent replay re-emits only when the row is
// genuinely absent, so retries can't stack duplicate events.
func (s *Service) ensureSwapAudit(ctx context.Context, o *SwapOrder) error {
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM crypto_audit_log WHERE action='crypto.swap' AND entity_id=$1)`,
		o.ID).Scan(&exists); err != nil {
		return fmt.Errorf("crypto: audit probe: %w", err)
	}
	if exists {
		return nil
	}
	return s.audit.log(ctx, o.UserID, "crypto.swap", "crypto_swap_order", o.ID, "",
		nil, map[string]any{
			"from": o.FromSymbol, "to": o.ToSymbol, "from_units": o.FromUnits, "to_units": o.ToUnits,
			"cash_kobo": o.CashKobo, "spread_kobo": o.SpreadKobo, "spread_bps": o.SpreadBps,
		})
}

// trimmed is a tiny helper (kept local to avoid a strings import churn elsewhere).
func trimmed(s string) string {
	i, j := 0, len(s)
	for i < j && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r') {
		i++
	}
	for j > i && (s[j-1] == ' ' || s[j-1] == '\t' || s[j-1] == '\n' || s[j-1] == '\r') {
		j--
	}
	return s[i:j]
}
