package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB test for the operator-tunable Paymax FX markup (ADR-030).
//
// The markup decides what every customer pays on a conversion, so this proves
// against a real database that:
//   - the seeded DEFAULT rate is 1% and resolves for any corridor;
//   - an admin change takes effect on the very NEXT resolve (no cache, no
//     restart) and is what a subsequent quote would charge;
//   - a corridor-specific rate overrides DEFAULT, and only for that corridor;
//   - a deactivated corridor rate falls back to DEFAULT rather than to zero;
//   - EVERY change writes an immutable before/after audit row naming the actor;
//   - the fat-finger ceiling is enforced by the store AND by the table CHECK.
//
// SKIPPED whenever TEST_DATABASE_URL / DATABASE_URL is unset (reuses liveDBPool
// from convert_live_db_test.go), so `go test ./...` without a DB stays green.
//
// Bring-up: apply migrations incl. 20261204000000_fx_markup_rates.sql, then:
//   export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run MarkupStore -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/fx"
)

// isolateCorridor gives each test its own corridor label so parallel/repeat runs
// never fight over a shared row, and removes it (plus its audit) afterwards. The
// seeded DEFAULT row is never touched.
func isolateCorridor(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	// Corridor labels are free-form text; a synthetic pair keeps this off any real one.
	corridor := "ZZ" + uuid.NewString()[:4] + "-QQ" + uuid.NewString()[:4]
	corridor = fx.NormalizeCorridor(corridor)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM public.fx_markup_rate_audit WHERE corridor=$1`, corridor)
		_, _ = pool.Exec(ctx, `DELETE FROM public.fx_markup_rates WHERE corridor=$1`, corridor)
	})
	return corridor
}

// splitCorridor turns "AAA-BBB" back into its two currency halves.
func splitCorridor(t *testing.T, corridor string) (string, string) {
	t.Helper()
	for i := 0; i < len(corridor); i++ {
		if corridor[i] == '-' {
			return corridor[:i], corridor[i+1:]
		}
	}
	t.Fatalf("malformed corridor %q", corridor)
	return "", ""
}

func TestMarkupStore_SeededDefaultIsOnePercent(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	store := fx.NewMarkupStore(pool)

	// An arbitrary corridor with no override must resolve via the DEFAULT row.
	fee, err := store.FeeMinor(ctx, "GBP", "KES", 100_000)
	if err != nil {
		t.Fatalf("FeeMinor: %v", err)
	}
	if fee != 1_000 {
		t.Errorf("default markup on 100,000 = %d, want 1,000 (1%%)", fee)
	}

	rates, err := store.ListRates(ctx)
	if err != nil {
		t.Fatalf("ListRates: %v", err)
	}
	if len(rates) == 0 || rates[0].Corridor != "DEFAULT" {
		t.Fatalf("DEFAULT must sort first, got %+v", rates)
	}
	if rates[0].RatePercent != "1" {
		t.Errorf("DEFAULT rate renders as %q, want \"1\"", rates[0].RatePercent)
	}
}

// The whole point of moving the rate into the DB: an admin edit must change what
// the next conversion charges, with no restart and no cache to invalidate.
func TestMarkupStore_AdminChangeTakesEffectImmediately(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	store := fx.NewMarkupStore(pool)
	corridor := isolateCorridor(t, ctx, pool)
	src, tgt := splitCorridor(t, corridor)
	actor := uuid.NewString()

	// Before any override, the corridor resolves to the seeded 1% DEFAULT.
	if fee, err := store.FeeMinor(ctx, src, tgt, 100_000); err != nil || fee != 1_000 {
		t.Fatalf("pre-override fee = %d (err %v), want 1,000", fee, err)
	}

	// Admin sets this corridor to 2.5%.
	bps, err := fx.PercentToBPS("2.5")
	if err != nil {
		t.Fatalf("PercentToBPS: %v", err)
	}
	rate, err := store.SetRate(ctx, corridor, bps, true, "", actor, "raise for volatility")
	if err != nil {
		t.Fatalf("SetRate: %v", err)
	}
	if rate.RatePercent != "2.5" || rate.RateBPS != 250 {
		t.Errorf("saved rate = %s%% (%d bps), want 2.5%% (250)", rate.RatePercent, rate.RateBPS)
	}

	// Next resolve already reflects it.
	if fee, err := store.FeeMinor(ctx, src, tgt, 100_000); err != nil || fee != 2_500 {
		t.Fatalf("post-override fee = %d (err %v), want 2,500", fee, err)
	}
	// ...and only for this corridor.
	if fee, err := store.FeeMinor(ctx, "GBP", "KES", 100_000); err != nil || fee != 1_000 {
		t.Fatalf("unrelated corridor fee = %d (err %v), want the 1,000 default", fee, err)
	}

	// Changing it again moves the charge again.
	if _, err := store.SetRate(ctx, corridor, 50, true, "", actor, "settle back down"); err != nil {
		t.Fatalf("SetRate second change: %v", err)
	}
	if fee, err := store.FeeMinor(ctx, src, tgt, 100_000); err != nil || fee != 500 {
		t.Fatalf("second-change fee = %d (err %v), want 500", fee, err)
	}

	// Deactivating falls back to DEFAULT — never silently to zero.
	if _, err := store.SetRate(ctx, corridor, 50, false, "", actor, "retire override"); err != nil {
		t.Fatalf("SetRate deactivate: %v", err)
	}
	if fee, err := store.FeeMinor(ctx, src, tgt, 100_000); err != nil || fee != 1_000 {
		t.Fatalf("deactivated fee = %d (err %v), want the 1,000 default", fee, err)
	}
}

// Changing a customer-facing fee must always be attributable.
func TestMarkupStore_EveryChangeIsAudited(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	store := fx.NewMarkupStore(pool)
	corridor := isolateCorridor(t, ctx, pool)
	actor := uuid.NewString()

	if _, err := store.SetRate(ctx, corridor, 100, true, "", actor, "create"); err != nil {
		t.Fatalf("SetRate create: %v", err)
	}
	if _, err := store.SetRate(ctx, corridor, 250, true, "", actor, "raise"); err != nil {
		t.Fatalf("SetRate raise: %v", err)
	}

	entries, err := store.ListAudit(ctx, corridor, 50)
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 audit rows, got %d", len(entries))
	}

	// Newest first: the raise, carrying the previous value as "before".
	raise := entries[0]
	if raise.BeforeBPS == nil || *raise.BeforeBPS != 100 {
		t.Errorf("raise before = %v, want 100", raise.BeforeBPS)
	}
	if raise.AfterBPS != 250 || raise.AfterPercent != "2.5" {
		t.Errorf("raise after = %d bps / %q, want 250 / \"2.5\"", raise.AfterBPS, raise.AfterPercent)
	}
	if raise.BeforePercent != "1" {
		t.Errorf("raise beforePercent = %q, want \"1\"", raise.BeforePercent)
	}
	if raise.ChangedBy == nil || *raise.ChangedBy != actor {
		t.Errorf("raise changedBy = %v, want %s", raise.ChangedBy, actor)
	}
	if raise.Note != "raise" {
		t.Errorf("raise note = %q, want \"raise\"", raise.Note)
	}

	// The first write has no "before" — it created the row.
	create := entries[1]
	if create.BeforeBPS != nil {
		t.Errorf("create before = %v, want nil (no prior row)", create.BeforeBPS)
	}
	if create.AfterBPS != 100 {
		t.Errorf("create after = %d, want 100", create.AfterBPS)
	}
}

// The ceiling is a fat-finger guard on a customer-facing charge, so it is
// enforced in the store as well as by the table's CHECK constraint.
func TestMarkupStore_RejectsOutOfRange(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	store := fx.NewMarkupStore(pool)
	corridor := isolateCorridor(t, ctx, pool)

	for _, bps := range []int{-1, fx.MaxMarkupBPS + 1, 10_000} {
		if _, err := store.SetRate(ctx, corridor, bps, true, "", "", ""); !errors.Is(err, fx.ErrMarkupOutOfRange) {
			t.Errorf("SetRate(%d bps) error = %v, want ErrMarkupOutOfRange", bps, err)
		}
	}

	// A rejected write must leave nothing behind — no row, no audit.
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.fx_markup_rates WHERE corridor=$1`, corridor).Scan(&rows); err != nil {
		t.Fatalf("count rates: %v", err)
	}
	if rows != 0 {
		t.Errorf("rejected write left %d rate rows behind", rows)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.fx_markup_rate_audit WHERE corridor=$1`, corridor).Scan(&rows); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if rows != 0 {
		t.Errorf("rejected write left %d audit rows behind", rows)
	}

	// The database is the backstop if the Go guard is ever bypassed.
	_, err := pool.Exec(ctx, `INSERT INTO public.fx_markup_rates (corridor, rate_bps) VALUES ($1, 10000)`, corridor)
	if err == nil {
		t.Error("table CHECK allowed a 100% markup; the ceiling must be enforced in the schema too")
	}
}
