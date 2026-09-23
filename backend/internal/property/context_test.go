package property

// ---------------------------------------------------------------------------
// context.go coverage: the pure validContextTypes gate (DB-free), plus
// live-DB tests for GetContext's role-merge/de-dup behavior and
// SwitchContext's fail-closed membership check — both of which query real
// tables (estate_residents, estates, estate_properties, realtor_portfolios,
// property_active_context) and cannot be exercised without a live Postgres.
//
// Gated on TEST_DATABASE_URL only (never DATABASE_URL — see
// backend/tests/TEST_STRATEGY.md "Live-DB suites" rule 1; DATABASE_URL points
// at the production Supabase pooler). Run locally with:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./backend/internal/property/... -run TestLiveDB -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── validContextTypes gate (pure, no DB) ──────────────────────────────────

func TestValidContextTypes_OnlyFourAccepted(t *testing.T) {
	cases := []struct {
		typ   string
		valid bool
	}{
		{"estate", true},
		{"property", true},
		{"agency", true},
		{"org", true},
		{"vehicle", false},
		{"", false},
		{"ESTATE", false}, // case-sensitive — must not silently accept a case variant
		{"org ", false},   // trailing space must not sneak through
	}
	for _, tc := range cases {
		if got := validContextTypes[tc.typ]; got != tc.valid {
			t.Errorf("validContextTypes[%q] = %v, want %v", tc.typ, got, tc.valid)
		}
	}
	if len(validContextTypes) != 4 {
		t.Errorf("validContextTypes has %d entries, want exactly 4 (estate|property|agency|org)", len(validContextTypes))
	}
}

// ── Live-DB fixtures ───────────────────────────────────────────────────────

func newPropertyTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB property test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedAuthUser inserts a throwaway auth.users row (email required by the
// on_auth_user_created -> user_profiles mirror trigger; .invalid per RFC 2606
// so the address can never be routable) and registers best-effort cleanup.
func seedAuthUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, created_at) VALUES ($1, $2, NOW())`,
		id, id+"@property-test.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, id) })
	return id
}

// ── GetContext: role merge / de-duplication ───────────────────────────────

// TestLiveDB_GetContext_MergesDualRolesOnOneEntity is PROPERTY-UNIT-002: a
// user who is BOTH landlord and tenant of the same property, and both
// resident AND estate_admin of the same estate, must appear ONCE per entity
// with both roles listed — never as two separate entity rows.
func TestLiveDB_GetContext_MergesDualRolesOnOneEntity(t *testing.T) {
	pool := newPropertyTestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	user := seedAuthUser(t, pool)

	// Estate: user is both a resident row (role='resident') AND the estate's
	// admin_id owner -> should merge into ONE estate entity with
	// roles ⊇ {resident, estate_admin}.
	estateID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estates (id, name, admin_id) VALUES ($1, 'Dual Role Estate', $2)`,
		estateID, user); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, estateID) })
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_residents (estate_id, user_id, role) VALUES ($1, $2, 'resident')`,
		estateID, user); err != nil {
		t.Fatalf("seed estate_residents: %v", err)
	}

	// Property: user is BOTH landlord_id and tenant_id on the same row.
	propID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_properties (id, estate_id, unit_label, landlord_id, tenant_id)
		 VALUES ($1, $2, 'Flat 3B', $3, $3)`,
		propID, estateID, user); err != nil {
		t.Fatalf("seed estate_properties: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_properties WHERE id=$1`, propID) })

	resp, err := svc.GetContext(ctx, user)
	if err != nil {
		t.Fatalf("GetContext: %v", err)
	}

	byKey := map[string]ContextEntity{}
	for _, e := range resp.Contexts {
		key := e.Type + ":" + e.ID
		if _, dup := byKey[key]; dup {
			t.Fatalf("entity %s appears more than once in Contexts — merge/de-dup failed: %+v", key, resp.Contexts)
		}
		byKey[key] = e
	}

	estateEntity, ok := byKey["estate:"+estateID]
	if !ok {
		t.Fatalf("estate %s missing from contexts: %+v", estateID, resp.Contexts)
	}
	if !hasRole(estateEntity.Roles, "resident") || !hasRole(estateEntity.Roles, "estate_admin") {
		t.Errorf("estate entity roles = %v, want both resident and estate_admin merged", estateEntity.Roles)
	}

	propEntity, ok := byKey["property:"+propID]
	if !ok {
		t.Fatalf("property %s missing from contexts: %+v", propID, resp.Contexts)
	}
	if !hasRole(propEntity.Roles, "landlord") || !hasRole(propEntity.Roles, "tenant") {
		t.Errorf("property entity roles = %v, want both landlord and tenant merged", propEntity.Roles)
	}
	if len(propEntity.Roles) != 2 {
		t.Errorf("property entity roles = %v, want exactly 2 distinct roles (no duplicate 'landlord'/'landlord')", propEntity.Roles)
	}
}

// TestLiveDB_GetContext_AggregatesAllFourSources is PROPERTY-INT-001 (the
// happy path across estate residency, estate ownership, property assignment,
// and agency ownership), kept minimal: one entity per source, each distinct.
func TestLiveDB_GetContext_AggregatesAllFourSources(t *testing.T) {
	pool := newPropertyTestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	user := seedAuthUser(t, pool)
	otherAdmin := seedAuthUser(t, pool)

	// E1: resident only.
	e1 := uuid.NewString()
	pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'E1',$2)`, e1, otherAdmin)
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, e1) })
	if _, err := pool.Exec(ctx, `INSERT INTO estate_residents (estate_id, user_id, role) VALUES ($1,$2,'resident')`, e1, user); err != nil {
		t.Fatalf("seed E1 resident: %v", err)
	}

	// E2: admin_id ownership only (no estate_residents row).
	e2 := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'E2',$2)`, e2, user); err != nil {
		t.Fatalf("seed E2: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, e2) })

	// P1: landlord assignment, on a third estate so it doesn't collide with E1/E2.
	e3 := uuid.NewString()
	pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'E3',$2)`, e3, otherAdmin)
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, e3) })
	p1 := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO estate_properties (id, estate_id, unit_label, landlord_id) VALUES ($1,$2,'P1',$3)`, p1, e3, user); err != nil {
		t.Fatalf("seed P1: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_properties WHERE id=$1`, p1) })

	// A1: agency/portfolio ownership.
	a1 := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_portfolios (id, owner_id, name) VALUES ($1,$2,'A1')`, a1, user); err != nil {
		t.Fatalf("seed A1: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM realtor_portfolios WHERE id=$1`, a1) })

	resp, err := svc.GetContext(ctx, user)
	if err != nil {
		t.Fatalf("GetContext: %v", err)
	}
	want := map[string]string{ // key -> expected single role
		"estate:" + e1:   "resident",
		"estate:" + e2:   "estate_admin",
		"property:" + p1: "landlord",
		"agency:" + a1:   "agency_owner",
	}
	got := map[string]ContextEntity{}
	for _, e := range resp.Contexts {
		got[e.Type+":"+e.ID] = e
	}
	for key, role := range want {
		e, ok := got[key]
		if !ok {
			t.Errorf("missing entity %s in %+v", key, resp.Contexts)
			continue
		}
		if !hasRole(e.Roles, role) {
			t.Errorf("entity %s roles = %v, want to include %q", key, e.Roles, role)
		}
	}
}

