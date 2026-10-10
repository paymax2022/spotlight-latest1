package healthlab

// LIVE-DB regression coverage for the lab_staff affiliation model
// (ADR-PR641) that replaces the interim owner-only HL-2 gate:
//
//   - A verified owner may grant a staff affiliation (scientist or
//     phlebotomist) on THEIR lab via UpsertStaff — nobody else may.
//   - An ACTIVE affiliation of the matching role authorizes that actor on
//     THIS lab's orders only: an affiliated scientist may accession, enter
//     results, and release (sign-off); an affiliated phlebotomist may collect
//     and move custody but never enters results or signs off.
//   - Foreign-lab, unaffiliated, suspended, and removed affiliations all
//     fail closed — with the same uniform not-found sentinel, before any
//     state check.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedSecondLab creates a second APPROVED lab owned by a different user so the
// foreign-lab affiliation cases can be exercised.
func seedSecondLab(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (otherOwnerID, otherLabID string) {
	t.Helper()
	otherOwnerID = uuid.New().String()
	otherLabID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, otherOwnerID, otherOwnerID+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab','Other Test Lab','APPROVED')`, otherLabID, otherOwnerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM lab_staff WHERE lab_provider_id=$1`, otherLabID)
		_, _ = pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, otherLabID)
	})
	return otherOwnerID, otherLabID
}

func cleanupLabStaff(t *testing.T, pool *pgxpool.Pool, labIDs ...string) {
	t.Helper()
	t.Cleanup(func() {
		bg := context.Background()
		for _, id := range labIDs {
			_, _ = pool.Exec(bg, `DELETE FROM lab_staff WHERE lab_provider_id=$1`, id)
		}
	})
}

