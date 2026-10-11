package cryptosvc

import (
	"context"
	"fmt"

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

// NewPGSwapLocker wraps a pool.
func NewPGSwapLocker(pool *pgxpool.Pool) *PGSwapLocker { return &PGSwapLocker{pool: pool} }

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
