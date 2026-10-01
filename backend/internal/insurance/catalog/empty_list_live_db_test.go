package catalog_test

// LIVE-DB test: an empty product list must serialize as {"data":[]} — not
// {"data":null} — so clients that do Array.isArray(data) (the mobile
// Protection hub, the load harness) render an honest empty catalog instead of
// a broken response. AUD-QA-002. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/insurance/catalog"
)

func emptyListCatalogPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB empty-list test")
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

func TestListForMember_EmptyReturnsNonNilSlice_Integration(t *testing.T) {
	pool := emptyListCatalogPool(t)
	ctx := context.Background()
	svc := catalog.NewService(pool)

	// A product_line nothing will ever match is an empty result set whatever
	// the local seed state is.
	products, err := svc.ListForMember(ctx, 3, "no_such_line_aud_qa_002")
	if err != nil {
		t.Fatalf("ListForMember: %v", err)
	}
	if products == nil {
		t.Fatal("ListForMember returned nil slice — serializes as data:null")
	}
	body, err := json.Marshal(map[string]any{"data": products})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(body) != `{"data":[]}` {
		t.Fatalf("serialized %s, want data:[]", body)
	}
}
