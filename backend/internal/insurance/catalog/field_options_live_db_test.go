package catalog

// ---------------------------------------------------------------------------
// LIVE-DB test for REMOTE-OPTIONS fields.
//
// A synced product schema can point a select at a provider "utility" endpoint
// via options_url instead of carrying a literal enum. 219 such fields exist
// across 65 of the 69 products. Nothing served them: the route
// /products/:code/options/:field did not exist, so every one of those dropdowns
// answered 404 and the form could not be completed.
//
// This runs against the real synced catalog rather than a fixture, because the
// thing worth pinning is that the resolver finds the URL in the shape the SYNC
// actually stores — a handwritten schema would prove nothing about that.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func liveCatalogPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB catalog field-options test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// stubFetcher stands in for the provider so the assertion is about resolution,
// not about reaching MyCover from a test run.
type stubFetcher struct {
	gotURL, gotQuery string
}

func (s *stubFetcher) FetchUtilityOptions(_ context.Context, url, query string) ([]FieldOption, error) {
	s.gotURL, s.gotQuery = url, query
	return []FieldOption{{Value: "Lagos", Label: "Lagos"}}, nil
}

func TestLiveDB_FieldOptions_ResolvesFromSyncedSchema(t *testing.T) {
	pool := liveCatalogPool(t)
	ctx := context.Background()

	// Any active product that actually has a remote-options field, so this keeps
	// working as the catalog is re-synced.
	var code, field, wantURL string
	err := pool.QueryRow(ctx, `
		SELECT p.code, f->>'name', f->>'options_url'
		FROM public.insurance_products p, jsonb_array_elements(p.form_schema->'fields') f
		WHERE p.active AND f ? 'options_url' AND coalesce(f->>'name','') <> ''
		LIMIT 1`).Scan(&code, &field, &wantURL)
	if err != nil {
		t.Skipf("no synced product carries a remote-options field: %v", err)
	}

	stub := &stubFetcher{}
	svc := NewService(pool).WithOptionsFetcher(stub)

	opts, err := svc.FieldOptions(ctx, code, field, "Lagos")
	if err != nil {
		t.Fatalf("FieldOptions(%q, %q): %v", code, field, err)
	}
	if stub.gotURL != wantURL {
		t.Errorf("resolved options_url: got %q want %q", stub.gotURL, wantURL)
	}
	if stub.gotQuery != "Lagos" {
		t.Errorf("dependent query not passed through: got %q", stub.gotQuery)
	}
	if len(opts) != 1 {
		t.Errorf("options: got %d want 1", len(opts))
	}
}

// A field the product does not have — or one with no remote list — must be
// distinguishable from a missing product, so the form can say which is wrong.
func TestLiveDB_FieldOptions_UnknownFieldIsNotAMissingProduct(t *testing.T) {
	pool := liveCatalogPool(t)
	ctx := context.Background()

	var code string
	if err := pool.QueryRow(ctx,
		`SELECT code FROM public.insurance_products WHERE active LIMIT 1`).Scan(&code); err != nil {
		t.Skipf("no active product: %v", err)
	}

	svc := NewService(pool).WithOptionsFetcher(&stubFetcher{})
	if _, err := svc.FieldOptions(ctx, code, "definitely_not_a_field", ""); err == nil {
		t.Fatal("unknown field resolved — it must not silently serve an empty list")
	} else if !strings.Contains(err.Error(), "unknown field") {
		t.Errorf("want the unknown-field sentinel, got: %v", err)
	}
}

// With no provider wired, the lookup is UNAVAILABLE — not an empty list. An
// empty picker reads as "no choices exist", which is a different problem.
func TestLiveDB_FieldOptions_NoFetcherIsUnavailableNotEmpty(t *testing.T) {
	pool := liveCatalogPool(t)
	ctx := context.Background()

	var code, field string
	if err := pool.QueryRow(ctx, `
		SELECT p.code, f->>'name'
		FROM public.insurance_products p, jsonb_array_elements(p.form_schema->'fields') f
		WHERE p.active AND f ? 'options_url' AND coalesce(f->>'name','') <> ''
		LIMIT 1`).Scan(&code, &field); err != nil {
		t.Skipf("no synced product carries a remote-options field: %v", err)
	}

	svc := NewService(pool) // deliberately no fetcher
	_, err := svc.FieldOptions(ctx, code, field, "")
	if err == nil {
		t.Fatal("served options with no provider wired")
	}
	if !strings.Contains(err.Error(), "unavailable") {
		t.Errorf("want the unavailable sentinel, got: %v", err)
	}
}
