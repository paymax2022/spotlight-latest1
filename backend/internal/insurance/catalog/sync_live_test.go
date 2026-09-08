package catalog

import (
	"bufio"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/provider/mycover"
)

// ════════════════════════════════════════════════════════════════════════════
// LIVE CATALOG SYNC
// ════════════════════════════════════════════════════════════════════════════
//
// Runs the REAL syncer against the REAL provider and the REAL database. It skips
// unless both a database URL and a provider key are available, so CI and offline
// runs are unaffected.
//
// It is a WRITE test against the catalog by design — that is the thing being
// verified. It writes no member data, moves no money, and buys nothing.

func dotenv(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, path := range []string{".env", "../../../.env"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
			if !ok || strings.HasPrefix(k, "#") {
				continue
			}
			out[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
		}
		f.Close()
		if len(out) > 0 {
			return out
		}
	}
	return out
}

func liveSyncer(t *testing.T) (*Syncer, *Service, *pgxpool.Pool) {
	t.Helper()
	env := dotenv(t)
	get := func(k string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return env[k]
	}
	dbURL := get("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = get("DATABASE_URL")
	}
	key := get("INSURANCE_MYCOVER_API_KEY")
	if dbURL == "" || key == "" {
		t.Skip("DATABASE_URL / INSURANCE_MYCOVER_API_KEY not available — skipping live catalog sync test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Skipf("cannot reach the database: %v", err)
	}
	// Register the close as a CLEANUP, not a defer: a deferred close runs BEFORE
	// t.Cleanup callbacks and would silently no-op every one of them.
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("database unreachable: %v", err)
	}

	adapter := mycover.New(key, "", "", get("INSURANCE_MYCOVER_BASE_URL"))
	svc := NewService(pool)
	return NewSyncer(svc, adapter.Name(), adapter, adapter), svc, pool
}