func grantStaff(t *testing.T, ctx context.Context, pool *pgxpool.Pool, labID, userID, role, status string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_staff (lab_provider_id, user_id, role, status) VALUES ($1,$2,$3,$4)`,
		labID, userID, role, status); err != nil {
		t.Fatalf("grant staff: %v", err)
	}
}

// The gate matrix: owner always; ACTIVE same-lab affiliation of the right role;
// everything else denied — foreign lab, stranger, suspended, removed.
func TestLiveDB_LabStaff_GateMatrix(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	_, ownerID, sciID, phleboID, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	_, otherLabID := seedSecondLab(t, ctx, pool)
	cleanupLabStaff(t, pool, labID, otherLabID)

	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	type check struct {
		name string
		fn   func() (bool, error)
		want bool
	}
	mustCheck := func(c check) {
		t.Run(c.name, func(t *testing.T) {
			got, err := c.fn()
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			if got != c.want {
				t.Fatalf("%s = %v, want %v", c.name, got, c.want)
			}
		})
	}

	// Owner is staff AND scientist on their own lab — no affiliation needed.
	mustCheck(check{"owner is staff", func() (bool, error) { return svc.isLabStaff(ctx, ownerID, labID) }, true})
	mustCheck(check{"owner is scientist", func() (bool, error) { return svc.isLabScientist(ctx, ownerID, labID) }, true})

	// Unaffiliated actors fail closed.
	mustCheck(check{"unaffiliated scientist not staff", func() (bool, error) { return svc.isLabStaff(ctx, sciID, labID) }, false})
	mustCheck(check{"unaffiliated scientist not scientist", func() (bool, error) { return svc.isLabScientist(ctx, sciID, labID) }, false})
	mustCheck(check{"stranger not staff", func() (bool, error) { return svc.isLabStaff(ctx, foreignID, labID) }, false})

	// ACTIVE scientist affiliation on THIS lab.
	grantStaff(t, ctx, pool, labID, sciID, "scientist", "ACTIVE")
	mustCheck(check{"affiliated scientist is staff", func() (bool, error) { return svc.isLabStaff(ctx, sciID, labID) }, true})
	mustCheck(check{"affiliated scientist is scientist", func() (bool, error) { return svc.isLabScientist(ctx, sciID, labID) }, true})
	mustCheck(check{"affiliation does not leak to foreign lab", func() (bool, error) { return svc.isLabScientist(ctx, sciID, otherLabID) }, false})

	// A scientist affiliated to ANOTHER lab is still a stranger here.
	grantStaff(t, ctx, pool, otherLabID, foreignID, "scientist", "ACTIVE")
	mustCheck(check{"foreign-lab scientist denied here", func() (bool, error) { return svc.isLabScientist(ctx, foreignID, labID) }, false})
	mustCheck(check{"foreign-lab scientist ok there", func() (bool, error) { return svc.isLabScientist(ctx, foreignID, otherLabID) }, true})

	// Phlebotomist affiliation: custody staff, never bench/sign-off.
	grantStaff(t, ctx, pool, labID, phleboID, "phlebotomist", "ACTIVE")
	mustCheck(check{"affiliated phlebotomist is staff", func() (bool, error) { return svc.isLabStaff(ctx, phleboID, labID) }, true})
	mustCheck(check{"affiliated phlebotomist is NOT scientist", func() (bool, error) { return svc.isLabScientist(ctx, phleboID, labID) }, false})

	// SUSPENDED and REMOVED rows deny.
	if _, err := pool.Exec(ctx, `UPDATE lab_staff SET status='SUSPENDED' WHERE lab_provider_id=$1 AND user_id=$2`, labID, sciID); err != nil {
		t.Fatalf("suspend scientist: %v", err)
	}
	mustCheck(check{"suspended scientist denied", func() (bool, error) { return svc.isLabScientist(ctx, sciID, labID) }, false})
	mustCheck(check{"suspended scientist not staff", func() (bool, error) { return svc.isLabStaff(ctx, sciID, labID) }, false})
	if _, err := pool.Exec(ctx, `UPDATE lab_staff SET status='REMOVED' WHERE lab_provider_id=$1 AND user_id=$2`, labID, sciID); err != nil {
		t.Fatalf("remove scientist: %v", err)
	}
	mustCheck(check{"removed scientist denied", func() (bool, error) { return svc.isLabScientist(ctx, sciID, labID) }, false})
}

// UpsertStaff is the write path: only the lab's verified owner may grant,
// suspend, or revoke an affiliation — and never on a lab they do not own.
func TestLiveDB_LabStaff_UpsertOwnerScoped(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	_, ownerID, sciID, _, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	otherOwnerID, otherLabID := seedSecondLab(t, ctx, pool)
	cleanupLabStaff(t, pool, labID, otherLabID)

	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	// Owner grants a scientist affiliation — defaults to ACTIVE.
	if err := svc.UpsertStaff(ctx, ownerID, labID, sciID, "scientist", ""); err != nil {
		t.Fatalf("owner UpsertStaff: %v", err)
	}
	if ok, err := svc.isLabScientist(ctx, sciID, labID); err != nil || !ok {
		t.Fatalf("affiliated scientist must pass isLabScientist: ok=%v err=%v", ok, err)
	}

	// Suspension revokes in place — the row stays for the audit trail.
	if err := svc.UpsertStaff(ctx, ownerID, labID, sciID, "scientist", "SUSPENDED"); err != nil {
		t.Fatalf("owner suspend: %v", err)
	}
	if ok, err := svc.isLabScientist(ctx, sciID, labID); err != nil || ok {
		t.Fatalf("suspended scientist must fail: ok=%v err=%v", ok, err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM lab_staff WHERE lab_provider_id=$1 AND user_id=$2`, labID, sciID).Scan(&status); err != nil {
		t.Fatalf("read staff row: %v", err)
	}
	if status != "SUSPENDED" {
		t.Fatalf("staff status = %s, want SUSPENDED (row retained)", status)
	}

	// A non-owner — including the would-be staff member themselves and the
	// owner of a DIFFERENT lab — may not write this lab's roster.
	for name, actor := range map[string]string{
		"stranger":      foreignID,
		"staff-self":    sciID,
		"other-lab-own": otherOwnerID,
	} {
		if err := svc.UpsertStaff(ctx, actor, labID, foreignID, "phlebotomist", ""); err == nil {
			t.Fatalf("UpsertStaff by %s must be refused", name)
		}
	}
	// The owner may not grant on the OTHER lab either.
	if err := svc.UpsertStaff(ctx, ownerID, otherLabID, sciID, "scientist", ""); err == nil {
		t.Fatal("owner must not write a foreign lab's roster")
	}

	// Validation: unknown roles and statuses are refused.
	if err := svc.UpsertStaff(ctx, ownerID, labID, foreignID, "admin", ""); err == nil {
		t.Fatal("role 'admin' must be refused")
	}
	if err := svc.UpsertStaff(ctx, ownerID, labID, foreignID, "scientist", "TRIAL"); err == nil {
		t.Fatal("status 'TRIAL' must be refused")
	}
	if err := svc.UpsertStaff(ctx, "", labID, foreignID, "scientist", ""); err == nil {
		t.Fatal("unauthenticated UpsertStaff must be refused")
	}
}

