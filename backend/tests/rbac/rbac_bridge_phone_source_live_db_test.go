package rbac_test

// ---------------------------------------------------------------------------
// LIVE-DB regression: rbac_bridge_on_auth_insert() copies platform_users.phone
// from the SAME source a real signup actually populates.
//
// WHY THIS EXISTS (ADR-055, 20270204010000_rbac_bridge_phone_metadata_source.sql)
// --------------------------------------------------------------------------
// ADR-053 (20270203000000_rbac_bridge_phone_only_identities.sql) added `phone`
// to the RBAC bridge's mirror insert, copying `NEW.phone` — GoTrue's own
// top-level auth.users column. RegisterUser (backend/internal/services/
// auth_service.go) never sets that column: it sends phone inside the signup/
// admin-create request's "data"/"user_metadata" payload, which GoTrue stores
// at raw_user_meta_data->>'phone', and separately PATCHes it onto
// user_profiles.phone afterward. So ADR-053's copy was a structural no-op for
// every real user — confirmed on local Supabase before this fix: 0 of 57,703
// platform_users rows carried a phone.
//
// This test seeds an auth.users row the way RegisterUser's GoTrue payload
// actually shapes one (phone inside raw_user_meta_data, top-level phone
// column left blank) and asserts platform_users.phone comes out populated —
// pinning the fix, not just the absence of an error.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other live-DB
// suites (see backend/tests/otp/store_live_db_test.go).
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/rbac/... -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func rbacPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping RBAC bridge phone-source live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func platformUserPhone(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) *string {
	t.Helper()
	var phone *string
	if err := pool.QueryRow(ctx, `SELECT phone FROM public.platform_users WHERE id=$1`, userID).Scan(&phone); err != nil {
		t.Fatalf("read platform_users.phone for %s: %v", userID, err)
	}
	return phone
}

// The exact shape RegisterUser produces: phone inside raw_user_meta_data,
// auth.users.phone itself left blank.
func TestLiveDB_RBACBridge_MirrorsPhoneFromMetadata(t *testing.T) {
	pool := rbacPool(t)
	ctx := context.Background()

	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, raw_user_meta_data)
		 VALUES ($1, $2, jsonb_build_object('phone', $3::text, 'full_name', 'RBAC Phone Test'))`,
		uid, uid+"@seed.test", "+2348011112222"); err != nil {
		t.Fatalf("seed auth.users with metadata phone: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)

	got := platformUserPhone(t, ctx, pool, uid)
	if got == nil || *got != "+2348011112222" {
		t.Fatalf("platform_users.phone = %v, want +2348011112222 — the bridge did not read raw_user_meta_data->>'phone'", got)
	}
}

// The raw auth.users.phone column must still work as a fallback — a future
// signup path (native Supabase phone/SMS auth) may set only that column, with
// no metadata at all.
func TestLiveDB_RBACBridge_FallsBackToRawPhoneColumn(t *testing.T) {
	pool := rbacPool(t)
	ctx := context.Background()

	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, phone) VALUES ($1, $2)`, uid, "+2348033334444"); err != nil {
		t.Fatalf("seed auth.users with raw phone, no metadata: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)

	got := platformUserPhone(t, ctx, pool, uid)
	if got == nil || *got != "+2348033334444" {
		t.Fatalf("platform_users.phone = %v, want +2348033334444 — the raw NEW.phone fallback regressed", got)
	}
}

// Metadata wins when both are present, matching handle_new_user's own
// COALESCE order (raw_user_meta_data first) so the two triggers cannot mirror
// the same signup to two different phone numbers.
func TestLiveDB_RBACBridge_MetadataPhoneWinsOverRawColumn(t *testing.T) {
	pool := rbacPool(t)
	ctx := context.Background()

	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, phone, raw_user_meta_data)
		 VALUES ($1, $2, jsonb_build_object('phone', $3::text))`,
		uid, "+2340000000000", "+2348055556666"); err != nil {
		t.Fatalf("seed auth.users with both phone sources: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)

	got := platformUserPhone(t, ctx, pool, uid)
	if got == nil || *got != "+2348055556666" {
		t.Fatalf("platform_users.phone = %v, want the metadata value +2348055556666 (metadata must win)", got)
	}
}

// The backfill half of the same migration: an existing platform_users row
// left blank by ADR-053's own (NEW.phone-only) backfill must be filled in
// once its auth.users metadata is inspected with the corrected COALESCE.
//
// This directly exercises the migration's UPDATE statement's premise rather
// than re-running it (the migration already ran once on this database) — it
// simulates "a row the old backfill missed" by blanking platform_users.phone
// back out after the trigger ran, then re-applying the same COALESCE logic
// the migration's backfill uses, to prove it would have caught this row.
func TestLiveDB_RBACBridge_BackfillLogicFillsBlankFromMetadata(t *testing.T) {
	pool := rbacPool(t)
	ctx := context.Background()

	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, raw_user_meta_data)
		 VALUES ($1, $2, jsonb_build_object('phone', $3::text))`,
		uid, uid+"@seed.test", "+2348077778888"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)

	// Simulate a pre-migration row: the trigger already mirrored it correctly
	// (this test runs after the fix), so blank it out to represent the state
	// ADR-053's backfill would have left behind.
	if _, err := pool.Exec(ctx, `UPDATE public.platform_users SET phone = '' WHERE id=$1`, uid); err != nil {
		t.Fatalf("blank platform_users.phone: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE public.platform_users pu
		SET    phone = COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, ''))
		FROM   auth.users u
		WHERE  u.id = pu.id
		  AND  COALESCE(pu.phone, '') = ''
		  AND  pu.id = $1
		  AND  COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, '')) IS NOT NULL`, uid); err != nil {
		t.Fatalf("run backfill logic: %v", err)
	}

	got := platformUserPhone(t, ctx, pool, uid)
	if got == nil || *got != "+2348077778888" {
		t.Fatalf("platform_users.phone after backfill = %v, want +2348077778888", got)
	}
}
