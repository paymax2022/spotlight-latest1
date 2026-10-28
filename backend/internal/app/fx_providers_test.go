package app

import (
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/orchestration"
)

func hasProvider(ps []orchestration.Provider, name string) bool {
	for _, p := range ps {
		if p.Name() == name {
			return true
		}
	}
	return false
}

func TestFinanceWiring_VertoFXRegisteredWhenFlagOn(t *testing.T) {
	on := &config.Config{FeatureVertoFXEnabled: true, VertoFXClientID: "id", VertoFXAPIKey: "key", VertoFXBaseURL: "http://127.0.0.1:1"}
	ps, _ := buildFXProviders(on)
	if !hasProvider(ps, "vertofx") {
		t.Fatalf("flag on: vertofx missing from providers")
	}
	if !hasProvider(ps, "eversend") {
		t.Fatalf("existing providers must remain")
	}

	off := &config.Config{}
	ps, _ = buildFXProviders(off)
	if hasProvider(ps, "vertofx") {
		t.Fatalf("flag off: vertofx must not be registered")
	}
	if len(ps) != 1 {
		t.Fatalf("flag off: want 1 provider, got %d", len(ps))
	}
}

func TestBuildFXProviders_ProdRequiresEversendCredentials(t *testing.T) {
	if _, err := buildFXProviders(&config.Config{AppEnv: "production"}); err != ErrEversendCredentialsMissing {
		t.Fatalf("prod without credentials must fail, got %v", err)
	}
	if _, err := buildFXProviders(&config.Config{AppEnv: "production", EversendClientID: "i", EversendClientSecret: "s"}); err != nil {
		t.Fatalf("prod with credentials: %v", err)
	}
}
