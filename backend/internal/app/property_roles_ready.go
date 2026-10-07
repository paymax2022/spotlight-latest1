package app

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// rolesTablesReady enforces the property-roles rollout order in code: the
// flag may only take effect once the property_role_registration migration
// has been applied. It fails closed — a nil pool or a probe error is "not ready".
func rolesTablesReady(ctx context.Context, pool *pgxpool.Pool) bool {
	if pool == nil {
		return false
	}
	return tablesProbe(ctx, pool)
}

func tablesProbe(ctx context.Context, q rowQuerier) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var ok bool
	if err := q.QueryRow(ctx, `SELECT to_regclass('public.property_role_profiles') IS NOT NULL`).Scan(&ok); err != nil {
		log.Printf("[property-roles] readiness probe failed: %v", err)
		return false
	}
	return ok
}
