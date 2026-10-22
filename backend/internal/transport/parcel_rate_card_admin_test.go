package transport

// DB-free tests for the parcel rate-card admin editor: request validation and
// the handler's 400 paths. Every rejection here happens BEFORE the service
// touches the database (the AdminService below has no pool), so a bad edit can
// never reach transport_parcel_rate_card. The UPDATE + audit transaction is
// covered by parcel_rate_card_admin_live_db_test.go.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func i64(v int64) *int64 { return &v }
func boolp(v bool) *bool { return &v }

func TestValidateParcelRateCellPatch(t *testing.T) {
	ok := func() ParcelRateCellPatch {
		return ParcelRateCellPatch{MultiplierBps: i64(15000), Reason: "peak demand"}
	}
	cases := []struct {
		name        string
		size, speed string
		mut         func(*ParcelRateCellPatch)
		wantCode    string // "" = valid
	}{
		{"valid multiplier", "small", "standard", nil, ""},
		{"valid min fare only", "large", "same_day", func(p *ParcelRateCellPatch) { p.MultiplierBps = nil; p.MinFareKobo = i64(0) }, ""},
		{"valid active only", "medium", "scheduled", func(p *ParcelRateCellPatch) { p.MultiplierBps = nil; p.Active = boolp(false) }, ""},
		{"multiplier lower bound inclusive", "small", "express", func(p *ParcelRateCellPatch) { p.MultiplierBps = i64(1000) }, ""},
		{"multiplier upper bound inclusive", "small", "express", func(p *ParcelRateCellPatch) { p.MultiplierBps = i64(100000) }, ""},
		{"min fare upper bound inclusive", "small", "express", func(p *ParcelRateCellPatch) { p.MinFareKobo = i64(maxParcelMinFareKobo) }, ""},
		{"unknown size", "huge", "standard", nil, "INVALID_PARCEL_SIZE"},
		{"unknown speed", "small", "warp", nil, "INVALID_PARCEL_SPEED"},
		{"display name priority is not a stored speed", "small", "priority", nil, "INVALID_PARCEL_SPEED"},
		{"multiplier below 0.1x", "small", "standard", func(p *ParcelRateCellPatch) { p.MultiplierBps = i64(999) }, "INVALID_MULTIPLIER"},
		{"zero multiplier", "small", "standard", func(p *ParcelRateCellPatch) { p.MultiplierBps = i64(0) }, "INVALID_MULTIPLIER"},
		{"multiplier above 10x", "small", "standard", func(p *ParcelRateCellPatch) { p.MultiplierBps = i64(100001) }, "INVALID_MULTIPLIER"},
		{"negative min fare", "small", "standard", func(p *ParcelRateCellPatch) { p.MinFareKobo = i64(-1) }, "INVALID_MIN_FARE"},
		{"min fare above cap", "small", "standard", func(p *ParcelRateCellPatch) { p.MinFareKobo = i64(maxParcelMinFareKobo + 1) }, "INVALID_MIN_FARE"},
		{"nothing to change", "small", "standard", func(p *ParcelRateCellPatch) { p.MultiplierBps = nil }, "NO_CHANGES"},
		{"missing reason", "small", "standard", func(p *ParcelRateCellPatch) { p.Reason = "" }, "REASON_REQUIRED"},
		{"whitespace reason", "small", "standard", func(p *ParcelRateCellPatch) { p.Reason = "   " }, "REASON_REQUIRED"},
		{"reason too long", "small", "standard", func(p *ParcelRateCellPatch) { p.Reason = strings.Repeat("x", 501) }, "REASON_TOO_LONG"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := ok()
			if c.mut != nil {
				c.mut(&p)
			}
			err := validateParcelRateCellPatch(c.size, c.speed, &p)
			if c.wantCode == "" {
				if err != nil {
					t.Fatalf("want valid, got %v", err)
				}
				return
			}
			ce, isCoded := err.(*CodedError)
			if !isCoded {
				t.Fatalf("want CodedError %s, got %v", c.wantCode, err)
			}
			if ce.Code != c.wantCode || ce.Status != http.StatusBadRequest {
				t.Fatalf("got %d %s, want 400 %s", ce.Status, ce.Code, c.wantCode)
			}
		})
	}
}

func TestValidateParcelRateCellPatch_NormalizesZoneAndReason(t *testing.T) {
	p := ParcelRateCellPatch{Zone: "  ", Active: boolp(true), Reason: "  reopen  "}
	if err := validateParcelRateCellPatch("small", "standard", &p); err != nil {
		t.Fatal(err)
	}
	if p.Zone != "default" || p.Reason != "reopen" {
		t.Fatalf("zone=%q reason=%q, want default/reopen", p.Zone, p.Reason)
	}
}

// The handler must reject malformed bodies with 400 and never reach the DB.
// A float multiplier is the dangerous one: it must not be truncated to an int.
func TestPatchParcelRateCellHandler_Rejects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewAdminHandler(NewAdminService(&Service{})) // no pool: any DB call would panic
	r := gin.New()
	r.PATCH("/parcel-rate-card/:size/:speed", h.PatchParcelRateCell)

	cases := []struct{ name, path, body string }{
		{"float multiplier", "/parcel-rate-card/small/standard", `{"multiplier_bps":1.5,"reason":"x"}`},
		{"string min fare", "/parcel-rate-card/small/standard", `{"min_fare_kobo":"1000","reason":"x"}`},
		{"not json", "/parcel-rate-card/small/standard", `nope`},
		{"bad size", "/parcel-rate-card/xl/standard", `{"multiplier_bps":15000,"reason":"x"}`},
		{"out of bounds", "/parcel-rate-card/small/standard", `{"multiplier_bps":500,"reason":"x"}`},
		{"no reason", "/parcel-rate-card/small/standard", `{"multiplier_bps":15000}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPatch, c.path, strings.NewReader(c.body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want 400 (body %s)", w.Code, w.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body["error"] == nil {
				t.Fatalf("want an error body, got %s", w.Body.String())
			}
		})
	}
}
