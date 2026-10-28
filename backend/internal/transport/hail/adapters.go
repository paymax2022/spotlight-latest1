package hail

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	platformRedis "spotlight/backend/internal/platform/redis"
)

// RedisLocker implements Locker on platform/redis (SET NX PX + token-checked
// release). Single-node lock, matching the platform's MVP Redis topology.
type RedisLocker struct{ c *goredis.Client }

func NewRedisLocker(c *goredis.Client) *RedisLocker { return &RedisLocker{c: c} }

func (l *RedisLocker) Acquire(ctx context.Context, key string, ttl time.Duration) (string, bool, error) {
	ok, tok, err := platformRedis.AcquireLock(ctx, l.c, key, ttl)
	if err != nil || !ok {
		return "", false, err
	}
	return tok, true, nil
}

func (l *RedisLocker) Release(ctx context.Context, key, token string) error {
	return platformRedis.ReleaseLock(ctx, l.c, key, token)
}

// SettleLedger is the slice of *ledger.Service the settler needs. Declared here
// so the real LedgerSettler can be exercised against an in-memory double-entry
// book in tests.
type SettleLedger interface {
	GetOrCreateUserWallet(ctx context.Context, userID string) (*ledger.Account, error)
	GetOrCreateStandingAccount(ctx context.Context, t ledger.AccountType) (*ledger.Account, error)
	DebitWithGuard(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64, guard ledger.DebitGuard) error
	Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
	PostReversal(ctx context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error
	EntryByKey(ctx context.Context, idempotencyKey string) (*ledger.Entry, bool, error)
	GetBalance(ctx context.Context, userID string) (int64, error)
}

// TierWalletGate is the production WalletGate: tier/allowance check (ADR-043
// checkout allowance - a rider fare is a consumer purchase) plus an available
// balance check. Fails closed on any read error.
type TierWalletGate struct {
	l SettleLedger
	t *tiers.Service
}

func NewTierWalletGate(l SettleLedger, t *tiers.Service) *TierWalletGate {
	return &TierWalletGate{l: l, t: t}
}

func (g *TierWalletGate) CheckRider(ctx context.Context, riderID string, fare int64) error {
	// Sentinels (ErrWalletDisabled / ErrDailyLimitExceeded /
	// ErrCheckoutAllowanceExceeded) return unwrapped for errors.Is mapping.
	if err := g.t.EnforceCheckoutDebitLimit(ctx, riderID, fare); err != nil {
		return err
	}
	bal, err := g.l.GetBalance(ctx, riderID)
	if err != nil {
		return fmt.Errorf("transport: rider balance (fail closed): %w", err)
	}
	if bal < fare {
		return ErrInsufficientFunds
	}
	return nil
}

// LedgerSettler implements Ledger on the double-entry ledger:
//
//	rider wallet  --fare-->        settlement account   (checkout-guarded debit)
//	settlement    --70%-->         driver wallet
//	settlement    --30%-->         paymax revenue
//
// Retry model. Each leg has its own idempotency key derived from the attempt
// key, so a retry after a partial failure re-posts only the missing legs.
// When a LATER leg fails after the rider has been debited, funds would sit in
// the settlement account with the trip still "matched"; Settle therefore posts
// compensating REVERSAL entries (driver credit first if it landed, then the
// rider debit) and returns the original error. The reversed attempt's keys are
// burned (a replay would be a no-op against funds that were returned), so the
// next Settle for the same key automatically moves to a fresh generation
// ("<key>:g1", "<key>:g2", ...) and settles all three legs again. If the
// compensation itself fails, nothing is burned: the retry replays the posted
// legs idempotently and posts only the missing ones.
type LedgerSettler struct {
	l       SettleLedger
	guard   ledger.DebitGuard
	auditor Auditor
}

func NewLedgerSettler(l *ledger.Service) *LedgerSettler { return &LedgerSettler{l: l} }

// NewLedgerSettlerFor builds a settler over any SettleLedger (tests).
func NewLedgerSettlerFor(l SettleLedger) *LedgerSettler { return &LedgerSettler{l: l} }

// WithGuard sets the in-tx rider debit guard (production:
// tiers.Service.EnforceCheckoutDebitLimitTx, ADR-043). Unset fails closed.
func (s *LedgerSettler) WithGuard(g ledger.DebitGuard) *LedgerSettler { s.guard = g; return s }

// WithAuditor injects the durable audit sink for compensation events.
func (s *LedgerSettler) WithAuditor(a Auditor) *LedgerSettler { s.auditor = a; return s }

const maxSettleGenerations = 8

func genKey(key string, gen int) string {
	if gen == 0 {
		return key
	}
	return fmt.Sprintf("%s:g%d", key, gen)
}

// leg normalises a posting error: ErrDuplicate is success only when the
// durable ledger confirms the key is posted (the Redis fast-path dedup alone
// is not proof).
func (s *LedgerSettler) leg(ctx context.Context, err error, key string) error {
	return s.legSuffix(ctx, err, key, ":credit")
}

func (s *LedgerSettler) legSuffix(ctx context.Context, err error, key, suffix string) error {
	if err == nil || !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	_, posted, perr := s.l.EntryByKey(ctx, key+suffix)
	if perr != nil {
		return fmt.Errorf("transport: verify duplicate leg %s: %w", key, perr)
	}
	if !posted {
		return fmt.Errorf("transport: leg %s duplicate but not posted: %w", key, err)
	}
	return nil
}

func (s *LedgerSettler) reversed(ctx context.Context, revKey string) (bool, error) {
	_, ok, err := s.l.EntryByKey(ctx, revKey+":rev_credit")
	return ok, err
}

func (s *LedgerSettler) Settle(ctx context.Context, key, tripID, riderID, driverUserID string, fare, driverShare, platformShare int64) error {
	if driverShare+platformShare != fare || fare <= 0 || driverShare <= 0 || platformShare < 0 {
		return fmt.Errorf("transport: unbalanced settlement %d+%d != %d", driverShare, platformShare, fare)
	}
	ref := "transport:" + tripID
	settle, err := s.l.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return err
	}
	rev, err := s.l.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	riderAcc, err := s.l.GetOrCreateUserWallet(ctx, riderID)
	if err != nil {
		return err
	}
	drvAcc, err := s.l.GetOrCreateUserWallet(ctx, driverUserID)
	if err != nil {
		return err
	}

	// Pick the live generation: skip any whose rider debit was reversed.
	base, found := "", false
	for gen := 0; gen < maxSettleGenerations; gen++ {
		k := genKey(key, gen)
		done, err := s.reversed(ctx, k+":rider:rev")
		if err != nil {
			return fmt.Errorf("transport: check reversal: %w", err)
		}
		if !done {
			base, found = k, true
			break
		}
	}
	if !found {
		return fmt.Errorf("transport: settlement %s exhausted %d reversal generations", key, maxSettleGenerations)
	}

	// Leg 1: rider -> settlement, checkout-guarded (ADR-043) inside the posting tx.
	riderKey := base + ":rider"
	if err := s.leg(ctx, s.l.DebitWithGuard(ctx, riderID, ref, riderKey, settle.ID, fare, s.guard), riderKey); err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return ErrInsufficientFunds
		}
		return err // tier sentinels propagate unwrapped; nothing posted yet
	}

	// Leg 2: settlement -> driver.
	driverKey := base + ":driver"
	if err := s.leg(ctx, s.l.Credit(ctx, driverUserID, ref, driverKey, settle.ID, driverShare), driverKey); err != nil {
		return s.compensate(ctx, base, ref, riderID, riderAcc.ID, settle.ID, drvAcc.ID, fare, 0, err)
	}

	// Leg 3: settlement -> platform revenue.
	if platformShare > 0 {
		platKey := base + ":platform"
		if err := s.leg(ctx, s.l.PostJournal(ctx, ledger.JournalEntry{
			Reference: ref, IdempotencyKey: platKey, AmountKobo: platformShare,
			DebitAccountID: settle.ID, CreditAccountID: rev.ID, Description: "transport platform share",
		}), platKey); err != nil {
			return s.compensate(ctx, base, ref, riderID, riderAcc.ID, settle.ID, drvAcc.ID, fare, driverShare, err)
		}
	}
	return nil
}

