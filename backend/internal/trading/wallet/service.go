package wallet

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Service is the trading fund's money-path orchestrator. ALL cash moves through
// the finance ledger (Debit/Credit/PostJournal); this service only decides units
// and NAV and keeps the projection consistent. Ordering is fail-closed: on
// deposit the cash leg posts FIRST (insufficient funds rejects before any unit is
// minted); on redemption the unit leg burns FIRST (the units>=0 CHECK blocks an
// over-redeem before cash leaves). Replays re-drive to consistency via the
// idempotency-keyed order/fee journals + the ledger's own idempotency.
type Service struct {
	pool      *pgxpool.Pool
	repo      *Repository
	led       *ledger.Service
	gate      AccessGate
	feeBps    int64
	hurdleBps int64
}

// AccessGate is the Module-KYC access check (§16B.1). Deposits are refused unless
// the user has trading access. Injected so this package doesn't depend on the kyc
// package; the real gate is wired at Register time. A nil gate denies all deposits
// (fail-closed).
type AccessGate interface {
	HasTradingAccess(ctx context.Context, userID string) (bool, error)
}

func NewService(pool *pgxpool.Pool, led *ledger.Service, gate AccessGate, feeBps, hurdleBps int64) *Service {
	return &Service{pool: pool, repo: NewRepository(pool), led: led, gate: gate, feeBps: feeBps, hurdleBps: hurdleBps}
}

// Sentinel errors (mapped to HTTP by the handler).
var (
	ErrNoAccess         = errors.New("trading: module KYC not cleared")
	ErrIdemRequired     = errors.New("trading: idempotency key required")
	ErrBadAmount        = errors.New("trading: amount must be positive")
	ErrInsufficientCash = errors.New("trading: insufficient wallet balance")
	ErrInsufficientUnit = errors.New("trading: insufficient units to redeem")
	ErrDust             = errors.New("trading: amount too small to mint a unit at current NAV")
	ErrIdemConflict     = errors.New("trading: idempotency key already used for a different operation")
	// Retryable: the ledger's Redis idempotency lock returned duplicate but the
	// durable entry is not (yet) present — the cash leg is unconfirmed. The caller
	// retries after the lock TTL; state stays consistent (no units minted / burned
	// units awaiting an idempotent re-drive of the payout).
	ErrDebitPending  = errors.New("trading: deposit cash leg pending confirmation, retry")
	ErrCreditPending = errors.New("trading: redemption payout pending confirmation, retry")
)

// clearing returns the fund clearing standing account id.
func (s *Service) clearing(ctx context.Context) (string, error) {
	a, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFundClearing)
	if err != nil {
		return "", err
	}
	return a.ID, nil
}

// currentNAV computes NAV per whole unit from the ledger clearing balance (the
// fund's cash — paper mode has no positions) and units outstanding.
func (s *Service) currentNAV(ctx context.Context, clearingAcct string) (navKobo, totalUnits, aumKobo int64, err error) {
	totalUnits, err = s.repo.TotalUnits(ctx)
	if err != nil {
		return 0, 0, 0, err
	}
	aumKobo, err = s.led.GetAccountBalance(ctx, clearingAcct)
	if err != nil {
		return 0, 0, 0, err
	}
	return NAVPerUnitKobo(aumKobo, totalUnits), totalUnits, aumKobo, nil
}

// Subscribe deposits cashKobo from the user's Paymax wallet into the fund, minting
// units at the pre-deposit NAV. Access-gated. Idempotent on idemKey.
func (s *Service) Subscribe(ctx context.Context, userID, idemKey string, cashKobo int64) (*FundOrder, error) {
	if idemKey == "" {
		return nil, ErrIdemRequired
	}
	if cashKobo <= 0 {
		return nil, ErrBadAmount
	}
	// Access gate (fail-closed): a nil gate or no access blocks the deposit.
	if s.gate == nil {
		return nil, ErrNoAccess
	}
	if ok, err := s.gate.HasTradingAccess(ctx, userID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNoAccess
	}
	clearingAcct, err := s.clearing(ctx)
	if err != nil {
		return nil, err
	}

	// Obtain the order for this idem: either an existing reservation/settled order,
	// or a fresh reservation priced at the PRE-deposit NAV. Units are pinned here
	// and NEVER recomputed on replay.
	order, err := s.reserveSubscribe(ctx, userID, idemKey, cashKobo, clearingAcct)
	if err != nil {
		return nil, err
	}

	// CRITICAL money-path invariant: units are minted ONLY after the wallet→clearing
	// debit is DURABLY posted — confirmed via led.Posted, never inferred from
	// replay-existence or the ledger's (Redis-lock) ErrDuplicate, which is not proof
	// of a durable post. This closes every phantom-mint window (crash-between-
	// reserve-and-debit, concurrent double-submit, poisoned-lock ErrDuplicate).
	if err := s.ensureSubscribeDebit(ctx, userID, order, clearingAcct); err != nil {
		return nil, err
	}
	if _, err := s.repo.SettleOrder(ctx, idemKey); err != nil {
		return nil, fmt.Errorf("subscribe settle: %w", err)
	}
	// Seed the HWM at the SUBSCRIBE NAV (cost basis) on first entry so the fee
	// applies to gains above what the holder paid. Idempotent. NOTE: a single
	// per-user HWM does not do series/equalisation for top-ups at different NAVs.
	_ = s.repo.SeedHWM(ctx, userID, order.NAVPerUnitKobo)
	return order, nil
}

