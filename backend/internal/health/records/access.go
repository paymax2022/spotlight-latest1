package healthrecords

// AccessBasis is the reason a PHI record read was permitted (or denied). It is
// recorded on every access-log row so the immutable read trail is attributable
// (HL-8/HL-12; SC-005).
type AccessBasis string

const (
	BasisAdmin   AccessBasis = "ADMIN"
	BasisOwner   AccessBasis = "OWNER"
	BasisConsent AccessBasis = "CONSENT"
	BasisDenied  AccessBasis = "DENIED"
)

// authorizeRead is the pure object-level authorization decision for a PHI record
// read (SC-002/003, HR-002, EC-008). Precedence, fail-closed:
//
//   - an empty accessor is never authorized (no ambient/unauthenticated access);
//   - an admin reads via the ADMIN basis (role-scoped; the admin path is itself
//     audited and PII-masked upstream);
//   - the data subject (owner) reads their own record;
//   - a non-owner reads ONLY with an active consent grant (hasConsent);
//   - everything else is denied.
//
// It never depends on ambient state — the caller resolves hasConsent from the
// consent service first, so the decision is deterministic and unit-testable.
func authorizeRead(accessorID, owner string, isAdmin, hasConsent bool) (AccessBasis, bool) {
	if accessorID == "" {
		return BasisDenied, false
	}
	switch {
	case isAdmin:
		return BasisAdmin, true
	case accessorID == owner:
		return BasisOwner, true
	case hasConsent:
		return BasisConsent, true
	default:
		return BasisDenied, false
	}
}
