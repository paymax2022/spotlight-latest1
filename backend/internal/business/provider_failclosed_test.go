package business

// Fail-closed provider mapping (w9 prod probe): when the CAC provider is the
// disabled adapter (credentials absent + sandbox disallowed, i.e. production),
// its cac.ErrUnavailable must surface as ErrProviderUnavailable → 503, NOT the
// generic ErrProvider → 502 and NEVER as fabricated sandbox data.

import (
	"errors"
	"net/http"
	"testing"

	"spotlight/backend/internal/provider/cac"
)

func TestWrapProviderMapsUnavailableTo503(t *testing.T) {
	err := wrapProvider(cac.ErrUnavailable)
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("wrapProvider(cac.ErrUnavailable)=%v, want ErrProviderUnavailable", err)
	}
	if errors.Is(err, ErrProvider) {
		t.Fatalf("ErrUnavailable must NOT map to generic ErrProvider: %v", err)
	}
	if code := errMap.Code(err); code != http.StatusServiceUnavailable {
		t.Fatalf("errMap code=%d, want 503", code)
	}
}

func TestWrapProviderKeepsGenericErrors502(t *testing.T) {
	err := wrapProvider(errors.New("cac: server error 500"))
	if !errors.Is(err, ErrProvider) {
		t.Fatalf("generic provider err must map to ErrProvider: %v", err)
	}
	if errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("generic provider err must NOT map to ErrProviderUnavailable: %v", err)
	}
	if code := errMap.Code(err); code != http.StatusBadGateway {
		t.Fatalf("errMap code=%d, want 502", code)
	}
}
