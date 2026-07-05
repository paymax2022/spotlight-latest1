package repo

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// querier is the subset of pgx used by the repos, satisfied directly by both
// *pgxpool.Pool and pgx.Tx. It lets a repo run standalone or enlisted in an outer
// tx threaded through the context (see withTx / q), so CROWNED's award +
// credential + pot side-effects commit atomically with the state change.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type txKey struct{}

// withTx returns a context carrying an enlisted tx.
func withTx(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, txKey{}, tx)
}

// q returns the querier for the current context: the enlisted tx if present,
// otherwise the pool. Repos call this instead of touching their pool directly so
// they transparently join an outer transaction.
func q(ctx context.Context, pool *pgxpool.Pool) querier {
	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok && tx != nil {
		return tx
	}
	return pool
}