// reserveSubscribe returns the order for idemKey — an existing subscribe (replay),
// or a fresh reservation priced at the pre-deposit NAV. A prior order under this
// key that is NOT a subscribe is an idempotency-key collision (never pays out).
func (s *Service) reserveSubscribe(ctx context.Context, userID, idemKey string, cashKobo int64, clearingAcct string) (*FundOrder, error) {
	if prior, err := s.repo.GetOrderByIdem(ctx, idemKey); err != nil {
		return nil, err
	} else if prior != nil {
		if prior.Kind != "subscribe" {
			return nil, ErrIdemConflict
		}
		return prior, nil
	}
	nav, _, _, err := s.currentNAV(ctx, clearingAcct)
	if err != nil {
		return nil, err
	}
	units := UnitsForCash(cashKobo, nav)
	if units <= 0 {
		return nil, ErrDust
	}
	order := FundOrder{UserID: userID, Kind: "subscribe", CashKobo: cashKobo, UnitsDelta: units, NAVPerUnitKobo: nav, IdempotencyKey: idemKey, LedgerRef: "trading:subscribe:" + idemKey}
	if dup, err := s.repo.ReserveOrder(ctx, order); err != nil {
		return nil, fmt.Errorf("subscribe reserve: %w", err)
	} else if dup {
		// A concurrent call reserved first — use its pinned units.
		prior, gerr := s.repo.GetOrderByIdem(ctx, idemKey)
		if gerr != nil {
			return nil, gerr
		}
		if prior == nil {
			return nil, fmt.Errorf("subscribe reserve race: reservation vanished")
		}
		return prior, nil
	}
	return &order, nil
}

// ensureSubscribeDebit guarantees the wallet→clearing cash leg is DURABLY posted
// exactly once. It returns nil ONLY when led.Posted confirms the debit is on the
// ledger; otherwise it fails closed (never lets the caller settle units). This is
// the single gate all Subscribe paths funnel through.
func (s *Service) ensureSubscribeDebit(ctx context.Context, userID string, order *FundOrder, clearingAcct string) error {
	walletKey := order.IdempotencyKey + ":wallet"
	if posted, err := s.led.Posted(ctx, walletKey); err != nil {
		return err
	} else if posted {
		return nil // cash already durably moved on a prior attempt
	}
	err := s.led.Debit(ctx, userID, order.LedgerRef, walletKey, clearingAcct, order.CashKobo)
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ledger.ErrInsufficientFunds):
		// DebitWithBalanceCheck posted nothing → safe to cancel the reservation.
		_ = s.repo.CancelReservation(ctx, order.IdempotencyKey)
		return ErrInsufficientCash
	case errors.Is(err, ledger.ErrDuplicate):
		// ErrDuplicate is only the Redis fast-path (a 10s lock held even after a
		// FAILED debit) — NOT proof of a durable post. Confirm via Posted; if the
		// entry isn't there, the cash did not move: fail closed and let the caller
		// retry after the lock TTL. Never settle on an unconfirmed debit.
		if posted, perr := s.led.Posted(ctx, walletKey); perr != nil {
			return perr
		} else if posted {
			return nil
		}
		return ErrDebitPending
	default:
		return fmt.Errorf("subscribe debit: %w", err)
	}
}

