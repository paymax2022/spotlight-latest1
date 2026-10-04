package utilitybills

// Tests for E2E-MTL-001: a duplicate category-setting create used to surface the
// raw Postgres unique_violation text through the 500 catch-all. The contract is
// now 409 + code "category_exists" — the repository maps SQLSTATE 23505 to
// ErrCategoryExists (same place InsertTransaction maps the idempotency-key
// collision) and writeErr maps the sentinel.
//
// The writeErr assertions are pure (gin test context). The repository mapping is
// exercised against the live DB only when TEST_DATABASE_URL is set, mirroring
// invest's live_journey_test gating.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWriteErr_CategoryExistsIsConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/finance/admin/utilitybills/categories", nil)

	writeErr(c, fmt.Errorf("service layer: %w", ErrCategoryExists))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"category_exists"`) {
		t.Fatalf("body must carry the stable code category_exists, got %s", rec.Body.String())
	}
}

func livePoolUtilitybills(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping utilitybills live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestLiveDB_CreateCategorySetting_DuplicateIs409Sentinel posts the same
// category twice and requires the second insert to surface ErrCategoryExists —
// never the raw 23505 text. Works whether or not the six seed rows are present:
// the first create may be a fresh insert OR already a duplicate; the second is
// unconditionally one.
func TestLiveDB_CreateCategorySetting_DuplicateIs409Sentinel(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	svc := NewService(Deps{Repo: NewRepository(pool)})

	first, err := svc.CreateCategorySetting(ctx, "mtl-test", CategorySettingInput{
		Category: string(CategoryAirtime),
	})
	if err != nil && !errors.Is(err, ErrCategoryExists) {
		t.Fatalf("first create must succeed or already exist, got %v", err)
	}
	if err == nil && first == nil {
		t.Fatal("a successful create must return the row")
	}

	_, err = svc.CreateCategorySetting(ctx, "mtl-test", CategorySettingInput{
		Category: string(CategoryAirtime),
	})
	if !errors.Is(err, ErrCategoryExists) {
		t.Fatalf("duplicate create must return ErrCategoryExists, got %v", err)
	}
	if strings.Contains(err.Error(), "SQLSTATE") || strings.Contains(err.Error(), "23505") ||
		strings.Contains(err.Error(), "duplicate key") {
		t.Fatalf("the raw Postgres violation must not leak into the domain error: %v", err)
	}
}
