package propertyroles_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/property"
)

// ctxFixture seeds role profiles directly: an ACTIVE estate_manager, a DRAFT
// developer and a SUSPENDED agent for the caller, plus an ACTIVE profile that
// belongs to a different user. Returns the caller's active profile id and the
// other user's profile id.
func ctxFixture(t *testing.T) (*pgxpool.Pool, context.Context, string, string, string) {
	t.Helper()
	pool := propertyPool(t)
	ctx := context.Background()
	uid := anyUser(t, ctx, pool)
	clean := func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.property_role_profiles WHERE display_name = $1`, fixtureName)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.property_active_context WHERE user_id = $1`, uid)
	}
	clean()
	t.Cleanup(clean)

	ins := func(user, role, status string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO public.property_role_profiles (user_id, role, status, verification_status, display_name)
			VALUES ($1,$2,$3,'verified',$4) RETURNING id::text`, user, role, status, fixtureName).Scan(&id); err != nil {
			t.Fatalf("seed %s/%s: %v", role, status, err)
		}
		return id
	}
	mine := ins(uid, "estate_manager", "active")
	ins(uid, "developer", "draft")
	ins(uid, "agent", "suspended")
	other := ins(uuid.NewString(), "estate_manager", "active")
	return pool, ctx, uid, mine, other
}

func roleEntities(r *property.ContextResponse) []property.ContextEntity {
	var out []property.ContextEntity
	for _, e := range r.Contexts {
		if e.Type == "role" {
			out = append(out, e)
		}
	}
	return out
}

func TestContext_IncludesActiveRoleProfiles(t *testing.T) {
	pool, ctx, uid, mine, other := ctxFixture(t)
	got, err := property.NewService(pool).WithRoles(true).GetContext(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	roles := roleEntities(got)
	if len(roles) != 1 {
		t.Fatalf("want exactly 1 role entity (active only), got %+v", roles)
	}
	e := roles[0]
	if e.ID != mine || e.ID == other || e.Name != fixtureName || len(e.Roles) != 1 || e.Roles[0] != "estate_manager" {
		t.Fatalf("unexpected role entity: %+v", e)
	}
}

func TestContext_OmitsRolesWhenDisabled(t *testing.T) {
	pool, ctx, uid, _, _ := ctxFixture(t)
	got, err := property.NewService(pool).WithRoles(false).GetContext(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if r := roleEntities(got); len(r) != 0 {
		t.Fatalf("roles disabled must yield no role entities, got %+v", r)
	}
	// Default (never called WithRoles) is also disabled.
	got, err = property.NewService(pool).GetContext(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if r := roleEntities(got); len(r) != 0 {
		t.Fatalf("default service must yield no role entities, got %+v", r)
	}
}

func TestSwitchContext_RefusesRoleType(t *testing.T) {
	pool, ctx, uid, mine, other := ctxFixture(t)
	for _, enabled := range []bool{true, false} {
		s := property.NewService(pool).WithRoles(enabled)
		for _, id := range []string{mine, other} {
			if _, err := s.SwitchContext(ctx, uid, "role", id); err == nil {
				t.Fatalf("enabled=%v: switching to role %s must be refused", enabled, id)
			}
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.property_active_context WHERE user_id=$1`, uid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("active context must be unchanged, found %d rows", n)
	}
}
