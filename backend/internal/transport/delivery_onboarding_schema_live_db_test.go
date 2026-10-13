package transport_test

// LIVE-DB schema test for the delivery-provider onboarding migration
// (20271036000000): drivers gains service_interests/coverage_areas text[]
// defaulting to '{}', vehicles gains vehicle_type (CHECK car|motorcycle|bicycle,
// default car), and vehicles.plate_number becomes nullable so a bicycle courier
// has no plate. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func deliverySchemaPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping delivery-onboarding schema test")
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

func TestDeliveryOnboardingSchema_Integration(t *testing.T) {
	pool := deliverySchemaPool(t)
	defer pool.Close()
	ctx := context.Background()

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@delivery.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)

	var driverID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status)
		VALUES ($1,'Delivery Schema Driver',$2,'offline','draft') RETURNING id`,
		userID, "DLV-"+userID[:8]).Scan(&driverID); err != nil {
		t.Fatalf("seed driver: %v", err)
	}

	t.Run("drivers arrays default to empty, not null", func(t *testing.T) {
		var interests, areas []string
		if err := pool.QueryRow(ctx, `SELECT service_interests, coverage_areas FROM drivers WHERE id=$1`, driverID).Scan(&interests, &areas); err != nil {
			t.Fatalf("select arrays: %v", err)
		}
		if interests == nil || len(interests) != 0 || areas == nil || len(areas) != 0 {
			t.Fatalf("want empty non-nil arrays, got interests=%v areas=%v", interests, areas)
		}
	})

	t.Run("bicycle vehicle with null plate inserts", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `
			INSERT INTO vehicles (driver_id, vehicle_type) VALUES ($1,'bicycle')`, driverID); err != nil {
			t.Fatalf("bicycle insert should succeed with null plate: %v", err)
		}
	})

	t.Run("unknown vehicle_type is rejected by the CHECK", func(t *testing.T) {
		_, err := pool.Exec(ctx, `
			INSERT INTO vehicles (driver_id, plate_number, vehicle_type) VALUES ($1,'ABC123','scooter')`, driverID)
		if err == nil {
			t.Fatal("expected CHECK violation for vehicle_type='scooter', got nil")
		}
	})
}