func hasRole(roles []string, want string) bool {
	for _, r := range roles {
		if r == want {
			return true
		}
	}
	return false
}

// ── SwitchContext: fail-closed membership ─────────────────────────────────

// TestLiveDB_SwitchContext_FailClosedOnNonHeldContext is PROPERTY-AUTHZ-006:
// switching into a context the caller has NO role in must error and must NOT
// write or change the property_active_context row.
func TestLiveDB_SwitchContext_FailClosedOnNonHeldContext(t *testing.T) {
	pool := newPropertyTestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	user := seedAuthUser(t, pool)
	unheldAgencyID := uuid.NewString() // never granted to user in any way

	if _, err := svc.SwitchContext(ctx, user, "agency", unheldAgencyID); err == nil {
		t.Fatal("SwitchContext into an unheld agency must return an error (fail-closed)")
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM property_active_context WHERE user_id=$1`, user).Scan(&count); err != nil {
		t.Fatalf("query property_active_context: %v", err)
	}
	if count != 0 {
		t.Fatalf("property_active_context has %d row(s) for user after a refused switch, want 0 — the fail-closed check did not prevent the write", count)
	}
}

// TestLiveDB_SwitchContext_SucceedsIntoHeldContext is PROPERTY-AUTHZ-005: a
// caller who genuinely holds a role in the target context can switch, and the
// upsert persists.
func TestLiveDB_SwitchContext_SucceedsIntoHeldContext(t *testing.T) {
	pool := newPropertyTestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	user := seedAuthUser(t, pool)
	admin := seedAuthUser(t, pool)

	estateID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'Held Estate',$2)`, estateID, admin); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, estateID) })
	if _, err := pool.Exec(ctx, `INSERT INTO estate_residents (estate_id, user_id, role) VALUES ($1,$2,'resident')`, estateID, user); err != nil {
		t.Fatalf("seed estate_residents: %v", err)
	}

	ref, err := svc.SwitchContext(ctx, user, "estate", estateID)
	if err != nil {
		t.Fatalf("SwitchContext into held estate: %v", err)
	}
	if ref.Type != "estate" || ref.ID != estateID {
		t.Errorf("SwitchContext returned %+v, want {estate %s}", ref, estateID)
	}

	var gotType, gotID string
	if err := pool.QueryRow(ctx,
		`SELECT context_type, context_id::TEXT FROM property_active_context WHERE user_id=$1`, user).
		Scan(&gotType, &gotID); err != nil {
		t.Fatalf("reload property_active_context: %v", err)
	}
	if gotType != "estate" || gotID != estateID {
		t.Errorf("persisted active context = (%s,%s), want (estate,%s)", gotType, gotID, estateID)
	}

	resp, err := svc.GetContext(ctx, user)
	if err != nil {
		t.Fatalf("GetContext after switch: %v", err)
	}
	if resp.ActiveContext == nil || resp.ActiveContext.Type != "estate" || resp.ActiveContext.ID != estateID {
		t.Errorf("GetContext.ActiveContext = %+v, want echo of the switched estate", resp.ActiveContext)
	}
}

// TestLiveDB_SwitchContext_InvalidContextTypeRejected is PROPERTY-VAL-007,
// exercised through the live service (validContextTypes itself is already
// covered DB-free above; this proves SwitchContext actually consults it and
// never reaches the membership check or the DB write for a bad enum value).
func TestLiveDB_SwitchContext_InvalidContextTypeRejected(t *testing.T) {
	pool := newPropertyTestPool(t)
	ctx := context.Background()
	svc := NewService(pool)
	user := seedAuthUser(t, pool)

	if _, err := svc.SwitchContext(ctx, user, "vehicle", uuid.NewString()); err == nil {
		t.Fatal("SwitchContext with contextType=\"vehicle\" must be rejected")
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM property_active_context WHERE user_id=$1`, user).Scan(&count); err != nil {
		t.Fatalf("query property_active_context: %v", err)
	}
	if count != 0 {
		t.Fatalf("invalid contextType must not write property_active_context, found %d row(s)", count)
	}
}
