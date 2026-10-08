package cac

// Provider-selection tests for the fail-closed fix (w9 prod probe): when CAC VAS
// credentials are absent, cac.New MUST NOT fall back to the deterministic
// sandbox in production — the sandbox fabricates terminal "verified" entities
// that satisfy the merchant-upgrade gate (HasVerifiedBusiness). Production gets
// disabledProvider, whose every method returns ErrUnavailable (→ 503).

import (
	"context"
	"errors"
	"testing"
)

func TestNewSelectsHTTPProviderWhenCredsSet(t *testing.T) {
	p := New(Config{BaseURL: "https://vas.cac.gov.ng/api", APIKey: "k"})
	if p.Name() != "cac-vas" {
		t.Fatalf("Name()=%q, want cac-vas", p.Name())
	}
	// AllowSandbox must not matter when real creds are present.
	p = New(Config{BaseURL: "https://vas.cac.gov.ng/api", APIKey: "k", AllowSandbox: true})
	if p.Name() != "cac-vas" {
		t.Fatalf("Name()=%q, want cac-vas (creds win over AllowSandbox)", p.Name())
	}
}

func TestNewSelectsSandboxInDev(t *testing.T) {
	p := New(Config{AllowSandbox: true})
	if p.Name() != "cac-sandbox" {
		t.Fatalf("Name()=%q, want cac-sandbox", p.Name())
	}
	// Sandbox still serves deterministic answers offline (Found may be false for
	// hash-bucketed numbers — either way it must answer, not error).
	a, err := p.VerifyEntity(context.Background(), "RC12345")
	if err != nil {
		t.Fatalf("sandbox VerifyEntity err: %v", err)
	}
	b, err := p.VerifyEntity(context.Background(), "RC12345")
	if err != nil || a != b {
		t.Fatalf("sandbox VerifyEntity must be deterministic: %+v vs %+v (err %v)", a, b, err)
	}
}

func TestNewFailClosedWhenCredsMissingAndSandboxDisallowed(t *testing.T) {
	// Production shape: APP_ENV=production → caller passes AllowSandbox=false.
	for name, cfg := range map[string]Config{
		"empty":          {},
		"base-url only":  {BaseURL: "https://vas.cac.gov.ng/api"},
		"api-key only":   {APIKey: "k"},
		"whitespace":     {BaseURL: "  ", APIKey: " "},
		"sandbox denied": {BaseURL: "", APIKey: "", AllowSandbox: false},
	} {
		p := New(cfg)
		if p.Name() != ProviderNameDisabled {
			t.Fatalf("%s: Name()=%q, want %q", name, p.Name(), ProviderNameDisabled)
		}
	}
}

func TestDisabledProviderEveryMethodFailsClosed(t *testing.T) {
	p := New(Config{}) // no creds, no sandbox → disabled
	ctx := context.Background()

	if _, err := p.CheckNameAvailability(ctx, "Acme", "retail"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("CheckNameAvailability err=%v, want ErrUnavailable", err)
	}
	if _, err := p.ReserveName(ctx, "Acme", Applicant{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("ReserveName err=%v, want ErrUnavailable", err)
	}
	if _, err := p.SubmitRegistration(ctx, RegistrationRequest{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("SubmitRegistration err=%v, want ErrUnavailable", err)
	}
	if _, err := p.GetRegistrationStatus(ctx, "SBX-REG-X"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("GetRegistrationStatus err=%v, want ErrUnavailable", err)
	}
	if _, err := p.VerifyEntity(ctx, "w9-probe-rc"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("VerifyEntity err=%v, want ErrUnavailable", err)
	}
}