// Redeem burns `units` from the holder and pays out cash at the current NAV to the
// user's Paymax wallet. NOT access-gated — a user can always withdraw their own
// capital. Idempotent on idemKey.
func (s *Service) Redeem(ctx context.Context, userID, idemKey string, units int64) (*FundOrder, error) {
	if idemKey == "" {
		return nil, ErrIdemRequired
	}
	if units <= 0 {
		return nil, ErrBadAmount
	}
	clearingAcct, err := s.clearing(ctx)
	if err != nil {
		return nil, err
	}
	// Replay: if the burn already happened, ensure the cash credit is posted
	// (idempotent) and return — this completes a crash between the two legs. A
	// prior order under this key that is NOT a redeem is an idempotency-key
	// collision → reject, NEVER pay out (guards "reused key = free cash-out").
	if prior, err := s.repo.GetOrderByIdem(ctx, idemKey); err != nil {
		return nil, err
	} else if prior != nil {
		if prior.Kind != "redeem" {
			return nil, ErrIdemConflict
		}
		if err := s.creditRedeem(ctx, userID, idemKey, prior.CashKobo, clearingAcct); err != nil {
			return nil, err
		}
		return prior, nil
	}

	held, err := s.repo.UserUnits(ctx, userID)
	if err != nil {
		return nil, err
	}
	if units > held {
		return nil, ErrInsufficientUnit
	}
	nav, _, _, err := s.currentNAV(ctx, clearingAcct)
	if err != nil {
		return nil, err
	}
	cash := CashForUnits(units, nav)

	// Unit leg FIRST: burn units (units>=0 CHECK blocks over-redeem at the DB).
	order := FundOrder{UserID: userID, Kind: "redeem", CashKobo: cash, UnitsDelta: -units, NAVPerUnitKobo: nav, IdempotencyKey: idemKey}
	if _, err := s.repo.RecordRedeem(ctx, order); err != nil {
		return nil, fmt.Errorf("redeem record: %w", err)
	}
	// Cash leg: fund clearing → wallet.
	if err := s.creditRedeem(ctx, userID, idemKey, cash, clearingAcct); err != nil {
		return nil, err
	}
	return &order, nil
}

func (s *Service) creditRedeem(ctx context.Context, userID, idemKey string, cash int64, clearingAcct string) error {
	if cash <= 0 {
		return nil
	}
	redeemKey := idemKey + ":redeem"
	if posted, err := s.led.Posted(ctx, redeemKey); err != nil {
		return err
	} else if posted {
		return nil // payout already durably credited
	}
	err := s.led.Credit(ctx, userID, "trading:redeem:"+idemKey, redeemKey, clearingAcct, cash)
	if err == nil {
		return nil
	}
	if errors.Is(err, ledger.ErrDuplicate) {
		// ErrDuplicate (Redis lock) is not proof of a durable credit — confirm.
		// If not posted, the payout is still pending: the units are already burned
		// and the order is durable, so a retry re-drives this credit to completion.
		if posted, perr := s.led.Posted(ctx, redeemKey); perr != nil {
			return perr
		} else if posted {
			return nil
		}
		return ErrCreditPending
	}
	return fmt.Errorf("redeem credit: %w", err)
}

// AssessPerformanceFee crystallizes a holder's high-water-mark performance fee:
// it burns fee-worth units from the holder and moves that cash from the fund
// clearing account to fee income — leaving every OTHER holder's NAV unchanged.
// Idempotent on idemKey. Returns the fee charged (0 if none due).
func (s *Service) AssessPerformanceFee(ctx context.Context, userID, idemKey, period string) (int64, error) {
	if idemKey == "" {
		return 0, ErrIdemRequired
	}
	clearingAcct, err := s.clearing(ctx)
	if err != nil {
		return 0, err
	}
	// Replay: ensure the ledger leg is posted for an already-recorded accrual.
	if prior, err := s.repo.GetFeeByIdem(ctx, idemKey); err != nil {
		return 0, err
	} else if prior != nil {
		if err := s.postFeeLeg(ctx, idemKey, prior.FeeKobo, clearingAcct); err != nil {
			return 0, err
		}
		return prior.FeeKobo, nil
	}

	held, err := s.repo.UserUnits(ctx, userID)
	if err != nil {
		return 0, err
	}
	nav, _, _, err := s.currentNAV(ctx, clearingAcct)
	if err != nil {
		return 0, err
	}
	hwm, ok, err := s.repo.HWM(ctx, userID)
	if err != nil {
		return 0, err
	}
	if !ok {
		hwm = nav // first assessment: seed HWM at the current NAV → no retro fee
	}

	fee, newHWM := PerformanceFee(nav, hwm, held, s.feeBps, s.hurdleBps)
	if fee <= 0 {
		// Nothing to crystallize; persist the (possibly seeded) HWM so it exists.
		if !ok {
			_ = s.repo.SeedHWM(ctx, userID, newHWM)
		}
		return 0, nil
	}
	feeUnits := UnitsForCash(fee, nav) // units worth the fee (< held, since fee < holding value)
	profit := fee * 10_000 / max64(s.feeBps, 1)

	acc := FeeAccrual{
		UserID: userID, Period: period, NAVNowKobo: nav, HWMBefore: hwm, HWMAfter: newHWM,
		ProfitKobo: profit, FeeKobo: fee, UnitsBurned: feeUnits, IdempotencyKey: idemKey,
		LedgerRef: "trading:fee:" + idemKey,
	}
	if _, err := s.repo.RecordFeeAccrual(ctx, acc); err != nil {
		return 0, fmt.Errorf("fee record: %w", err)
	}
	if err := s.postFeeLeg(ctx, idemKey, fee, clearingAcct); err != nil {
		return 0, err
	}
	return fee, nil
}

