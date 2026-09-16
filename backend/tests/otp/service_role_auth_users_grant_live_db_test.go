package otp_test

// ---------------------------------------------------------------------------
// LIVE test: service_role can actually read auth.users over the SAME
// connection setup production uses.
//
// WHY THIS EXISTS (AUTH-008)
// --------------------------
// Every other test in this package builds its pool with plain
// pgxpool.New(TEST_DATABASE_URL) (see liveDBPool in store_live_db_test.go).
// That connects as whatever role TEST_DATABASE_URL names — typically a
// superuser locally — and therefore cannot see a privilege problem that only
// exists for `service_role`.
//
// Production never connects that way. backend/internal/platform/db.New()
// runs `SET ROLE service_role` in AfterConnect on every pooled connection, to
// bypass RLS for the app's own queries (see db.go). That role held ZERO
// grants on `auth.users` until migration
// 20270202000000_service_role_auth_users_select.sql — so every query
// authUserByEmail() (backend/internal/services/email_verification.go) issued
// in production failed with `permission denied for table users (SQLSTATE
// 42501)`, even though the exact same query worked fine in this package's
// other "live DB" tests, because those tests were never running as
// service_role in the first place.
//
// That gap is what let AUTH-008 reach UAT: the existing live-DB suite was
// green while the deployed path 500'd on both email verification
// (ConfirmEmail) and OTP password reset (otp_login.go SetPassword).
//
// This test closes the gap by building its pool through db.New() — the real
// production constructor — so it runs under the same `SET ROLE
// service_role` every request does, and asserts both:
//  1. the raw grant (a plain SELECT against auth.users does not 42501), and
//  2. the actual call site (authUserByEmail, via ConfirmEmail) succeeds
//     end-to-end against a real GoTrue user.
//
// A future revert of the GRANT (e.g. a "cleanup" migration that narrows
// service_role privileges) fails this test instead of only being discovered
// against production, the way AUTH-008 was.
//
// Gated on TEST_DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY —
// same gates as confirm_email_live_db_test.go, since this needs both a real
// Postgres and a real GoTrue to talk to.
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	export SUPABASE_URL="http://127.0.0.1:54321"
//	export SUPABASE_SERVICE_ROLE_KEY="<local service role key>"
//	cd backend && go test ./tests/otp/... -run LiveDB_ServiceRole -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	dbplatform "spotlight/backend/internal/platform/db"
	"spotlight/backend/internal/services"
)

// serviceRolePool builds a pool exactly the way production does — through
// db.New(), which SETs ROLE service_role on every connection — rather than
// through liveDBPool's plain pgxpool.New(). Using the real constructor is the
// point: a helper that reimplemented "SET ROLE service_role" inline could
// drift from db.go and stop testing what production actually does.
func serviceRolePool(t *testing.T) *dbplatform.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB service_role grant test")
	}
	pool, err := dbplatform.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("db.New (production pool constructor): %v", err)
	}
	if err := dbplatform.Ping(context.Background(), pool); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestLiveDB_ServiceRoleCanSelectAuthUsers pins the raw GRANT. Without
// migration 20270202000000, this fails with "permission denied for table
// users (SQLSTATE 42501)" — the exact error AUTH-008 reproduced.
func TestLiveDB_ServiceRoleCanSelectAuthUsers(t *testing.T) {
	ctx := context.Background()
	pool := serviceRolePool(t)

	var confirmedRole string
	if err := pool.QueryRow(ctx, "SELECT current_setting('role')").Scan(&confirmedRole); err != nil {
		t.Fatalf("read current role: %v", err)
	}
	if confirmedRole != "service_role" {
		t.Fatalf("pool is not running as service_role (got %q) — this test is not exercising the production connection setup", confirmedRole)
	}

	// 0 or more rows is fine; the point is that the query does not 42501.
	rows, err := pool.Query(ctx, "SELECT id FROM auth.users LIMIT 1")
	if err != nil {
		t.Fatalf("SELECT id FROM auth.users as service_role: %v — service_role has lost its SELECT grant on auth.users (see migration 20270202000000_service_role_auth_users_select.sql)", err)
	}
	rows.Close()
	if rows.Err() != nil {
		t.Fatalf("iterate auth.users: %v", rows.Err())
	}
}

// TestLiveDB_ConfirmEmailWorksUnderServiceRole exercises the actual call
// site — authUserByEmail via ConfirmEmail — under the production connection
// setup, against a real GoTrue user. This is the end-to-end regression for
// the OTP email-verification 500 reported in AUTH-008.
func TestLiveDB_ConfirmEmailWorksUnderServiceRole(t *testing.T) {
	ctx := context.Background()
	pool := serviceRolePool(t)
	supabase, url, key := supabaseForTest(t)

	email := "auth008-svcrole-" + uuid.NewString() + "@test.local"
	id := createUnconfirmedUser(t, url, key, email)

	verifier := services.NewSupabaseEmailVerifier(pool, supabase)
	if verifier == nil {
		t.Fatal("NewSupabaseEmailVerifier returned nil with both dependencies present")
	}

	confirmed, err := verifier.ConfirmEmail(ctx, email)
	if err != nil {
		t.Fatalf("ConfirmEmail under service_role: %v — this is the AUTH-008 regression: authUserByEmail's SELECT against auth.users fails as service_role", err)
	}
	if !confirmed {
		t.Fatal("ConfirmEmail reported no account for a user that was just created")
	}

	var confirmedAt *string
	if err := pool.QueryRow(ctx,
		`SELECT email_confirmed_at::text FROM auth.users WHERE id = $1`, id).Scan(&confirmedAt); err != nil {
		t.Fatalf("read back email_confirmed_at: %v", err)
	}
	if confirmedAt == nil {
		t.Fatal("email_confirmed_at is still NULL after ConfirmEmail succeeded")
	}

	// Guard against a vacuous pass: if the email were somehow empty or
	// whitespace-only, ConfirmEmail's early return would also report
	// (false, nil) and never touch the database at all.
	if strings.TrimSpace(email) == "" {
		t.Fatal("test email was empty — the earlier assertions would have passed vacuously")
	}
}
