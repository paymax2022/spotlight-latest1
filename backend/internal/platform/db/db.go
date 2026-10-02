package db

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool wraps pgxpool with a helper so callers import one package.
type Pool = pgxpool.Pool

// Optional environment overrides for the pool. When unset, the DSN and pgx
// defaults govern — unset means zero behaviour change (AGT1-PERF-002).
//
//	pgx behaviour today: MaxConns = max(4, NumCPU) — on a 1–2 vCPU container that
//	is 4–8 connections for EVERY query in the API, and nothing bounds the wait
//	for a free connection (acquire blocks on the caller's context, which gin
//	does not deadline) — that is how a hung DB becomes ~30s of queued
//	acquisitions instead of a fast failure.
//
//	DB_POOL_MAX_CONNS       integer  → pgxpool.Config.MaxConns (e.g. "24")
//	DB_POOL_MIN_CONNS       integer  → pgxpool.Config.MinConns (e.g. "2")
//	DB_CONNECT_TIMEOUT      duration → per-connection dial timeout (e.g. "5s")
//	DB_STATEMENT_TIMEOUT_MS integer  → SET statement_timeout on every pooled conn
//	DB_IDLE_TX_TIMEOUT_MS   integer  → SET idle_in_transaction_session_timeout
//
// Values are read once at pool construction. Bad values fail the pool build at
// boot rather than silently reverting to defaults — an operator typo must be
// loud, not a hidden no-op.
func applyEnvOverrides(cfg *pgxpool.Config) (int64, int64, error) {
	var statementTimeoutMS, idleTxTimeoutMS int64
	if v := os.Getenv("DB_POOL_MAX_CONNS"); v != "" {
		n, cerr := strconv.ParseInt(v, 10, 32)
		if cerr != nil || n <= 0 {
			return 0, 0, fmt.Errorf("db: DB_POOL_MAX_CONNS must be a positive integer, got %q", v)
		}
		cfg.MaxConns = int32(n)
	}
	if v := os.Getenv("DB_POOL_MIN_CONNS"); v != "" {
		n, cerr := strconv.ParseInt(v, 10, 32)
		if cerr != nil || n < 0 {
			return 0, 0, fmt.Errorf("db: DB_POOL_MIN_CONNS must be a non-negative integer, got %q", v)
		}
		cfg.MinConns = int32(n)
	}
	if v := os.Getenv("DB_CONNECT_TIMEOUT"); v != "" {
		d, cerr := time.ParseDuration(v)
		if cerr != nil || d <= 0 {
			return 0, 0, fmt.Errorf("db: DB_CONNECT_TIMEOUT must be a positive duration like \"5s\", got %q", v)
		}
		cfg.ConnConfig.ConnectTimeout = d
	}
	if v := os.Getenv("DB_STATEMENT_TIMEOUT_MS"); v != "" {
		n, cerr := strconv.ParseInt(v, 10, 64)
		if cerr != nil || n <= 0 {
			return 0, 0, fmt.Errorf("db: DB_STATEMENT_TIMEOUT_MS must be a positive integer, got %q", v)
		}
		statementTimeoutMS = n
	}
	if v := os.Getenv("DB_IDLE_TX_TIMEOUT_MS"); v != "" {
		n, cerr := strconv.ParseInt(v, 10, 64)
		if cerr != nil || n <= 0 {
			return 0, 0, fmt.Errorf("db: DB_IDLE_TX_TIMEOUT_MS must be a positive integer, got %q", v)
		}
		idleTxTimeoutMS = n
	}
	return statementTimeoutMS, idleTxTimeoutMS, nil
}

// New opens a pgxpool using the given DSN (postgres://user:pass@host/db).
// The pool is not acquired until first use; call Ping to verify connectivity.
// Automatically sets ROLE to service_role on each connection to bypass RLS.
func New(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("db: parse config: %w", err)
	}
	stmtMS, idleMS, err := applyEnvOverrides(cfg)
	if err != nil {
		return nil, err
	}
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if _, err := conn.Exec(ctx, "SET ROLE service_role"); err != nil {
			return fmt.Errorf("db: SET ROLE service_role: %w", err)
		}
		// Session-scoped statement guards, opt-in via env. Millisecond ints are
		// interpolated (validated digits only — never raw input), because SET
		// does not accept bind parameters.
		if stmtMS > 0 {
			if _, err := conn.Exec(ctx, fmt.Sprintf("SET statement_timeout = %d", stmtMS)); err != nil {
				return fmt.Errorf("db: SET statement_timeout: %w", err)
			}
		}
		if idleMS > 0 {
			if _, err := conn.Exec(ctx, fmt.Sprintf("SET idle_in_transaction_session_timeout = %d", idleMS)); err != nil {
				return fmt.Errorf("db: SET idle_in_transaction_session_timeout: %w", err)
			}
		}
		return nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: open pool: %w", err)
	}
	return pool, nil
}

// Ping verifies the pool can reach the database.
func Ping(ctx context.Context, pool *pgxpool.Pool) error {
	return pool.Ping(ctx)
}
