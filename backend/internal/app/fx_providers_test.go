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
	ps := buildFXProviders(on)
	if !hasProvider(ps, "vertofx") {
		t.Fatalf("flag on: vertofx missing from providers")
	}
	if !hasProvider(ps, "eversend") || !hasProvider(ps, "maplerad") {
		t.Fatalf("existing providers must remain")
	}

	off := &config.Config{}
	ps = buildFXProviders(off)
	if hasProvider(ps, "vertofx") {
		t.Fatalf("flag off: vertofx must not be registered")
	}
	if len(ps) != 2 {
		t.Fatalf("flag off: want 2 providers, got %d", len(ps))
	}
}