// postFeeLeg moves the fee cash from the fund clearing account to fee income
// (both standing accounts) — idempotent.
func (s *Service) postFeeLeg(ctx context.Context, idemKey string, fee int64, clearingAcct string) error {
	if fee <= 0 {
		return nil
	}
	feeKey := idemKey + ":fee"
	if posted, err := s.led.Posted(ctx, feeKey); err != nil {
		return err
	} else if posted {
		return nil // fee cash already durably moved
	}
	feeAcct, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFeeIncome)
	if err != nil {
		return err
	}
	j := ledger.JournalEntry{
		Reference: "trading:fee:" + idemKey, IdempotencyKey: feeKey, AmountKobo: fee,
		DebitAccountID: clearingAcct, CreditAccountID: feeAcct.ID, Description: "trading performance fee",
	}
	if err := s.led.PostJournal(ctx, j); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// Not proof of a durable post — confirm; if unposted, still pending.
			if posted, perr := s.led.Posted(ctx, feeKey); perr != nil {
				return perr
			} else if posted {
				return nil
			}
			return ErrCreditPending
		}
		return fmt.Errorf("fee ledger: %w", err)
	}
	return nil
}

// SnapshotNAV records an immutable NAV snapshot and returns it.
func (s *Service) SnapshotNAV(ctx context.Context, idem string) (navKobo, totalUnits int64, err error) {
	clearingAcct, err := s.clearing(ctx)
	if err != nil {
		return 0, 0, err
	}
	nav, total, aum, err := s.currentNAV(ctx, clearingAcct)
	if err != nil {
		return 0, 0, err
	}
	if _, err := s.repo.InsertNAVSnapshot(ctx, nav, total, aum, aum, idem); err != nil {
		return 0, 0, err
	}
	return nav, total, nil
}

// Reconcile checks fund integrity: the unit projection and the ledger clearing
// balance must each equal what the immutable order/fee journals imply. A torn
// write shows up as drift and the caller HALTS the fund (§3.4/§7.7).
func (s *Service) Reconcile(ctx context.Context, toleranceKobo int64) (ReconcileResult, error) {
	clearingAcct, err := s.clearing(ctx)
	if err != nil {
		return ReconcileResult{}, err
	}
	clearingBal, err := s.led.GetAccountBalance(ctx, clearingAcct)
	if err != nil {
		return ReconcileResult{}, err
	}
	sumUnits, err := s.repo.TotalUnits(ctx)
	if err != nil {
		return ReconcileResult{}, err
	}
	jt, err := s.repo.JournalTotals(ctx)
	if err != nil {
		return ReconcileResult{}, err
	}
	// The active integrity guard is UNIT-projection consistency: the summed
	// per-user units MUST equal what the immutable order + fee journals imply
	// (Σ order deltas − Σ fee burns). A torn write — units changed without a
	// journal row, or vice-versa — shows up here.
	//
	// The cash side: in this paper foundation the fund holds only cash, so AUM ≡
	// the ledger clearing balance and the AUM-vs-clearing check is tautologically
	// satisfied (we pass clearingBal for both). The journal member-cash total
	// (jt.ExpectedClearingKobo) is NOT used as the cash oracle because it excludes
	// trading P&L (clearing − memberCash = net realized P&L). When real position
	// valuation lands, aumKobo becomes cash + Σ position mark-to-market and this
	// check becomes a genuine cross-check; until then unit-consistency is the guard.
	_ = jt.ExpectedClearingKobo // reserved for the position-valuation phase
	return Reconcile(sumUnits, jt.ExpectedUnits, clearingBal, clearingBal, toleranceKobo), nil
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
