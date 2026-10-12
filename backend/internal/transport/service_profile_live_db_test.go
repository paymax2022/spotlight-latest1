package transport_test

// LIVE-DB test for delivery-provider service profile + vehicle-type rules.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

func serviceProfilePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping service-profile live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func seedProfileDriver(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@svcprofile.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status)
		VALUES ($1,'Svc Profile Driver',$2,'offline','draft')`,
		userID, "SVC-"+userID[:8]); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	return userID
}

func TestSetServiceProfile_PersistsDedupedAndReadsBack_Integration(t *testing.T) {
	pool := serviceProfilePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := transport.NewService(pool, nil)
	userID := seedProfileDriver(t, ctx, pool)

	vi, ca, err := svc.SetServiceProfile(ctx, userID, []string{"rides", "rides", "movers"}, []string{"ikeja", "ikeja", "yaba"})
	if err != nil {
		t.Fatalf("SetServiceProfile: %v", err)
	}
	if len(vi) != 2 || len(ca) != 2 {
		t.Fatalf("want deduped (2,2), got (%d,%d)", len(vi), len(ca))
	}

	me, err := svc.DriverMeFull(ctx, userID)
	if err != nil {
		t.Fatalf("DriverMeFull: %v", err)
	}
	gotVI, _ := me["service_interests"].([]string)
	gotCA, _ := me["coverage_areas"].([]string)
	if len(gotVI) != 2 || gotVI[0] != "rides" || gotVI[1] != "movers" {
		t.Fatalf("service_interests readback = %v", me["service_interests"])
	}
	if len(gotCA) != 2 {
		t.Fatalf("coverage_areas readback = %v", me["coverage_areas"])
	}
}

func TestSetServiceProfile_RejectsUnknown_Integration(t *testing.T) {
	pool := serviceProfilePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := transport.NewService(pool, nil)
	userID := seedProfileDriver(t, ctx, pool)
	if _, _, err := svc.SetServiceProfile(ctx, userID, []string{"teleport"}, nil); err == nil {
		t.Fatal("expected error for unknown service interest")
	}
}

func TestDriverMeFull_EmptyArraysNotNull_Integration(t *testing.T) {
	pool := serviceProfilePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := transport.NewService(pool, nil)
	userID := seedProfileDriver(t, ctx, pool)
	me, err := svc.DriverMeFull(ctx, userID)
	if err != nil {
		t.Fatalf("DriverMeFull: %v", err)
	}
	vi, ok := me["service_interests"].([]string)
	if !ok || vi == nil {
		t.Fatalf("service_interests must be a non-nil []string, got %T %v", me["service_interests"], me["service_interests"])
	}
	if len(vi) != 0 {
		t.Fatalf("fresh driver should have empty interests, got %v", vi)
	}
}

func TestAddVehicle_VehicleTypeRules_Integration(t *testing.T) {
	pool := serviceProfilePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := transport.NewService(pool, nil)
	userID := seedProfileDriver(t, ctx, pool)

	if _, err := svc.AddVehicle(ctx, userID, transport.VehicleRequest{VehicleType: "bicycle"}); err != nil {
		t.Fatalf("bicycle with empty plate should be allowed: %v", err)
	}
	if _, err := svc.AddVehicle(ctx, userID, transport.VehicleRequest{VehicleType: "car"}); err == nil {
		t.Fatal("car with empty plate should be rejected")
	}
	if _, err := svc.AddVehicle(ctx, userID, transport.VehicleRequest{VehicleType: "scooter", PlateNumber: "ABC123"}); err == nil {
		t.Fatal("unknown vehicle_type should be rejected before INSERT (no CHECK 500)")
	}
}
