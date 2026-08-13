package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB proof that the two FX surfaces price from ONE table (ADR-031).
//
// Before ADR-031 the legacy wallet FX service read its markup from
// public.fx_markup_rates while the orchestration module priced from a hardcoded
// SpreadEngine rule table in finance_routes.go. The same corridor could be
// charged two different markups, and only one of them was operator-changeable.
//
// These tests prove, against a real database, that:
//   - the seeded rate card reproduces the OLD in-code SpreadEngine exactly, so
//     pointing orchestration at the table repriced nothing (the single
//     deliberate exception — the 105bps -> 100bps default — is asserted, not
//     glossed over);
//   - orchestration and the legacy service resolve the SAME rate for the same
//     corridor;
//   - ONE admin write moves BOTH surfaces, on the next quote, with no restart;
//   - tier specificity (corridor+tier > corridor > tier > DEFAULT) survives the
//     move into SQL — that ordering is what keeps business customers on their
//     own rate.
//
// SKIPPED whenever TEST_DATABASE_URL / DATABASE_URL is unset (reuses liveDBPool
// from convert_live_db_test.go), so `go test ./...` without a DB stays green.
//
//   export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run SpreadUnification -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/fx"
	"spotlight/backend/internal/orchestration"
)

// legacyInCodeEngine is the EXACT rule table orchestration used before ADR-031,
// lifted from finance_routes.go. It is the baseline the seeded table must
// reproduce; if these ever diverge, the seed repriced something.
func legacyInCodeEngine() *orchestration.SpreadEngine {
	return orchestration.NewSpreadEngine(105,
		orchestration.SpreadRule{Corridor: "USD-NGN", Tier: "business", BPS: 75, MinBPS: 50, MaxBPS: 150},
		orchestration.SpreadRule{Corridor: "USD-NGN", BPS: 120, MinBPS: 80, MaxBPS: 200},
		orchestration.SpreadRule{Corridor: "USD-XAF", BPS: 150, MinBPS: 100, MaxBPS: 250},
	)
}

// dbEngine builds an orchestration engine backed by the shared markup table and
// loads the current card.
func dbEngine(t *testing.T, ctx context.Context, pool *pgxpool.Pool) *orchestration.SpreadEngine {
	t.Helper()
	e := orchestration.NewSpreadEngine(fx.DefaultMarkupBPS).
		WithSource(orchestration.NewSQLSpreadSource(pool))
	if err := e.Refresh(ctx); err != nil {
		t.Fatalf("refresh spread card: %v", err)
	}
	return e
}

// TestSpreadUnification_SeedReproducesLegacyPricing is the no-repricing guard.
func TestSpreadUnification_SeedReproducesLegacyPricing(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	legacy := legacyInCodeEngine()
	live := dbEngine(t, ctx, pool)

	// Every corridor the old engine priced explicitly must be unchanged.
	explicit := []struct{ corridor, tier string }{
		{"USD-NGN", "business"},
		{"USD-NGN", "retail"},
		{"USD-NGN", ""},
		{"USD-XAF", "retail"},
		{"USD-XAF", "business"},
		{"USD-XAF", ""},
	}
	for _, tc := range explicit {
		want := legacy.EffectiveBPS(tc.corridor, tc.tier)
		got := live.EffectiveBPS(tc.corridor, tc.tier)
		if got != want {
			t.Errorf("%s/%q repriced: table gives %d bps, the old in-code engine gave %d",
				tc.corridor, tc.tier, got, want)
		}
	}

	// The ONE deliberate change: the fallback for un-carded corridors converges on
	// the product-set 1%. Asserted so it can never happen silently again.
	if got, was := live.EffectiveBPS("GBP-KES", "retail"), legacy.EffectiveBPS("GBP-KES", "retail"); was != 105 || got != 100 {
		t.Errorf("default fallback = %d bps (was %d); ADR-031 expects exactly 105 -> 100", got, was)
	}
}

// TestSpreadUnification_BothSurfacesAgree proves the legacy service and
// orchestration resolve the same rate from the same row.
func TestSpreadUnification_BothSurfacesAgree(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	legacyStore := fx.NewMarkupStore(pool)
	orch := dbEngine(t, ctx, pool)

	const amount = int64(1_000_000)
	// The legacy service has no tier concept, so it resolves the tier-agnostic
	// rows — which is what orchestration resolves for an unknown tier too.
	for _, pair := range [][2]string{{"USD", "NGN"}, {"USD", "XAF"}, {"GBP", "KES"}} {
		corridor := fx.CorridorKey(pair[0], pair[1])

		legacyFee, err := legacyStore.FeeMinor(ctx, pair[0], pair[1], amount)
		if err != nil {
			t.Fatalf("legacy FeeMinor %s: %v", corridor, err)
		}
		orchFee := fx.FeeFromBPS(orch.EffectiveBPS(corridor, ""), amount)

		if legacyFee != orchFee {
			t.Errorf("%s: legacy FX charges %d, orchestration charges %d — the surfaces disagree",
				corridor, legacyFee, orchFee)
		}
	}
}

