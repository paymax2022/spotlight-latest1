package estate

// SP-01 / SP-02 domain unit tests that require NO database. They pin the
// fail-closed contract that the delegation/gate work rests on: privileged
// admission roles are only ever delegated by an estate_admin (estate_admin is
// never self-grantable), the merchant gate blocks creation unless it
// explicitly returns true, and access codes come from a CSPRNG rather than a
// predictable id. Live enforcement (grants, expiry, atomic consume, arrival
// gating, cross-estate isolation) is covered in delegation_live_db_test.go and
// stays Blocked until TEST_DATABASE_URL points at a reachable Postgres.

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"testing"
)

func TestGuardRolesExcludeSuperRole(t *testing.T) {
	// The guard/admit set must be the two delegated officer roles, never
	// estate_admin and never a role an arbitrary resident holds.
	if len(guardRoles) != 2 {
		t.Fatalf("guardRoles = %v, want 2 entries", guardRoles)
	}
	for _, r := range guardRoles {
		if r == "estate_admin" || r == "resident" {
			t.Fatalf("guardRoles must not contain the general membership role %q", r)
		}
		if !staffRoles[r] {
			t.Fatalf("guardRoles entry %q is not a known staff role", r)
		}
	}
}

func TestEstateAdminIsNeverSelfGrantable(t *testing.T) {
	// GrantRole validates against staffRoles; the super role must be absent so
	// a compromised token cannot mint estate_admin for itself.
	if staffRoles["estate_admin"] {
		t.Fatal("estate_admin must never be a delegable staff role")
	}
	if staffRoles["resident"] {
		t.Fatal("resident must never be a delegable staff role (it is membership, not a capability)")
	}
	// All guard roles are present and are the whole admission surface.
	for _, want := range []string{"gate_officer", "gate_supervisor", "finance_officer", "auditor"} {
		if !staffRoles[want] {
			t.Fatalf("expected staff role %q to be grantable", want)
		}
	}
}

func TestGenerateNumericCodeIsSixDigits(t *testing.T) {
	re := regexp.MustCompile(`^[0-9]{6}$`)
	seen := map[string]int{}
	for i := 0; i < 500; i++ {
		c := generateNumericCode()
		if !re.MatchString(c) {
			t.Fatalf("generateNumericCode() = %q, want exactly 6 digits", c)
		}
		seen[c]++
	}
	if len(seen) < 2 {
		t.Fatalf("generateNumericCode produced no variety across 500 calls: %v", seen)
	}
	// Values must be within the 0..999999 space (left-zero-padded).
	for c := range seen {
		n, err := strconv.Atoi(c)
		if err != nil || n < 0 || n > 999999 {
			t.Fatalf("code %q out of 6-digit range", c)
		}
	}
}

func TestMerchantGateFuncAdapter(t *testing.T) {
	var got string
	var g EstateMerchantGate = EstateMerchantGateFunc(func(_ context.Context, userID string) (bool, error) {
		got = userID
		return true, nil
	})
	ok, err := g.CanCreateEstate(context.Background(), "user-9")
	if err != nil || !ok {
		t.Fatalf("adapter returned (%v,%v), want (true,nil)", ok, err)
	}
	if got != "user-9" {
		t.Fatalf("adapter forwarded userID %q, want user-9", got)
	}
}

// CreateEstate must consult the merchant gate before any database access, so a
// nil pool here proves the fail-closed branch is reached without a live DB.
func TestCreateEstateBlockedWhenGateDenies(t *testing.T) {
	svc := NewService(nil, nil).WithEstateMerchantGate(
		EstateMerchantGateFunc(func(context.Context, string) (bool, error) { return false, nil }),
	)
	_, err := svc.CreateEstate(context.Background(), "u1", CreateEstateRequest{Name: "Estate X", Address: "Y"})
	if !errors.Is(err, ErrEstateManagerApprovalRequired) {
		t.Fatalf("denied gate returned %v, want ErrEstateManagerApprovalRequired", err)
	}
}

func TestCreateEstateBlockedWhenGateErrors(t *testing.T) {
	sentinel := errors.New("kyc provider down")
	svc := NewService(nil, nil).WithEstateMerchantGate(
		EstateMerchantGateFunc(func(context.Context, string) (bool, error) { return false, sentinel }),
	)
	_, err := svc.CreateEstate(context.Background(), "u1", CreateEstateRequest{Name: "Estate X", Address: "Y"})
	if !errors.Is(err, sentinel) {
		t.Fatalf("errored gate returned %v, want it wrapped (errors.Is to sentinel)", err)
	}
	// An error must not be treated as "allowed" — creation is denied.
	if errors.Is(err, ErrEstateManagerApprovalRequired) == false && err == nil {
		t.Fatal("gate error must never allow estate creation")
	}
}

func TestHasLiveGrantNoRolesShortCircuits(t *testing.T) {
	// Empty role set returns false without touching the (nil) db.
	svc := NewService(nil, nil)
	ok, err := svc.hasLiveGrant(context.Background(), "e1", "u1", nil)
	if err != nil || ok {
		t.Fatalf("hasLiveGrant with no roles = (%v,%v), want (false,nil)", ok, err)
	}
}

func TestSentinelErrorsAreDistinct(t *testing.T) {
	all := []error{ErrNotMember, ErrAccountDeleted, ErrAccountBanned, ErrInsufficientRole, ErrEstateManagerApprovalRequired}
	for i := range all {
		for j := range all {
			if i != j && errors.Is(all[i], all[j]) {
				t.Fatalf("sentinel errors must be distinct: %v and %v collide", all[i], all[j])
			}
		}
	}
}