// compensate unwinds a partially posted settlement after cause. driverPosted
// is the driver credit amount to unwind (0 when the driver leg itself failed).
// Order matters: the driver credit is reversed before the rider debit so the
// settlement account never goes negative. On any compensation failure the
// generation is NOT burned and the combined error is returned; the retry then
// replays posted legs and posts only the missing ones.
func (s *LedgerSettler) compensate(ctx context.Context, base, ref, riderID, riderAccID, settleID, drvAccID string, fare, driverPosted int64, cause error) error {
	ctx = context.WithoutCancel(ctx) // unwinding must survive a cancelled request
	if driverPosted > 0 {
		if err := s.legSuffix(ctx, s.l.PostReversal(ctx, settleID, drvAccID, driverPosted, ref, base+":driver:rev"), base+":driver:rev", ":rev_credit"); err != nil {
			return fmt.Errorf("transport: settle failed (%v); driver reversal also failed: %w", cause, err)
		}
	}
	if err := s.legSuffix(ctx, s.l.PostReversal(ctx, riderAccID, settleID, fare, ref, base+":rider:rev"), base+":rider:rev", ":rev_credit"); err != nil {
		return fmt.Errorf("transport: settle failed (%v); rider reversal also failed: %w", cause, err)
	}
	log.Printf("[audit][transport-hail] action=%s rider=%s ref=%s fare=%d driver_unwound=%d cause=%v", AuditSettlementReverse, riderID, ref, fare, driverPosted, cause)
	if s.auditor != nil {
		s.auditor.LogAction(riderID, "", AuditSettlementReverse, "transport", "trip", strings.TrimPrefix(ref, "transport:"), nil,
			map[string]any{"fare_kobo": fare, "driver_credit_unwound_kobo": driverPosted, "cause": cause.Error()}, "", "", "warning")
	}
	return fmt.Errorf("transport: settlement reversed after leg failure: %w", cause)
}
