package cryptosvc

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PGSwapLocker serialises per-swap settlement across processes with a Postgres
// session advisory lock held on one dedicated connection for the duration of fn.
//
// POOL SIZING: each held lock pins one pooled connection while fn runs, and fn itself needs
// more connections (store, ledger, nested settler locks). Give the locker its OWN pool, sized
// well above the maximum number of concurrent confirms, or concurrent callers can all hold a
// lock connection while waiting for a query connection and stall the service.
type PGSwapLocker struct{ pool *pgxpool.Pool }

// NewPGSwapLocker wraps a pool. The pool MUST be a dedicated lock pool, never the one the
// store and ledger use (see the sizing note above); use NewPGSwapLockerPool to create one.
func NewPGSwapLocker(pool *pgxpool.Pool) *PGSwapLocker { return &PGSwapLocker{pool: pool} }

// NewPGSwapLockerPool opens a dedicated connection pool for locks and returns the locker and
// a close func. maxConns must comfortably exceed the number of concurrent Confirm calls times
// two (a Confirm holds its own lock and the settler's nested lock at the same time).
func NewPGSwapLockerPool(ctx context.Context, dsn string, maxConns int) (*PGSwapLocker, func(), error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("cryptosvc: lock pool config: %w", err)
	}
	if maxConns < 4 || maxConns > 500 {
		return nil, nil, fmt.Errorf("cryptosvc: lock pool size must be between 4 and 500, got %d", maxConns)
	}
	cfg.MaxConns = int32(maxConns)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("cryptosvc: open lock pool: %w", err)
	}
	return &PGSwapLocker{pool: pool}, pool.Close, nil
}

var _ SwapLocker = (*PGSwapLocker)(nil)

// WithSwapLock blocks until it holds the lock for swapID, runs fn, then releases it.
func (l *PGSwapLocker) WithSwapLock(ctx context.Context, swapID string, fn func(context.Context) error) error {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("cryptosvc: acquire lock connection: %w", err)
	}
	defer conn.Release()
	const key = "cryptoswap:"
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1))`, key+swapID); err != nil {
		return fmt.Errorf("cryptosvc: advisory lock: %w", err)
	}
	defer func() {
		// Unlock on a context that survives cancellation; a leaked session lock would
		// block this swap until the connection is recycled.
		uctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5e9)
		defer cancel()
		if _, uerr := conn.Exec(uctx, `SELECT pg_advisory_unlock(hashtext($1))`, key+swapID); uerr != nil {
			conn.Conn().Close(uctx) // drop the session: Postgres releases its locks
		}
	}()
	return fn(ctx)
}

// PGLeader elects one reconciler across replicas with a non-blocking Postgres session
// advisory lock held on a dedicated connection until released. The key lets more than one
// reconciler (the swap sweep and the deposit sweep) share a lock pool without contending:
// each holds its own advisory lock, so leading one never blocks the other.
type PGLeader struct {
	pool *pgxpool.Pool
	key  string
}

// DefaultSwapLeaderKey is the advisory-lock name the swap reconciler elects on.
const DefaultSwapLeaderKey = "cryptoswap:reconciler"

// NewPGLeader wraps a lock pool, electing on the swap reconciler's key.
func NewPGLeader(pool *pgxpool.Pool) *PGLeader {
	return &PGLeader{pool: pool, key: DefaultSwapLeaderKey}
}

// NewPGLeaderKey wraps a lock pool, electing on a caller-chosen key so an independent
// reconciler gets its own leader.
func NewPGLeaderKey(pool *pgxpool.Pool, key string) *PGLeader { return &PGLeader{pool: pool, key: key} }

var _ LeaderLock = (*PGLeader)(nil)

// TryLead returns ok=false when another replica holds the lock.
func (l *PGLeader) TryLead(ctx context.Context) (func(), bool, error) {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("cryptosvc: acquire leader connection: %w", err)
	}
	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext($1))`, l.key).Scan(&got); err != nil {
		conn.Release()
		return nil, false, fmt.Errorf("cryptosvc: leader lock: %w", err)
	}
	if !got {
		conn.Release()
		return func() {}, false, nil
	}
	return func() {
		uctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, uerr := conn.Exec(uctx, `SELECT pg_advisory_unlock(hashtext($1))`, l.key); uerr != nil {
			conn.Conn().Close(uctx) // dropping the session releases its locks
		}
		conn.Release()
	}, true, nil
}
