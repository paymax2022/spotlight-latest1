package restaurant

// LIVE-DB regression for FOOD-UAT-F-003 (admin-editable commission split). Skipped
// unless TEST_DATABASE_URL is set; needs migration 20271064000010.

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_CommissionConfig(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := t.Context()
	svc := NewService(pool, nil)

	owner, admin := uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Commission Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM restaurant_commission_config WHERE restaurant_id=$1`, restID)
	})

	// (a) no override -> the seeded global 80/10/10.
	got := svc.ResolveCommissionSplit(ctx, restID)
	if got.ProviderBps != 8000 || got.RiderBps != 1000 || got.PlatformBps != 1000 || got.Source != "global" {
		t.Fatalf("global default: got %+v, want 8000/1000/1000 source=global", got)
	}
	// The pct helpers must be bit-identical to the legacy constants (no kobo shift).
	if got.ProviderPct() != splitProviderPct || got.RiderPct() != splitRiderPct ||
		got.PlatformPct() != splitPlatformPct || got.ProviderPctNoRider() != splitProviderPctNoRider {
		t.Fatalf("pct helpers drifted from legacy consts: %v %v %v %v", got.ProviderPct(), got.RiderPct(), got.PlatformPct(), got.ProviderPctNoRider())
	}

	// (b) a restaurant override takes precedence. Inserted DIRECTLY so the 30s cache
	// (primed with the global above) is not invalidated — proves caching too.
	if _, err := pool.Exec(ctx, `INSERT INTO restaurant_commission_config (restaurant_id, provider_split_bps, rider_split_bps, platform_split_bps) VALUES ($1,7000,1500,1500)`, restID); err != nil {
		t.Fatalf("seed override: %v", err)
	}
	if cached := svc.ResolveCommissionSplit(ctx, restID); cached.Source != "global" {
		t.Fatalf("expected cached global within TTL, got %+v", cached)
	}
	svc.InvalidateCommissionCache()
	if o := svc.ResolveCommissionSplit(ctx, restID); o.ProviderBps != 7000 || o.RiderBps != 1500 || o.PlatformBps != 1500 || o.Source != "restaurant" {
		t.Fatalf("override: got %+v, want 7000/1500/1500 source=restaurant", o)
	}

	// (c) admin PUT is visible immediately (invalidates), audited, and DELETE reverts.
	aud := &w5ccTestAuditor{}
	svc.WithAudit(aud)
	if err := svc.AdminSetCommission(ctx, admin, restID, CommissionSplit{ProviderBps: 6000, RiderBps: 2000, PlatformBps: 2000}); err != nil {
		t.Fatalf("admin set: %v", err)
	}
	if o := svc.ResolveCommissionSplit(ctx, restID); o.ProviderBps != 6000 || o.PlatformBps != 2000 {
		t.Fatalf("after PUT: got %+v", o)
	}
	if len(aud.calls) != 1 || aud.calls[0].action != "restaurant.commission.set" || aud.calls[0].actor != admin {
		t.Fatalf("audit after PUT: %+v", aud.calls)
	}
	if ok, err := svc.AdminDeleteCommission(ctx, admin, restID); err != nil || !ok {
		t.Fatalf("delete override: ok=%v err=%v", ok, err)
	}
	if o := svc.ResolveCommissionSplit(ctx, restID); o.Source != "global" || o.ProviderBps != 8000 {
		t.Fatalf("after DELETE: got %+v, want global", o)
	}

	// (d) sums must be 10000: rejected by the service AND by the DB CHECK.
	if err := svc.AdminSetCommission(ctx, admin, restID, CommissionSplit{ProviderBps: 7000, RiderBps: 1000, PlatformBps: 1000}); err == nil {
		t.Fatal("service accepted a split summing to 9000")
	}
	_, err := pool.Exec(ctx, `INSERT INTO restaurant_commission_config (restaurant_id, provider_split_bps, rider_split_bps, platform_split_bps) VALUES ($1,7000,1000,1000)`, restID)
	if err == nil || !strings.Contains(err.Error(), "sums_to_10000") {
		t.Fatalf("DB CHECK did not reject a malformed row: %v", err)
	}
}

type w5ccAuditCall struct {
	actor, action, resource string
	newValues               map[string]any
}

type w5ccTestAuditor struct{ calls []w5ccAuditCall }

func (f *w5ccTestAuditor) LogAction(actor, _, action, _, _, resourceID string, _, nv map[string]any, _, _, _ string) {
	f.calls = append(f.calls, w5ccAuditCall{actor: actor, action: action, resource: resourceID, newValues: nv})
}
