package buskyb

import (
	"context"
	"strings"

	"spotlight/backend/internal/provider/cac"
)

// RegistryMatch is the provider-neutral answer to a company-registry lookup —
// the ONLY shape the service consumes, so the CAC wire model never leaks into
// domain logic (same port discipline as internal/provider/cac).
type RegistryMatch struct {
	Found  bool
	Name   string // registered legal name, when found
	Status string // active | inactive | delisted | ...
}

// CompanyRegistryVerifier is the port for looking up an EXISTING registered
// business by its CAC RC/BN number. Implementations must be safe for
// concurrent use, apply timeouts, never fabricate answers, and never panic.
// Any error is treated by the service as an INCONCLUSIVE result
// (provider_unavailable → retry), never as "not found".
type CompanyRegistryVerifier interface {
	VerifyCompany(ctx context.Context, rcOrBnNumber, legalName string) (RegistryMatch, error)
	Name() string
}

// CACRegistryAdapter adapts the existing internal/provider/cac
// BusinessRegistryProvider to the CompanyRegistryVerifier port — a thin wrap,
// not a reimplementation (the HTTP client, HMAC signing, envelope handling and
// fail-closed disabled provider all stay in the cac package).
type CACRegistryAdapter struct {
	inner cac.BusinessRegistryProvider
}

// NewCACRegistryAdapter wraps a cac.BusinessRegistryProvider (from cac.New).
func NewCACRegistryAdapter(p cac.BusinessRegistryProvider) *CACRegistryAdapter {
	return &CACRegistryAdapter{inner: p}
}

func (a *CACRegistryAdapter) Name() string { return "cac:" + a.inner.Name() }

func (a *CACRegistryAdapter) VerifyCompany(ctx context.Context, rcOrBnNumber, _ string) (RegistryMatch, error) {
	ev, err := a.inner.VerifyEntity(ctx, rcOrBnNumber)
	if err != nil {
		return RegistryMatch{}, err
	}
	return RegistryMatch{Found: ev.Found, Name: ev.Name, Status: ev.Status}, nil
}

// SandboxRegistryVerifier is a deterministic, provider-neutral stub for
// dev/tests. It performs NO I/O and NEVER claims a real registry answered.
// Canned outcomes are keyed on the RC number so every service mapping is
// reachable offline:
//
//	contains "NOTFOUND"  → not found               → company_not_found
//	contains "INACTIVE"  → found but inactive      → invalid_registration
//	contains "MISMATCH"  → found, different name   → mismatch
//	any other value      → found, active, name echo → match
//
// Wire it ONLY where the buskyb service is built for non-production flows —
// production should pass the CACRegistryAdapter (which itself fails closed via
// the cac package's disabledProvider when credentials are absent).
type SandboxRegistryVerifier struct{}

func (SandboxRegistryVerifier) Name() string { return "registry-sandbox" }

func (SandboxRegistryVerifier) VerifyCompany(_ context.Context, rcOrBnNumber, legalName string) (RegistryMatch, error) {
	rc := strings.ToUpper(strings.TrimSpace(rcOrBnNumber))
	switch {
	case strings.Contains(rc, "NOTFOUND"):
		return RegistryMatch{Found: false}, nil
	case strings.Contains(rc, "INACTIVE"):
		return RegistryMatch{Found: true, Name: legalName, Status: "inactive"}, nil
	case strings.Contains(rc, "MISMATCH"):
		return RegistryMatch{Found: true, Name: "SANDBOX OTHER COMPANY LTD", Status: "active"}, nil
	default:
		return RegistryMatch{Found: true, Name: legalName, Status: "active"}, nil
	}
}

// ─── Pure mapping helpers (unit-tested without any provider/DB) ──────────────

// classifyRegistryResult maps a registry answer onto a CAC result code. Order
// matters: a found-but-deregistered entity is invalid_registration even when
// the name happens to match; a name mismatch outranks a bare match because the
// applicant may have transposed digits on a real RC.
func classifyRegistryResult(m RegistryMatch, legalName string) CACResultCode {
	switch {
	case !m.Found:
		return CACCompanyNotFound
	case isInactiveRegistryStatus(m.Status):
		return CACInvalidRegistration
	case !namesMatch(m.Name, legalName):
		return CACMismatch
	default:
		return CACMatch
	}
}

// isInactiveRegistryStatus reports whether a registry entity status means the
// company no longer exists in good standing.
func isInactiveRegistryStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "inactive", "delisted", "deregistered", "struck_off", "struck-off", "dissolved":
		return true
	}
	return false
}

// namesMatch is a deliberately conservative legal-name comparison: case/
// punctuation/whitespace-insensitive equality, or one name containing the
// other. Anything unsure returns false — a mismatch only routes the
// application to human review, it never auto-approves, so erring strict is
// safe.
func namesMatch(registered, claimed string) bool {
	a, b := normalizeName(registered), normalizeName(claimed)
	if a == "" || b == "" {
		return false
	}
	return a == b || strings.Contains(a, b) || strings.Contains(b, a)
}

func normalizeName(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}
