package crypto

import (
	"context"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// This file adds the extended crypto money paths: asset→asset swap, the address
// allow-list, deposit-address issuance, and the withdrawal state machine. All
// reuse the existing conventions: integer minor units, Idempotency-Key on every
// money mutation, balanced double-entry cash legs on the finance ledger (never
// mint), audit on every mutation, and fail-closed object-level authorization.

// ── Swap ────────────────────────────────────────────────────────────────────

// SwapQuote returns a pre-trade estimate for swapping fromUnits of asset A into
// asset B at the current quotes, net of the default spread (retained as fee).
// Display-only: the server re-prices at execution time.
func (s *Service) SwapQuote(ctx context.Context, userID, fromAssetID, toAssetID string, fromUnits int64) (*SwapQuote, error) {
	q, _, _, _, err := s.priceSwap(ctx, fromAssetID, toAssetID, fromUnits)
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
//       sell A : escrow → wallet CREDIT   (+cashKobo)
//       buy  B : wallet → escrow DEBIT     (−netCash)
//       spread : wallet → paymax_revenue   (−spreadKobo)
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

	// 1) Asset legs FIRST (fail-closed oversell): record the order + move both
	//    holdings atomically. A replay is a no-op (dup → holdings untouched).
	orderID, dup, err := s.repo.RecordSwapFill(ctx, o)
	if err != nil {
		return nil, err
	}
	o.ID = orderID

	// 2) Cash legs on the finance ledger (idempotent per suffix; a replay is a
	//    safe no-op because each leg's key is stable). Sell A proceeds land in the
	//    wallet, the buy-B cost leaves it, and the spread is retained to revenue.
	escrow, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	revenue, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return nil, err
	}
	// sell A: escrow → wallet CREDIT (+cashKobo)
	if err := s.led.Credit(ctx, userID, o.Reference+":sell", idemKey+":sell", escrow.ID, q.CashKobo); err != nil && err != ledger.ErrDuplicate {
		return nil, err
	}
	// buy B: wallet → escrow DEBIT (−netCash)
	netCash := q.CashKobo - q.SpreadKobo
	if netCash > 0 {
		if err := s.led.Debit(ctx, userID, o.Reference+":buy", idemKey+":buy", escrow.ID, netCash); err != nil && err != ledger.ErrDuplicate {
			return nil, err
		}
	}
	// spread: wallet → paymax_revenue (−spreadKobo)
	if q.SpreadKobo > 0 {
		if err := s.led.Debit(ctx, userID, o.Reference+":spread", idemKey+":spread", revenue.ID, q.SpreadKobo); err != nil && err != ledger.ErrDuplicate {
			return nil, err
		}
	}

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

// ── Address allow-list ──────────────────────────────────────────────────────

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

// ── Deposit address ─────────────────────────────────────────────────────────

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
	Gate                 string `json:"gate"` // eligible|blocked
	ManualReviewOnly     bool   `json:"manual_review_only"`
	DailyLimitKobo       int64  `json:"daily_limit_kobo"`
	DailyUsedKobo        int64  `json:"daily_used_kobo"`
	ManualReviewMinKobo  int64  `json:"manual_review_threshold_kobo"`
	Message              string `json:"message"`
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
	AssetID          string `json:"asset_id"`
	Symbol           string `json:"symbol"`
	Network          string `json:"network"`
	Units            int64  `json:"units"`
	NetworkFeeUnits  int64  `json:"network_fee_units"`
	ReceiveUnits     int64  `json:"receive_units"`
	PaymaxFeeKobo    int64  `json:"paymax_fee_kobo"`
	FiatValueKobo    int64  `json:"fiat_value_kobo"`
	RequiresReview   bool   `json:"requires_review"`
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
		PaymaxFeeKobo: DefaultWithdrawFeeKobo,
		FiatValueKobo: cashForUnits(units, priceKobo, a.MinorUnitScale),
		RequiresReview: true,
	}, nil
}

// ── Withdrawal state machine ────────────────────────────────────────────────

// networkFeeUnits estimates the in-asset miner fee (0.05% of the amount, floored at
// one minor unit). Integer arithmetic only.
func networkFeeUnits(units int64) int64 {
	fee := units / 2000 // 0.05%
	if fee < 1 {
		fee = 1
	}
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
// Requires an Idempotency-Key (replay-safe) and the destination to be an owned,
// active, whitelisted address for the same asset (allow-list enforced).
func (s *Service) Withdraw(ctx context.Context, userID, assetID, addressID string, units, feeKobo int64, idemKey string) (*Withdrawal, error) {
	if units <= 0 || idemKey == "" {
		return nil, ErrBadRequest
	}
	if feeKobo < 0 {
		return nil, ErrBadRequest
	}
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
		if ferr := s.led.Debit(ctx, userID, w.Reference+":fee", idemKey+":fee", revenue.ID, feeKobo); ferr != nil && ferr != ledger.ErrDuplicate {
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
// provider and advances approved → broadcast. It is the ONLY place the provider is
// called — invoked from the admin approve path AFTER the AML gate, never from the
// member create path. On provider reject/error the withdrawal fails and the parked
// units are returned to the holder (compensation, never mints). It reads the owner +
// destination from the persisted row so the broadcast targets the right whitelisted
// address. Idempotent: the guarded approved→broadcast transition (and the provider's
// own idempotency on the withdrawal id) make a re-run safe.
//
// TODO(crypto-worker): for production this should be enqueued to an asynq worker so
// the admin approve HTTP call returns immediately and provider latency/retries are
// handled off the request path. Today it runs inline on approve so the state machine
// is exercisable end-to-end with the mock provider.
func (s *Service) broadcastApprovedWithdrawal(ctx context.Context, w *AdminWithdrawal) (*AdminWithdrawal, error) {
	// Provider needs the net units, the destination address + network, and a stable
	// idempotency key. Derive the provider idem key from the withdrawal id (stable).
	netUnits := w.Units - w.NetworkFeeUnits
	if netUnits <= 0 {
		netUnits = w.Units
	}
	res, berr := s.withdraw.Broadcast(ctx, BroadcastRequest{
		WithdrawalID: w.ID, Symbol: w.Symbol, Network: w.Network, Address: w.Address,
		Units: netUnits, ProviderIdemKey: "crypto:withdraw:" + w.ID,
	})
	if berr != nil || !res.Accepted {
		reason := "provider rejected withdrawal"
		if berr != nil {
			reason = berr.Error()
		}
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
