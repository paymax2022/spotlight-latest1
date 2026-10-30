package healthpharmacy

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestValidateRecall(t *testing.T) {
	ok := CreateRecallInput{ProductName: " Amoxil ", BatchNo: "B-1", Severity: "high", Reason: "contamination"}
	if err := validateRecall(&ok); err != nil || ok.ProductName != "Amoxil" {
		t.Fatalf("valid input rejected: %v %+v", err, ok)
	}
	for name, in := range map[string]CreateRecallInput{
		"no product":   {BatchNo: "B", Severity: "low", Reason: "r"},
		"no batch":     {ProductName: "P", Severity: "low", Reason: "r"},
		"bad severity": {ProductName: "P", BatchNo: "B", Severity: "urgent", Reason: "r"},
		"long reason":  {ProductName: "P", BatchNo: "B", Severity: "low", Reason: strings.Repeat("r", 2001)},
	} {
		if err := validateRecall(&in); !errors.Is(err, ErrAdminInvalid) {
			t.Errorf("%s: want ErrAdminInvalid, got %v", name, err)
		}
	}
}

// Unsupported verbs / missing seam are rejected before any query (nil db).
func TestAdminActions_RejectBeforeQuery(t *testing.T) {
	s := &Service{}
	if _, err := s.DecidePcnApplication(t.Context(), nil, "a", "x", "suspend", ""); !errors.Is(err, ErrAdminInvalid) {
		t.Fatalf("suspend must be unsupported, got %v", err)
	}
	if _, err := s.DecidePcnApplication(t.Context(), nil, "a", "x", "approve", ""); !errors.Is(err, ErrDeciderUnavailable) {
		t.Fatalf("no decider must be ErrDeciderUnavailable, got %v", err)
	}
	if _, err := s.GovernCatalogItem(t.Context(), "a", "x", "delete", ""); !errors.Is(err, ErrAdminInvalid) {
		t.Fatalf("unknown govern action must be rejected, got %v", err)
	}

	r, h := uuidGuardRouter()
	r.POST("/pcn/applications/:id/decision", h.AdminDecidePcn)
	r.POST("/catalog/:id/govern", h.AdminGovernCatalog)
	r.GET("/recalls", h.AdminListRecalls)
	r.POST("/recalls", h.AdminCreateRecall)
	if w := postJSON(t, r, "/pcn/applications/nope/decision", `{"decision":"approve"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed id: %d", w.Code)
	}
	if w := postJSON(t, r, "/pcn/applications/"+uuidOK+"/decision", `{"decision":"approve"}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("no decider: %d", w.Code)
	}
	if w := postJSON(t, r, "/catalog/"+uuidOK+"/govern", `{"action":"delete"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad govern action: %d", w.Code)
	}
	if w := get(t, r, "/recalls?severity=urgent"); w.Code != http.StatusBadRequest {
		t.Fatalf("bad severity filter: %d", w.Code)
	}
	if w := postJSON(t, r, "/recalls", `{"product_id":"nope","product_name":"P","batch_no":"B","severity":"low","reason":"r"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad product id: %d", w.Code)
	}
	if w := postJSON(t, r, "/recalls", `{"product_name":"P","batch_no":"B","severity":"urgent","reason":"r"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad severity: %d", w.Code)
	}
}
