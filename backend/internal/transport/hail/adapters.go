package hail

import (
	"context"
	"errors"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
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

// LedgerSettler implements Ledger on the double-entry ledger:
//
//	rider wallet  --fare-->        settlement account   (tier-gated debit)
//	settlement    --70%-->         driver wallet
//	settlement    --30%-->         paymax revenue
//
// Every leg has its own idempotency key derived from key, so a retry after a
// partial failure re-posts only the missing legs.
type LedgerSettler struct{ l *ledger.Service }

func NewLedgerSettler(l *ledger.Service) *LedgerSettler { return &LedgerSettler{l: l} }

func (s *LedgerSettler) Settle(ctx context.Context, key, tripID, riderID, driverUserID string, fare, driverShare, platformShare int64) error {
	if driverShare+platformShare != fare || fare <= 0 {
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
	if err := s.l.DebitGated(ctx, riderID, ref, key+":rider", settle.ID, fare); err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return ErrInsufficientFunds
		}
		return err
	}
	if err := s.l.Credit(ctx, driverUserID, ref, key+":driver", settle.ID, driverShare); err != nil {
		return err
	}
	return s.l.PostJournal(ctx, ledger.JournalEntry{
		Reference: ref, IdempotencyKey: key + ":platform", AmountKobo: platformShare,
		DebitAccountID: settle.ID, CreditAccountID: rev.ID, Description: "transport platform share",
	})
}
