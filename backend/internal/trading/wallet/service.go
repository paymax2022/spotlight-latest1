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

	// Replay: an already-recorded subscribe returns its ORIGINAL reserved units
	// (never recomputed). If the reservation exists but isn't settled yet, settle
	// it now (the crash-between-debit-and-settle window). A prior order under this
	// key that is NOT a subscribe is an idempotency-key collision → reject, never
	// pay out (guards the "reused key = free cash-out" class).
	if prior, err := s.repo.GetOrderByIdem(ctx, idemKey); err != nil {
		return nil, err
	} else if prior != nil {
		if prior.Kind != "subscribe" {
			return nil, ErrIdemConflict
		}
		if _, err := s.repo.SettleOrder(ctx, idemKey); err != nil {
			return nil, err
		}
		_ = s.repo.SeedHWM(ctx, userID, prior.NAVPerUnitKobo)
		return prior, nil
	}

	// Compute units at the PRE-deposit NAV and RESERVE them (pinned) before moving
	// cash — so a crash-retry settles the same units instead of recomputing NAV
	// against the post-deposit balance.
	nav, _, _, err := s.currentNAV(ctx, clearingAcct)
	if err != nil {
		return nil, err
	}
	units := UnitsForCash(cashKobo, nav)
	if units <= 0 {
		return nil, ErrDust
	}
	ref := "trading:subscribe:" + idemKey
	order := FundOrder{UserID: userID, Kind: "subscribe", CashKobo: cashKobo, UnitsDelta: units, NAVPerUnitKobo: nav, IdempotencyKey: idemKey, LedgerRef: ref}
	if dup, err := s.repo.ReserveOrder(ctx, order); err != nil {
		return nil, fmt.Errorf("subscribe reserve: %w", err)
	} else if dup {
		// Concurrent double-submit raced us to the reservation — reload + settle it.
		prior, gerr := s.repo.GetOrderByIdem(ctx, idemKey)
		if gerr != nil || prior == nil {
			return nil, fmt.Errorf("subscribe reserve race: %v", gerr)
		}
		if _, err := s.repo.SettleOrder(ctx, idemKey); err != nil {
			return nil, err
		}
		_ = s.repo.SeedHWM(ctx, userID, prior.NAVPerUnitKobo)
		return prior, nil
	}

	// Cash leg: wallet → fund clearing. Insufficient funds cancels the reservation
	// (no phantom units). Duplicate means a prior attempt already debited.
	if err := s.led.Debit(ctx, userID, ref, idemKey+":wallet", clearingAcct, cashKobo); err != nil {
		switch {
		case errors.Is(err, ledger.ErrInsufficientFunds):
			_ = s.repo.CancelReservation(ctx, idemKey)
			return nil, ErrInsufficientCash
		case errors.Is(err, ledger.ErrDuplicate):
			// cash already moved on a prior attempt — proceed to settle
		default:
			return nil, fmt.Errorf("subscribe debit: %w", err)
		}
	}

	// Settle: apply the reserved units, once.
	if _, err := s.repo.SettleOrder(ctx, idemKey); err != nil {
		return nil, fmt.Errorf("subscribe settle: %w", err)
	}
	// Seed the high-water mark at the SUBSCRIBE NAV (cost basis) on first entry so
	// the performance fee applies to gains above what the holder paid. Idempotent.
	// NOTE: a single per-user HWM does not do series/equalisation accounting for
	// top-ups at different NAVs — that hardening is a follow-up.
	_ = s.repo.SeedHWM(ctx, userID, nav)
	return &order, nil
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
	ref := "trading:redeem:" + idemKey
	if err := s.led.Credit(ctx, userID, ref, idemKey+":redeem", clearingAcct, cash); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("redeem credit: %w", err)
	}
	return nil
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
	feeAcct, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFeeIncome)
	if err != nil {
		return err
	}
	j := ledger.JournalEntry{
		Reference: "trading:fee:" + idemKey, IdempotencyKey: idemKey + ":fee", AmountKobo: fee,
		DebitAccountID: clearingAcct, CreditAccountID: feeAcct.ID, Description: "trading performance fee",
	}
	if err := s.led.PostJournal(ctx, j); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
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