// End-to-end: the affiliation is what authorizes real actions on THIS lab's
// orders — scientist releases (sign-off + money leg), phlebotomist collects —
// while every cross-role/cross-lab/inactive case is refused with the uniform
// sentinel before the state check.
func TestLiveDB_LabStaff_EndToEndActions(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	patientID, ownerID, sciID, phleboID, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	_, otherLabID := seedSecondLab(t, ctx, pool)
	cleanupLabStaff(t, pool, labID, otherLabID)

	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	// Affiliated scientist signs off a RESULT_READY order on their own lab —
	// the full release path incl. the escrow leg (no hold bound here).
	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "RESULT_READY", "WALK_IN")
	seedLabTestAndResult(t, ctx, pool, labID, orderID, sciID)
	if err := svc.UpsertStaff(ctx, ownerID, labID, sciID, "scientist", ""); err != nil {
		t.Fatalf("grant scientist: %v", err)
	}
	out, err := svc.Release(ctx, sciID, orderID)
	if err != nil {
		t.Fatalf("affiliated scientist Release must succeed: %v", err)
	}
	if out.State != StateClosed {
		t.Fatalf("state = %s, want CLOSED", out.State)
	}

	// Affiliated phlebotomist collects on their own lab's SCHEDULED order.
	if err := svc.UpsertStaff(ctx, ownerID, labID, phleboID, "phlebotomist", ""); err != nil {
		t.Fatalf("grant phlebotomist: %v", err)
	}
	collectOrder := seedLabOrder(t, ctx, pool, patientID, labID, "SCHEDULED", "WALK_IN")
	if _, err := svc.Collect(ctx, phleboID, collectOrder, "intake"); err != nil {
		t.Fatalf("affiliated phlebotomist Collect must succeed: %v", err)
	}

	// Every wrong case is refused identically — no state leak:
	//   phlebotomist attempting scientist sign-off;
	//   an unaffiliated stranger;
	//   a scientist affiliated to ANOTHER lab;
	//   a SUSPENDED affiliation.
	releaseOrder := seedLabOrder(t, ctx, pool, patientID, labID, "RESULT_READY", "WALK_IN")
	seedLabTestAndResult(t, ctx, pool, labID, releaseOrder, ownerID)
	grantStaff(t, ctx, pool, otherLabID, foreignID, "scientist", "ACTIVE")
	suspendedID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, suspendedID, suspendedID+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	grantStaff(t, ctx, pool, labID, suspendedID, "scientist", "SUSPENDED")

	for name, actor := range map[string]string{
		"phlebotomist-no-signoff": phleboID,
		"unaffiliated":            uuid.New().String(),
		"foreign-lab-scientist":   foreignID,
		"suspended-scientist":     suspendedID,
	} {
		if _, err := svc.Release(ctx, actor, releaseOrder); !errors.Is(err, ErrOrderNotFound) {
			t.Fatalf("Release by %s = %v, want ErrOrderNotFound (uniform denial)", name, err)
		}
	}
	if got := labOrderState(t, ctx, pool, releaseOrder); got != "RESULT_READY" {
		t.Fatalf("state = %s after refused releases, want RESULT_READY", got)
	}
}
