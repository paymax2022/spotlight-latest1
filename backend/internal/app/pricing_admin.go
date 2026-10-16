package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/crossborder/pricing"
	"spotlight/backend/internal/crossborder/pricingadmin"
	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/services"
)

// fxMarkupSpread supplies the simulator with the SAME spread the live quote
// uses: an orchestration.SpreadEngine over public.fx_markup_rates, refreshed per
// call (a refresh error fails the simulation rather than pricing a stale card).
type fxMarkupSpread struct {
	pool   *pgxpool.Pool
	engine *orchestration.SpreadEngine
}

func newFXMarkupSpread(pool *pgxpool.Pool) *fxMarkupSpread {
	return &fxMarkupSpread{pool: pool, engine: orchestration.NewSpreadEngine(0).WithSource(orchestration.NewSQLSpreadSource(pool))}
}

func (s *fxMarkupSpread) Source(ctx context.Context) (pricing.SpreadSource, error) {
	if err := s.engine.Refresh(ctx); err != nil {
		return nil, err
	}
	return s.engine, nil
}

func (s *fxMarkupSpread) Rules(ctx context.Context) ([]pricingadmin.SpreadRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT corridor, COALESCE(tier,''), rate_bps, active FROM public.fx_markup_rates ORDER BY corridor, tier`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pricingadmin.SpreadRow{}
	for rows.Next() {
		var r pricingadmin.SpreadRow
		if err := rows.Scan(&r.Corridor, &r.Tier, &r.BPS, &r.Active); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// mountPricingAdmin registers the cross-border pricing admin console under
// /api/finance/admin/fx. Inert (mounts nothing) unless the Spotlight Global
// flag is on and a DB pool exists. Every route is RequirePermission-gated by
// the handler (finance.admin.pricing). verto may be nil (sync status then
// reports "unavailable").
func mountPricingAdmin(r gin.IRouter, cfg *config.Config, pool *pgxpool.Pool, rbac services.RBACService,
	auth gin.HandlerFunc, verto pricingadmin.VertoMarkupReader) bool {
	if !cfg.FeatureSpotlightGlobalEnabled {
		return false
	}
	if pool == nil {
		log.Println("[pricing-admin] FEATURE_SPOTLIGHT_GLOBAL is on but there is no database pool — pricing admin disabled")
		return false
	}
	h := pricingadmin.NewHandler(pricingadmin.NewPGStore(pool), newFXMarkupSpread(pool), verto)
	g := r.Group("/api/finance/admin/fx")
	g.Use(auth)
	h.Register(g, rbac)
	log.Println("[pricing-admin] pricing admin routes registered at /api/finance/admin/fx")
	return true
}
