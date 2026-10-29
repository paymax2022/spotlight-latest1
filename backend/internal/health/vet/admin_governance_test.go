package healthvet

import (
	"errors"
	"net/http"
	"testing"
)

// Guards that must hold before any DB access (nil-dependency Service).
func TestGovernance_GuardsBeforeDB(t *testing.T) {
	s := &Service{}
	if err := s.AdminSetProviderStatus(t.Context(), uuidOK, uuidOK, "suspend", ""); !errors.Is(err, ErrGovernanceUnwired) {
		t.Fatalf("unwired capability: %v", err)
	}
	if _, err := s.AdminModerate(t.Context(), uuidOK, uuidOK, "delete_everything", ""); !errors.Is(err, ErrModerationBadAction) {
		t.Fatalf("bad action: %v", err)
	}
	if _, err := s.ReportVet(t.Context(), uuidOK, uuidOK, "credential_mismatch", "   ", ""); !errors.Is(err, ErrReportInvalid) {
		t.Fatalf("blank summary: %v", err)
	}

	r, h := uuidGuardRouter()
	r.POST("/moderation/:id/action", h.AdminModerate)
	r.POST("/providers/:id/suspend", h.AdminProviderStatus("suspend"))
	r.POST("/vets/:id/report", h.ReportVet)
	for _, p := range []string{"/moderation/x/action", "/providers/x/suspend", "/vets/x/report"} {
		if w := postJSON(t, r, p, `{"action":"resolve","kind":"other","summary":"s"}`); w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status %d, want 400", p, w.Code)
		}
	}
	if w := postJSON(t, r, "/providers/"+uuidOK+"/suspend", `{}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unwired suspend: status %d, want 503", w.Code)
	}
}