// TestSpreadUnification_OneAdminWriteMovesBoth is the point of the whole change.
func TestSpreadUnification_OneAdminWriteMovesBoth(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	store := fx.NewMarkupStore(pool)
	corridor := isolateCorridor(t, ctx, pool)
	src, tgt := splitCorridor(t, corridor)
	actor := uuid.NewString()
	const amount = int64(1_000_000)

	// Baseline: both surfaces sit on the seeded 1% DEFAULT.
	orch := dbEngine(t, ctx, pool)
	if got := orch.EffectiveBPS(corridor, "retail"); got != 100 {
		t.Fatalf("orchestration baseline = %d bps, want the 100 default", got)
	}
	if fee, err := store.FeeMinor(ctx, src, tgt, amount); err != nil || fee != 10_000 {
		t.Fatalf("legacy baseline fee = %d (err %v), want 10,000", fee, err)
	}

	// ONE admin write.
	bps, err := fx.PercentToBPS("3")
	if err != nil {
		t.Fatalf("PercentToBPS: %v", err)
	}
	if _, err := store.SetRate(ctx, corridor, "", bps, true, "", actor, "unification test"); err != nil {
		t.Fatalf("SetRate: %v", err)
	}

	// Legacy picks it up on the next resolve.
	if fee, err := store.FeeMinor(ctx, src, tgt, amount); err != nil || fee != 30_000 {
		t.Errorf("legacy fee after admin change = %d (err %v), want 30,000", fee, err)
	}
	// Orchestration picks it up on its next refresh — i.e. its next quote.
	orch = dbEngine(t, ctx, pool)
	if got := orch.EffectiveBPS(corridor, "retail"); got != 300 {
		t.Errorf("orchestration after admin change = %d bps, want 300 — the surfaces are not sharing the table", got)
	}
}

// TestSpreadUnification_TierSpecificitySurvivesSQL pins the resolution order that
// keeps business customers on their own rate.
func TestSpreadUnification_TierSpecificitySurvivesSQL(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	store := fx.NewMarkupStore(pool)
	corridor := isolateCorridor(t, ctx, pool)
	actor := uuid.NewString()

	// Corridor-wide 4%, business 2% on the same corridor.
	if _, err := store.SetRate(ctx, corridor, "", 400, true, "", actor, "corridor-wide"); err != nil {
		t.Fatalf("SetRate corridor: %v", err)
	}
	if _, err := store.SetRate(ctx, corridor, "business", 200, true, "", actor, "business tier"); err != nil {
		t.Fatalf("SetRate tier: %v", err)
	}

	orch := dbEngine(t, ctx, pool)
	cases := []struct {
		tier string
		want int
	}{
		{"business", 200}, // corridor+tier is the most specific match
		{"retail", 400},   // no retail row -> corridor-wide
		{"", 400},         // unknown tier -> corridor-wide
	}
	for _, tc := range cases {
		if got := orch.EffectiveBPS(corridor, tc.tier); got != tc.want {
			t.Errorf("EffectiveBPS(%s, %q) = %d bps, want %d", corridor, tc.tier, got, tc.want)
		}
	}

	// An unrelated corridor is untouched by either row.
	if got := orch.EffectiveBPS("GBP-KES", "business"); got != 100 {
		t.Errorf("unrelated corridor = %d bps, want the 100 default", got)
	}
}

// A rule card with no DEFAULT row must STOP pricing rather than invent a spread.
// Deactivating the seeded row is the only way to reach that state, so the row is
// restored by a cleanup that runs even when the assertions fail.
func TestSpreadUnification_MissingDefaultRowIsAnError(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	t.Cleanup(func() {
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `UPDATE public.fx_markup_rates SET active=true WHERE corridor='DEFAULT'`); err != nil {
			t.Errorf("FAILED TO RESTORE the DEFAULT markup row — re-enable it before using this database: %v", err)
		}
	})

	if _, err := pool.Exec(ctx, `UPDATE public.fx_markup_rates SET active=false WHERE corridor='DEFAULT'`); err != nil {
		t.Fatalf("deactivate DEFAULT: %v", err)
	}

	// Orchestration must refuse to load a card with no default spread.
	e := orchestration.NewSpreadEngine(fx.DefaultMarkupBPS).
		WithSource(orchestration.NewSQLSpreadSource(pool))
	if err := e.Refresh(ctx); err == nil {
		t.Error("Refresh accepted a rule card with no active DEFAULT row; it must fail closed rather than price from a guessed spread")
	}

	// The legacy service must fail closed on the same condition, for a corridor
	// that has no row of its own.
	if _, err := fx.NewMarkupStore(pool).FeeMinor(ctx, "GBP", "KES", 1_000_000); err == nil {
		t.Error("legacy FeeMinor returned a fee with no DEFAULT row; it must fail closed")
	}
}
