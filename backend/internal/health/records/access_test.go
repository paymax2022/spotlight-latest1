package healthrecords

import "testing"

// TS-15 SC-002/003 (IDOR / object-level authZ), TS-12 HR-002 (consent- & role-scoped),
// TS-18 EC-008 (cross-owner access). Pure, deterministic assertions on the record
// read-authorization decision — no DB.

func TestAuthorizeReadOwner(t *testing.T) {
	basis, ok := authorizeRead("u1", "u1", false, false)
	if !ok || basis != BasisOwner {
		t.Fatalf("owner must read own record: basis=%s ok=%v", basis, ok)
	}
}

// SC-002 / EC-008: a non-owner with no consent is denied (IDOR / cross-owner).
func TestAuthorizeReadForeignDenied(t *testing.T) {
	basis, ok := authorizeRead("attacker", "victim", false, false)
	if ok || basis != BasisDenied {
		t.Fatalf("foreign accessor without consent must be denied: basis=%s ok=%v", basis, ok)
	}
}

// HR-002 / SC-006: a non-owner WITH an active consent grant may read (consent-scoped).
func TestAuthorizeReadConsent(t *testing.T) {
	basis, ok := authorizeRead("clinician", "patient", false, true)
	if !ok || basis != BasisConsent {
		t.Fatalf("active consent must permit read: basis=%s ok=%v", basis, ok)
	}
}

// SC-003: an admin reads via the admin basis (role-scoped, audited elsewhere).
func TestAuthorizeReadAdmin(t *testing.T) {
	basis, ok := authorizeRead("support", "patient", true, false)
	if !ok || basis != BasisAdmin {
		t.Fatalf("admin must read via ADMIN basis: basis=%s ok=%v", basis, ok)
	}
}

// Fail-closed: an empty/unauthenticated accessor is always denied, even if it
// happens to equal an empty owner.
func TestAuthorizeReadEmptyAccessorDenied(t *testing.T) {
	if _, ok := authorizeRead("", "", false, false); ok {
		t.Fatal("empty accessor must never be authorized (fail-closed)")
	}
	if _, ok := authorizeRead("", "victim", false, true); ok {
		t.Fatal("empty accessor must never be authorized even with a consent flag")
	}
}

// A denied decision is attributable: the basis is DENIED so the attempt is logged
// distinctly from a granted read (SC-005 — every access audited, incl. denied).
func TestDeniedBasisIsDistinct(t *testing.T) {
	basis, _ := authorizeRead("attacker", "victim", false, false)
	if basis != BasisDenied {
		t.Fatalf("denied attempts must carry the DENIED basis for the audit trail, got %s", basis)
	}
}
