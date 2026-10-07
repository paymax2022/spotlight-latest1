package propertyroles_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// insertProfile inserts a fixture profile and registers its own teardown.
func insertProfile(ctx context.Context, t *testing.T, pool *pgxpool.Pool, userID, role string) (string, error) {
	t.Helper()
	var id string
	err := pool.QueryRow(ctx,
		`INSERT INTO property_role_profiles (user_id, role, display_name)
		 VALUES ($1::uuid, $2, $3) RETURNING id::text`,
		userID, role, fixtureName).Scan(&id)
	if err == nil {
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(),
				`DELETE FROM property_role_profiles WHERE id = $1::uuid`, id)
		})
	}
	return id, err
}

func pgCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

func TestSchema_UniquePerUserAndRole(t *testing.T) {
	ctx := context.Background()
	pool := propertyPool(t)
	user := anyUser(t, ctx, pool)

	if _, err := insertProfile(ctx, t, pool, user, "agent"); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	_, err := insertProfile(ctx, t, pool, user, "agent")
	if pgCode(err) != "23505" {
		t.Fatalf("second insert: want unique violation 23505, got %v", err)
	}
	if _, err := insertProfile(ctx, t, pool, user, "developer"); err != nil {
		t.Fatalf("different role for same user must be allowed: %v", err)
	}
}

func TestSchema_RejectsUnknownRole(t *testing.T) {
	ctx := context.Background()
	pool := propertyPool(t)
	user := anyUser(t, ctx, pool)

	_, err := insertProfile(ctx, t, pool, user, "landlord")
	if pgCode(err) != "23514" {
		t.Fatalf("want check violation 23514, got %v", err)
	}
}

func TestSchema_RejectsUnknownVerificationStatus(t *testing.T) {
	ctx := context.Background()
	pool := propertyPool(t)
	user := anyUser(t, ctx, pool)

	id, err := insertProfile(ctx, t, pool, user, "estate_manager")
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	_, err = pool.Exec(ctx,
		`UPDATE property_role_profiles SET verification_status = 'approved' WHERE id = $1::uuid`, id)
	if pgCode(err) != "23514" {
		t.Fatalf("want check violation 23514, got %v", err)
	}
}

func TestSchema_DocumentsCascadeWithProfile(t *testing.T) {
	ctx := context.Background()
	pool := propertyPool(t)
	user := anyUser(t, ctx, pool)

	id, err := insertProfile(ctx, t, pool, user, "agent")
	if err != nil {
		t.Fatalf("insert profile: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO property_role_documents (profile_id, kind, storage_key)
		 VALUES ($1::uuid, 'agent_licence', 'zz/fixture/key')`, id); err != nil {
		t.Fatalf("insert document: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO property_role_events (profile_id, actor_id, action)
		 VALUES ($1::uuid, $2::uuid, 'registered')`, id, user); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM property_role_profiles WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("delete profile: %v", err)
	}
	var docs, evs int
	if err := pool.QueryRow(ctx,
		`SELECT (SELECT count(*) FROM property_role_documents WHERE profile_id = $1::uuid),
		        (SELECT count(*) FROM property_role_events WHERE profile_id = $1::uuid)`, id).Scan(&docs, &evs); err != nil {
		t.Fatalf("count: %v", err)
	}
	if docs != 0 || evs != 0 {
		t.Fatalf("children must cascade; documents=%d events=%d", docs, evs)
	}
}
