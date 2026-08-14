package onboarding_test

// LIVE-DB test for CreateApplication's module/merchant-type "closed" enforcement.
// Regression for the gap where an OPEN merchant type under a CLOSED module was
// still applyable (create checked the type status only, not the module status).
//
// Skips unless TEST_DATABASE_URL is set. onb_application.user_id has
// no hard FK, so a random uuid works as the caller.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/onboarding"
)

func liveOnbPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping onboarding module-closed live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

func TestLiveDB_CreateApplication_ModuleClosedEnforced(t *testing.T) {
	pool := liveOnbPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := onboarding.NewService(pool) // no business gate (nil) — isolate the module check

	tok := uuid.New().String()[:8]
	modID := "mod-test-" + tok
	typeID := "mt-test-" + tok

	// A CLOSED module with an OPEN merchant type.
	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_module (id,slug,name,description,icon,icon_color,bg_color,status,sort_order)
		 VALUES ($1,$1,'Test','t','X','#000000','#000000','closed',99)`, modID); err != nil {
		t.Fatalf("seed module: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_merchant_type (id,module_id,slug,name,description,icon,requirements_summary,
		    expected_review_label,required_kyc_tier,role_to_grant,current_form_schema_id,status)
		 VALUES ($1,$2,'test','Test','t','X','[]'::jsonb,'x',0,'restaurant_merchant','fs-seller-v1','open')`,
		typeID, modID); err != nil {
		t.Fatalf("seed type: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM onb_application WHERE merchant_type_id=$1`, typeID)
		pool.Exec(context.Background(), `DELETE FROM onb_merchant_type WHERE id=$1`, typeID)
		pool.Exec(context.Background(), `DELETE FROM onb_module WHERE id=$1`, modID)
	})

	// Open type, CLOSED module → must be rejected (the fix).
	if _, err := svc.CreateApplication(ctx, uuid.New().String(),
		onboarding.CreateApplicationRequest{MerchantTypeID: typeID}); !errors.Is(err, onboarding.ErrModuleClosed) {
		t.Fatalf("open type under CLOSED module: want ErrModuleClosed, got %v", err)
	}

	// Open the module → now a create succeeds.
	if _, err := pool.Exec(ctx, `UPDATE onb_module SET status='open' WHERE id=$1`, modID); err != nil {
		t.Fatalf("open module: %v", err)
	}
	app, err := svc.CreateApplication(ctx, uuid.New().String(),
		onboarding.CreateApplicationRequest{MerchantTypeID: typeID})
	if err != nil {
		t.Fatalf("open type under OPEN module: want success, got %v", err)
	}
	if app == nil || app.Status != "DRAFT" {
		t.Fatalf("created application should be DRAFT, got %+v", app)
	}

	// Closing the merchant type also blocks (the pre-existing enforcement).
	if _, err := pool.Exec(ctx, `UPDATE onb_merchant_type SET status='closed' WHERE id=$1`, typeID); err != nil {
		t.Fatalf("close type: %v", err)
	}
	if _, err := svc.CreateApplication(ctx, uuid.New().String(),
		onboarding.CreateApplicationRequest{MerchantTypeID: typeID}); !errors.Is(err, onboarding.ErrModuleClosed) {
		t.Fatalf("closed type: want ErrModuleClosed, got %v", err)
	}
}