// TestLive_CatalogSync runs a real sync and asserts the end state members
// actually see.
func TestLive_CatalogSync(t *testing.T) {
	syncer, svc, pool := liveSyncer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	res, err := syncer.Run(ctx, "")
	if err != nil {
		t.Fatalf("live catalog sync: %v", err)
	}
	t.Logf("sync: seen=%d upserted=%d failed=%d with_schema=%d purchasable=%d not_purchasable=%d retired=%d provider_total=%d",
		res.Seen, res.Upserted, res.Failed, res.WithSchema,
		res.Purchasable, res.NotPurchasable, res.Retired, res.ProviderTotal)
	if res.ErrorText != "" {
		t.Logf("sync note: %s", res.ErrorText)
	}

	// COMPLETENESS: every product the provider lists must land. Silently dropping
	// one is the failure this whole design exists to prevent.
	if res.ProviderTotal > 0 && res.Upserted < res.ProviderTotal {
		t.Fatalf("sync landed %d of %d provider products", res.Upserted, res.ProviderTotal)
	}
	if res.Failed != 0 {
		t.Fatalf("%d products failed to sync: %v", res.Failed, res.SkippedCodes)
	}
	// 7 of 69 are broken on MyCover's side; the rest must be sellable.
	if res.NotPurchasable == 0 {
		t.Error("expected the known provider-broken products to be detected as unsellable")
	}
	if res.Purchasable < 50 {
		t.Fatalf("only %d products came back purchasable — expected the great majority", res.Purchasable)
	}

	// ── The end state a member sees ──────────────────────────────────────────
	var active, activeUnsellable, fictional int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE active),
		       count(*) FILTER (WHERE active AND (NOT purchasable OR provider_missing)),
		       count(*) FILTER (WHERE active AND provider_config_status = 'fictional_seed')
		FROM public.insurance_products`).Scan(&active, &activeUnsellable, &fictional); err != nil {
		t.Fatalf("catalog state: %v", err)
	}
	t.Logf("catalog: %d active, %d active-but-unsellable, %d active fictional seeds", active, activeUnsellable, fictional)

	if active == 0 {
		t.Fatal("no product is visible to members — the catalog is dark")
	}
	// THE invariant: nothing offered may be unsellable at the provider.
	if activeUnsellable != 0 {
		t.Fatalf("%d ACTIVE products cannot be sold by the provider — members would pay for cover that cannot be issued", activeUnsellable)
	}
	if fictional != 0 {
		t.Fatalf("%d fictional scaffolding products are still visible to members", fictional)
	}

	// Members must see the REAL catalog: many products, across the real
	// categories, all with a disclosed underwriter.
	products, err := svc.ListForMember(ctx, 3, "")
	if err != nil {
		t.Fatalf("ListForMember: %v", err)
	}
	t.Logf("member-visible products: %d", len(products))
	if len(products) < 50 {
		t.Fatalf("members see only %d products — the real catalog is not reaching them", len(products))
	}

	lines := map[string]int{}
	for _, p := range products {
		lines[p.ProductLine]++
		if p.Underwriter == "" {
			t.Fatalf("product %q reaches members with no disclosed underwriter", p.Code)
		}
		if !p.Purchasable {
			t.Fatalf("unsellable product %q is visible to members", p.Code)
		}
		if p.ProviderProductID == "" {
			t.Fatalf("product %q has no provider uuid — it could never be bought", p.Code)
		}
	}
	t.Logf("member product lines: %v", lines)
	if len(lines) < 5 {
		t.Fatalf("members see only %d product lines: %v", len(lines), lines)
	}

	// IDENTITY: every product the provider lists must have its OWN catalog row.
	// route_name is not unique (two products share "aiico-comprehensive"), so a
	// code derived from it silently merged them — 69 in, 68 out, nothing
	// reported.
	var mycoverRows int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM public.insurance_products
		WHERE provider = 'mycover' AND NOT provider_missing`).Scan(&mycoverRows); err != nil {
		t.Fatalf("row count: %v", err)
	}
	t.Logf("live mycover rows in the catalog: %d (provider lists %d)", mycoverRows, res.ProviderTotal)
	if res.ProviderTotal > 0 && mycoverRows != res.ProviderTotal {
		t.Fatalf("catalog holds %d live rows but the provider lists %d — a product was merged or dropped",
			mycoverRows, res.ProviderTotal)
	}

	var distinctIDs int
	if err := pool.QueryRow(ctx, `
		SELECT count(DISTINCT provider_product_id) FROM public.insurance_products
		WHERE provider = 'mycover' AND NOT provider_missing AND provider_product_id <> ''`).Scan(&distinctIDs); err != nil {
		t.Fatalf("distinct id count: %v", err)
	}
	if distinctIDs != mycoverRows {
		t.Fatalf("%d rows carry only %d distinct provider uuids — rows are sharing an identity",
			mycoverRows, distinctIDs)
	}

	// The form schema must have come from the PROVIDER, not a local table.
	var withSchema int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM public.insurance_products
		WHERE active AND form_schema_source = 'provider'
		  AND jsonb_array_length(COALESCE(form_schema->'fields','[]'::jsonb)) > 0`).Scan(&withSchema); err != nil {
		t.Fatalf("schema check: %v", err)
	}
	t.Logf("active products carrying a provider-fetched form schema: %d", withSchema)
	if withSchema == 0 {
		t.Fatal("no active product carries a provider-fetched schema — nothing could be purchased")
	}
}

// TestLive_SyncIsIdempotent — a second run must change the catalog's shape not at
// all. A sync that drifts on every run is a sync nobody can trust to schedule.
func TestLive_SyncIsIdempotent(t *testing.T) {
	syncer, _, pool := liveSyncer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	shape := func() (total, active, purchasable int) {
		if err := pool.QueryRow(ctx, `
			SELECT count(*), count(*) FILTER (WHERE active), count(*) FILTER (WHERE purchasable)
			FROM public.insurance_products`).Scan(&total, &active, &purchasable); err != nil {
			t.Fatalf("shape: %v", err)
		}
		return
	}

	if _, err := syncer.Run(ctx, ""); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	t1, a1, p1 := shape()

	if _, err := syncer.Run(ctx, ""); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	t2, a2, p2 := shape()

	t.Logf("run 1: total=%d active=%d purchasable=%d", t1, a1, p1)
	t.Logf("run 2: total=%d active=%d purchasable=%d", t2, a2, p2)
	if t1 != t2 || a1 != a2 || p1 != p2 {
		t.Fatalf("sync is not idempotent: (%d,%d,%d) then (%d,%d,%d)", t1, a1, p1, t2, a2, p2)
	}
}
