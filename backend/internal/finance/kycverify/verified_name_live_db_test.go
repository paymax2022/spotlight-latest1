package kycverify

// LIVE-DB test for VerifiedLegalName: only a PASSED ID-number check counts, the
// most recent one wins, and a user with none gets ok=false.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestVerifiedLegalName_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping verified-name test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	repo := NewRepository(pool)

	user := uuid.NewString()
	t.Cleanup(func() {
		bg := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(bg, `DELETE FROM verification_check WHERE user_id=$1`, user)
		_, _ = pool.Exec(bg, `DELETE FROM verification_session WHERE user_id=$1`, user)
	})

	if _, _, ok, err := repo.VerifiedLegalName(ctx, user); err != nil || ok {
		t.Fatalf("no checks: ok=%v err=%v, want ok=false", ok, err)
	}

	var sess string
	if err := pool.QueryRow(ctx, `INSERT INTO verification_session (user_id, target_tier) VALUES ($1, 1) RETURNING id`, user).Scan(&sess); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	seed := func(typ, status, fields, ago string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO verification_check (session_id, user_id, type, status, client_ref, extracted_fields, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() - $7::interval)`,
			sess, user, typ, status, uuid.NewString(), fields, ago); err != nil {
			t.Fatalf("seed check: %v", err)
		}
	}
	check := func(label, wantName string, wantStrong bool) {
		t.Helper()
		name, strong, ok, err := repo.VerifiedLegalName(ctx, user)
		if err != nil || !ok {
			t.Fatalf("%s: ok=%v err=%v", label, ok, err)
		}
		if name != wantName || strong != wantStrong {
			t.Fatalf("%s: got (%q, strong=%v), want (%q, strong=%v)", label, name, strong, wantName, wantStrong)
		}
	}

	seed("ID_NUMBER", "FAILED", `{"first_name":"Peter","last_name":"Obi","_id_type":"bvn"}`, "5 hours")
	seed("DOCUMENT", "PASSED", `{"first_name":"Doc","last_name":"Only"}`, "5 hours")
	if _, _, ok, _ := repo.VerifiedLegalName(ctx, user); ok {
		t.Fatal("a FAILED ID check or a non-ID check must not yield a verified name")
	}

	// A legacy check (no recorded ID type) gives a name, but never a strong one.
	seed("ID_NUMBER", "PASSED", `{"first_name":"John","last_name":"Smith"}`, "4 hours")
	check("legacy only", "John Smith", false)

	// A BVN check that passed while the ownership gate was off proves nothing about
	// ownership: it is not an anchor, even after the gate is turned on.
	seed("ID_NUMBER", "PASSED", `{"first_name":"John","last_name":"Smith","_id_type":"bvn"}`, "3 hours 30 minutes")
	check("BVN without ownership proof", "John Smith", false)

	// A BVN check that passed the ownership gate anchors the identity; the
	// consistent earlier names keep it strong.
	seed("ID_NUMBER", "PASSED", `{"first_name":"John","middle_name":"Adewale","last_name":"Smith","_id_type":"bvn","_ownership_verified":"true","confidence":97}`, "3 hours")
	check("anchored by owned BVN", "John Adewale Smith", true)

	// A later check on someone else's driver's licence (no ownership proof)
	// neither replaces the anchored name nor leaves it strong.
	seed("ID_NUMBER", "PASSED", `{"first_name":"Peter","last_name":"Obi","_id_type":"drivers_license"}`, "1 hour")
	check("conflicting later check", "John Adewale Smith", false)
}
