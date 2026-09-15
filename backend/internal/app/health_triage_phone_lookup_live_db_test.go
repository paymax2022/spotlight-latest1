package app

// ---------------------------------------------------------------------------
// LIVE-DB regression: the WhatsApp health-triage driver resolves a real user by
// phone.
//
// health_triage_routes.go's StartOrContinue used to look the caller up against
// auth.users.phone directly — a query the service_role pgx pool cannot even run
// (Supabase never grants service_role SELECT on the auth schema; see
// ADR-052/90e8c5b1). Repointing it at platform_users.phone (ADR-052's own fix
// elsewhere) does not help either: no signup path in this codebase ever
// populates that column (ADR-053) — confirmed against local Supabase, 0 of
// ~57k platform_users rows carry a phone. The number a user actually registered
// with only ever reaches public.user_profiles.phone, via RegisterUser's PATCH
// (services/auth_service.go). This test pins the fix: resolveUserIDByPhone reads
// user_profiles, matching on the national significant number the same way
// sign-in already does (services.NormalizePhone + user_profiles_phone_nsn_idx),
// since stored phones are not normalised.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other live-DB
// suites in this package (see internal_ledger_routes_test.go).
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run HealthTriage_ -v
// ---------------------------------------------------------------------------

import (
	"context"
	"math/rand"
	"os"
	"strconv"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// freshNSN returns a random 10-digit national significant number. This is a
// shared, long-lived local database — other suites' fixtures already occupy
// several "obvious" test numbers (08159491618, +2347001234567, …), and a
// collision would silently match a stranger's pre-existing row instead of the
// one this test just seeded via a bare LIMIT 1. Randomising sidesteps that
// instead of trying to enumerate every fixture number in use.
func freshNSN() string {
	return strconv.Itoa(70_0000_0000 + rand.Intn(29_9999_9999))
}

func healthTriagePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping WhatsApp triage phone-lookup live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedUserWithPhone creates a real auth.users row (handle_new_user mirrors it
// into user_profiles) and then writes user_profiles.phone the same way
// RegisterUser's post-signup PATCH does — the only place a registered user's
// phone actually ends up.
func seedUserWithPhone(t *testing.T, ctx context.Context, pool *pgxpool.Pool, phone string) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, uid, uid+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	if _, err := pool.Exec(ctx,
		`UPDATE public.user_profiles SET phone=$1 WHERE id=$2`, phone, uid); err != nil {
		t.Fatalf("seed user_profiles.phone: %v", err)
	}
	return uid
}

func TestLiveDB_HealthTriage_ResolvesUserByPhoneFromUserProfiles(t *testing.T) {
	pool := healthTriagePool(t)
	ctx := context.Background()

	// Stored the way a real profile holds it: leading 0, no country code.
	nsn := freshNSN()
	uid := seedUserWithPhone(t, ctx, pool, "0"+nsn)

	// The wa_id WhatsApp actually sends: digits only, country code, no '+'.
	got := resolveUserIDByPhone(ctx, pool, "234"+nsn)
	if got != uid {
		t.Fatalf("resolveUserIDByPhone = %q, want %q — the WhatsApp lookup did not find the registered user", got, uid)
	}

	// Confirm the fix is actually reading user_profiles, not the never-populated
	// platform_users mirror: this test never touched platform_users.phone.
	var platformPhone *string
	if err := pool.QueryRow(ctx, `SELECT phone FROM public.platform_users WHERE id=$1`, uid).Scan(&platformPhone); err != nil {
		t.Fatalf("read platform_users.phone: %v", err)
	}
	if platformPhone != nil && *platformPhone != "" {
		t.Fatalf("platform_users.phone unexpectedly set to %q — this test's premise (it is never populated by signup) no longer holds", *platformPhone)
	}
}

// A stored phone in full E.164 (with a leading '+') must resolve identically —
// stored phones are not normalised, so the lookup has to handle both shapes.
func TestLiveDB_HealthTriage_ResolvesUserByPhoneStoredAsE164(t *testing.T) {
	pool := healthTriagePool(t)
	ctx := context.Background()

	nsn := freshNSN()
	uid := seedUserWithPhone(t, ctx, pool, "+234"+nsn)

	got := resolveUserIDByPhone(ctx, pool, "234"+nsn)
	if got != uid {
		t.Fatalf("resolveUserIDByPhone = %q, want %q", got, uid)
	}
}

func TestLiveDB_HealthTriage_UnregisteredPhoneFindsNoUser(t *testing.T) {
	pool := healthTriagePool(t)
	ctx := context.Background()

	if got := resolveUserIDByPhone(ctx, pool, "2340000000000"); got != "" {
		t.Fatalf("resolveUserIDByPhone for an unregistered number = %q, want \"\"", got)
	}
}
