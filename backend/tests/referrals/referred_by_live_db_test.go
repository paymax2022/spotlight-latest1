package referrals_test

// Live-DB coverage for "who referred this user" and the sweep that connects every
// user to a referrer.
//
// Product rule: every user is connected to a referrer. A user who signed up with a
// referral code is attributed to that code's owner; a user who entered none is
// attributed to the house (Admin) account. Signup does this for users it sees; the
// sweep covers everyone else (history, and signup paths that never ran attribution).

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/referrals"
)

// profile gives the user a public.user_profiles row, which is the roster the sweep
// reads. (A trigger usually creates it; the test does not depend on that.)
func profile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id, fullName string, ageHours int) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.user_profiles (id, email, full_name, created_at)
		VALUES ($1, $2, $3, now() - make_interval(hours => $4))
		ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, created_at = EXCLUDED.created_at`,
		id, "zzref-"+id+"@seed.test", fullName, ageHours); err != nil {
		t.Fatalf("seed user_profiles: %v", err)
	}
	t.Cleanup(func() {
		// Background, not t.Context(): that context is already cancelled when
		// cleanups run, so the deletes would silently do nothing and leak rows.
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM public.referral_attributions WHERE referred_user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.user_profiles WHERE id=$1`, id)
	})
}

func houseAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	code := "ZZHOUSE-" + uuid.NewString()[:8]
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.referral_house_accounts (scope, code, non_withdrawable)
		VALUES ('global', $1, true) RETURNING id`, code).Scan(&id); err != nil {
		t.Fatalf("seed house account: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.referral_house_accounts WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_ReferredBy_ShowsTheReferrerAndTheirCode(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	referrer := newUser(t, ctx, pool)
	profile(t, ctx, pool, referrer, "Ada Referrer", 48)
	link, err := s.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatal(err)
	}
	referred := newUser(t, ctx, pool)
	profile(t, ctx, pool, referred, "Bola Referred", 24)
	attribute(t, ctx, pool, referrer, referred)

	got, err := s.ReferredBy(ctx, referred)
	if err != nil {
		t.Fatalf("ReferredBy: %v", err)
	}
	if !got.Attributed || got.IsHouse {
		t.Fatalf("want a real attribution, got attributed=%v house=%v", got.Attributed, got.IsHouse)
	}
	if got.ReferrerID != referrer || got.ReferrerName != "Ada Referrer" {
		t.Errorf("referrer = %q / %q, want %q / Ada Referrer", got.ReferrerID, got.ReferrerName, referrer)
	}
	if got.ReferrerCode != link.Code {
		t.Errorf("referrer code = %q, want %q", got.ReferrerCode, link.Code)
	}
	if got.CodeUsed != "TESTC" || got.AttributionType != "code" {
		t.Errorf("code_used/type = %q/%q, want TESTC/code", got.CodeUsed, got.AttributionType)
	}
}

func TestLiveDB_ReferredBy_HouseAttributionReadsAsAdmin(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	owner := newUser(t, ctx, pool)
	profile(t, ctx, pool, owner, "Super Admin", 500)
	house := houseAccount(t, ctx, pool)
	if _, err := pool.Exec(ctx, `UPDATE public.referral_house_accounts SET owner_user_id=$2 WHERE id=$1`, house, owner); err != nil {
		t.Fatal(err)
	}
	user := newUser(t, ctx, pool)
	profile(t, ctx, pool, user, "No Code User", 30)
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.referral_attributions (referred_user_id, house_account_id, attribution_type, is_house)
		VALUES ($1,$2,'global_house',true)`, user, house); err != nil {
		t.Fatal(err)
	}

	got, err := s.ReferredBy(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Attributed || !got.IsHouse {
		t.Fatalf("want a house attribution, got attributed=%v house=%v", got.Attributed, got.IsHouse)
	}
	if got.ReferrerID != "" {
		t.Errorf("a house attribution has no human referrer, got %q", got.ReferrerID)
	}
	if got.HouseAccountID != house || got.HouseOwnerName != "Super Admin" {
		t.Errorf("house = %q / %q, want %q / Super Admin", got.HouseAccountID, got.HouseOwnerName, house)
	}
}

func TestLiveDB_ReferredBy_UnattributedUserIsReportedNotInvented(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	user := newUser(t, ctx, pool)
	profile(t, ctx, pool, user, "Nobody", 1)

	got, err := svc(pool).ReferredBy(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.Attributed {
		t.Fatal("a user with no attribution row must read as not attributed")
	}
}

func TestLiveDB_AssignHouse_ConnectsEveryUnattributedUserAndLeavesTheRestAlone(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	house := houseAccount(t, ctx, pool)

	referrer := newUser(t, ctx, pool)
	profile(t, ctx, pool, referrer, "R", 900)

	old := newUser(t, ctx, pool) // unattributed, long past the grace window
	profile(t, ctx, pool, old, "Old", 24*40)
	recent := newUser(t, ctx, pool) // unattributed, inside the grace window, past minAge
	profile(t, ctx, pool, recent, "Recent", 1)
	fresh := newUser(t, ctx, pool) // signed up seconds ago: signup may still be attributing
	profile(t, ctx, pool, fresh, "Fresh", 0)
	coded := newUser(t, ctx, pool) // already has a real referrer
	profile(t, ctx, pool, coded, "Coded", 24*40)
	attribute(t, ctx, pool, referrer, coded)

	// Scoped to this test's users so a shared dev DB's real roster is untouched.
	opts := referrals.HouseSweepOpts{
		HouseAccountID: house,
		MinAge:         10 * time.Minute,
		GraceWindow:    72 * time.Hour,
		Limit:          1000,
		OnlyUserIDs:    []string{referrer, old, recent, fresh, coded},
	}
	n, err := s.AssignHouseToUnattributed(ctx, opts)
	if err != nil {
		t.Fatalf("AssignHouseToUnattributed: %v", err)
	}
	if n != 3 { // referrer (a profile with no attribution), old, recent
		t.Fatalf("assigned %d users, want 3 (referrer, old, recent)", n)
	}

	type row struct {
		house  *string
		isH    bool
		status string
		typ    string
	}
	get := func(id string) (row, bool) {
		var r row
		err := pool.QueryRow(ctx, `SELECT house_account_id::text, is_house, status, attribution_type
			FROM public.referral_attributions WHERE referred_user_id=$1`, id).Scan(&r.house, &r.isH, &r.status, &r.typ)
		return r, err == nil
	}

	if r, ok := get(old); !ok || r.house == nil || *r.house != house || !r.isH || r.status != "locked" || r.typ != "global_house" {
		t.Errorf("old user = %+v ok=%v, want house-attributed and locked", r, ok)
	}
	if r, ok := get(recent); !ok || r.house == nil || *r.house != house || r.status != "grace" {
		t.Errorf("recent user = %+v ok=%v, want house-attributed and still claimable (grace)", r, ok)
	}
	if _, ok := get(fresh); ok {
		t.Error("a user younger than minAge must be left for signup to attribute")
	}
	if r, ok := get(coded); !ok || r.isH || r.house != nil {
		t.Errorf("coded user = %+v ok=%v, an existing real referral must not be touched", r, ok)
	}

	// Running again changes nothing: idempotent.
	again, err := s.AssignHouseToUnattributed(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	if again != 0 {
		t.Errorf("second run assigned %d, want 0", again)
	}
}
