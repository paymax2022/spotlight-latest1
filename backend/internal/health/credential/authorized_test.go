package credential

import (
	"context"
	"testing"
	"time"
)

// TS-3 provider credentialing: CR-001 (active only after verification), CR-002
// (role-correct credential), CR-003 (expired licence → cannot practise), CR-004
// (scope-of-practice), EC-007 (licence expires mid-open-consult). Pure,
// deterministic assertions on the point-in-time authorization decision — no DB.

func at(h int) time.Time { return time.Date(2026, 7, 30, h, 0, 0, 0, time.UTC) }
func p(t time.Time) *time.Time { return &t }

// CR-001: only a VERIFIED record authorizes practice; any other status does not.
func TestAuthorizedOnlyWhenVerified(t *testing.T) {
	future := p(at(23))
	for _, st := range []Status{StatusPending, StatusNeedsInfo, StatusRejected} {
		if Authorized(st, "doctor", future, "doctor", at(12)) {
			t.Errorf("status %s must NOT authorize practice", st)
		}
	}
	if !Authorized(StatusVerified, "doctor", future, "doctor", at(12)) {
		t.Fatal("a VERIFIED, unexpired, matching-capability provider must be authorized")
	}
}

// CR-002 / CR-004: the record's capability must match the required one — a vet
// credential can't be used to act as a doctor (scope-of-practice / role-correct).
func TestAuthorizedCapabilityMustMatch(t *testing.T) {
	future := p(at(23))
	if Authorized(StatusVerified, "vet", future, "doctor", at(12)) {
		t.Fatal("a vet credential must not authorize a doctor-scoped action")
	}
	if !Authorized(StatusVerified, "Doctor", future, "doctor", at(12)) {
		t.Fatal("capability match must be case-insensitive")
	}
	// An empty required capability means "any verified provider" (capability not gated).
	if !Authorized(StatusVerified, "pharmacist", future, "", at(12)) {
		t.Fatal("empty required capability should not gate on capability")
	}
}

// CR-003 / EC-007: an expired licence is unauthorized AT THE POINT OF USE, even if
// the status is still VERIFIED (the periodic sweep hasn't run yet) — fail-safe.
func TestAuthorizedExpiredLicenceFailsSafe(t *testing.T) {
	if Authorized(StatusVerified, "doctor", p(at(11)), "doctor", at(12)) {
		t.Fatal("a licence that expired an hour ago must not authorize practice (between-sweep fail-safe)")
	}
	// Expiry exactly now → expired (half-open).
	if Authorized(StatusVerified, "doctor", p(at(12)), "doctor", at(12)) {
		t.Fatal("a licence expiring exactly now must be treated as expired")
	}
	// Future expiry → authorized.
	if !Authorized(StatusVerified, "doctor", p(at(13)), "doctor", at(12)) {
		t.Fatal("a future expiry must authorize practice")
	}
	// No expiry recorded → not gated on expiry.
	if !Authorized(StatusVerified, "doctor", nil, "doctor", at(12)) {
		t.Fatal("a record without an expiry must authorize on status+capability")
	}
}

// Service.IsAuthorized wires the pure rule over the store: it loads the latest
// verification record for an application and decides — the live authorization API.
func TestServiceIsAuthorized(t *testing.T) {
	fs := newFakeStore()
	svc := &Service{repo: fs}
	ctx := context.Background()
	_ = fs.CreateRecord(ctx, &VerificationRecord{
		ProviderApplicationID: "app1", Capability: "vet", Status: StatusVerified, LicenceExpiry: p(at(23)),
	})

	if ok, _ := svc.IsAuthorized(ctx, "app1", "vet", at(12)); !ok {
		t.Fatal("a VERIFIED, unexpired vet must be authorized for a vet-scoped action")
	}
	if ok, _ := svc.IsAuthorized(ctx, "app1", "doctor", at(12)); ok {
		t.Fatal("a vet credential must not authorize a doctor-scoped action")
	}
	// Unknown application → fail-closed, no error.
	if ok, err := svc.IsAuthorized(ctx, "nope", "vet", at(12)); ok || err != nil {
		t.Fatalf("unknown application must be unauthorized (fail-closed), got ok=%v err=%v", ok, err)
	}
	// Pending record → not authorized.
	_ = fs.CreateRecord(ctx, &VerificationRecord{ProviderApplicationID: "app2", Capability: "vet", Status: StatusPending})
	if ok, _ := svc.IsAuthorized(ctx, "app2", "vet", at(12)); ok {
		t.Fatal("a PENDING record must not authorize practice")
	}
}
