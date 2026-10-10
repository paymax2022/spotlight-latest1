package healthlab

// DB-free coverage for the lab collector/owner authorization helpers wired
// into Schedule (lab owner or admin) and Collect (verified lab staff, gated
// BEFORE the order-state check so a foreign actor cannot learn the state).
// INTERIM: there is no staff↔lab affiliation model, so "verified lab staff"
// resolves to the lab's owner only — a standalone scientist/phlebotomist
// capability is self-owned and proves nothing about which lab the holder
// works for. A fake ProviderGate answers per-role so the exercise never
// touches a database; the nil-gate owner fallback is covered by the live-DB
// tests.

import (
	"context"
	"testing"
)

type authzFakeProv struct {
	ownerID     string
	providerID  string
	scientistID string
	phleboID    string
}

func (g authzFakeProv) IsApprovedLab(ctx context.Context, providerID string) (bool, error) {
	return providerID == g.providerID, nil
}

func (g authzFakeProv) VerifiedLabOwner(ctx context.Context, userID, providerID string) (bool, error) {
	return userID == g.ownerID && providerID == g.providerID, nil
}

func (g authzFakeProv) IsVerifiedScientist(ctx context.Context, userID, providerID string) (bool, error) {
	return userID == g.scientistID && providerID == g.providerID, nil
}

func (g authzFakeProv) IsVerifiedPhlebotomist(ctx context.Context, userID, providerID string) (bool, error) {
	return userID == g.phleboID && providerID == g.providerID, nil
}

func authzTestSvc() *Service {
	return NewService(nil, nil, nil,
		authzFakeProv{ownerID: "owner-1", providerID: "lab-1", scientistID: "sci-1", phleboID: "phleb-1"},
		nil, nil, nil, nil)
}

// WALK_IN intake is lab-staff work: under the interim affiliation gate only
// the lab owner may collect — a scientist/phlebotomist capability names no
// employing lab and cannot be trusted as "staff of THIS lab".
func TestMayCollectSample_WalkIn(t *testing.T) {
	svc := authzTestSvc()
	ctx := context.Background()
	o := &Order{ID: "order-1", LabProviderID: "lab-1", CollectionMethod: CollectWalkIn}

	for _, tc := range []struct {
		name    string
		actorID string
		want    bool
	}{
		{"lab owner", "owner-1", true},
		{"standalone scientist capability is NOT staff here", "sci-1", false},
		{"standalone phlebotomist capability is NOT staff here", "phleb-1", false},
		{"the patient may NOT collect", "patient-1", false},
		{"foreign actor", "stranger-9", false},
		{"empty actor", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := svc.mayCollectSample(ctx, tc.actorID, o)
			if err != nil {
				t.Fatalf("mayCollectSample(%q): %v", tc.actorID, err)
			}
			if got != tc.want {
				t.Fatalf("mayCollectSample(%q) = %v, want %v", tc.actorID, got, tc.want)
			}
		})
	}
}

// A HOME collection is field work: the lab owner only, under the interim
// gate — a standalone phlebotomist credential does not collect at the
// doorstep of another lab's order.
func TestMayCollectSample_Home(t *testing.T) {
	svc := authzTestSvc()
	ctx := context.Background()
	o := &Order{ID: "order-2", LabProviderID: "lab-1", CollectionMethod: CollectHome}

	for _, tc := range []struct {
		name    string
		actorID string
		want    bool
	}{
		{"lab owner", "owner-1", true},
		{"standalone phlebotomist capability is NOT staff here", "phleb-1", false},
		{"standalone scientist capability is NOT staff here", "sci-1", false},
		{"foreign actor", "stranger-9", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := svc.mayCollectSample(ctx, tc.actorID, o)
			if err != nil {
				t.Fatalf("mayCollectSample(%q): %v", tc.actorID, err)
			}
			if got != tc.want {
				t.Fatalf("mayCollectSample(%q) = %v, want %v", tc.actorID, got, tc.want)
			}
		})
	}
}

// isLabOwner backs the Schedule gate: only the lab's verified owner (admins
// bypass upstream in Schedule itself).
func TestIsLabOwner(t *testing.T) {
	svc := authzTestSvc()
	ctx := context.Background()

	if ok, err := svc.isLabOwner(ctx, "owner-1", "lab-1"); err != nil || !ok {
		t.Fatalf("owner must pass isLabOwner: ok=%v err=%v", ok, err)
	}
	if ok, err := svc.isLabOwner(ctx, "stranger-9", "lab-1"); err != nil || ok {
		t.Fatalf("foreign actor must fail isLabOwner: ok=%v err=%v", ok, err)
	}
	if ok, err := svc.isLabOwner(ctx, "", "lab-1"); err != nil || ok {
		t.Fatalf("empty actor must fail isLabOwner: ok=%v err=%v", ok, err)
	}
}
