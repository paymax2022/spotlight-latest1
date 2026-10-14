package cryptosvc

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type feeAdminRig struct {
	f   *memFees
	aud *auditSink
	e   *gin.Engine
}

func newFeeAdminRig(t *testing.T, withStore bool) *feeAdminRig {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rr := &feeAdminRig{f: newMemFees(), aud: &auditSink{}, e: gin.New()}
	d := HandlerDeps{Audit: rr.aud}
	if withStore {
		d.FeeAdmin = rr.f
	}
	h := &adminHandler{d: d, now: func() time.Time { return rr.f.now }}
	g := rr.e.Group("/api/v1/admin/crypto")
	g.Use(func(c *gin.Context) { c.Set("user_id", "admin-7"); c.Next() })
	g.GET("/fee-schedule", h.feeSchedule)
	g.PUT("/fee-schedule", h.updateFeeSchedule)
	return rr
}

func (rr *feeAdminRig) put(body any, key string) (int, map[string]any) {
	var b []byte
	switch v := body.(type) {
	case string:
		b = []byte(v)
	default:
		b, _ = json.Marshal(v)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/crypto/fee-schedule", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	rr.e.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func (rr *feeAdminRig) get() (int, map[string]any) {
	w := httptest.NewRecorder()
	rr.e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/fee-schedule", nil))
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func goodBody(expected int64) map[string]any {
	return map[string]any{"expected_version": expected, "major_bps": 80, "other_bps": 110,
		"majors": []string{"BTC", "ETH", "USDT", "USDC"}, "overrides": map[string]int{"DOGE": 140}, "reason": "Q4 review"}
}

func TestFeeScheduleGetShowsTheDefaultBeforeAnyEdit(t *testing.T) {
	rr := newFeeAdminRig(t, true)
	code, body := rr.get()
	if code != http.StatusOK {
		t.Fatalf("status %d: %v", code, body)
	}
	cur := body["current"].(map[string]any)
	if cur["version"].(float64) != 0 || cur["major_bps"].(float64) != 75 || cur["other_bps"].(float64) != 100 {
		t.Fatalf("default not reported: %v", cur)
	}
	if body["ceiling_bps"].(float64) != HardMaxBps {
		t.Fatalf("ceiling not reported: %v", body["ceiling_bps"])
	}
	if h, ok := body["history"].([]any); !ok || len(h) != 0 {
		t.Fatalf("history must be an empty array, got %v", body["history"])
	}
}

func TestFeeSchedulePutAppendsAVersionAndAuditsOldAndNew(t *testing.T) {
	rr := newFeeAdminRig(t, true)
	code, body := rr.put(goodBody(0), "idem-1")
	if code != http.StatusOK {
		t.Fatalf("status %d: %v", code, body)
	}
	cur := body["current"].(map[string]any)
	if cur["version"].(float64) != 1 || cur["major_bps"].(float64) != 80 || cur["created_by"] != "admin-7" || cur["reason"] != "Q4 review" {
		t.Fatalf("applied schedule wrong: %v", cur)
	}
	if len(rr.aud.ev) != 1 {
		t.Fatalf("exactly one audit event expected, got %d", len(rr.aud.ev))
	}
	ev := rr.aud.ev[0]
	if ev.Action != "crypto.fee_schedule.update" || ev.Actor != "admin-7" || ev.EntityType != "crypto_fee_schedule" || ev.EntityID != "1" || ev.Reason != "Q4 review" {
		t.Fatalf("audit event wrong: %+v", ev)
	}
	if ev.Old == nil || ev.Detail == nil {
		t.Fatalf("audit must carry old and new values: %+v", ev)
	}
	// And it is the live schedule now.
	_, again := rr.get()
	if again["current"].(map[string]any)["version"].(float64) != 1 {
		t.Fatalf("GET does not show the new version: %v", again)
	}
}

func TestFeeSchedulePutRefusesAStaleVersion(t *testing.T) {
	rr := newFeeAdminRig(t, true)
	rr.put(goodBody(0), "idem-1")
	code, body := rr.put(goodBody(0), "idem-2") // second admin still holds version 0
	if code != http.StatusConflict || body["error"] != "version_conflict" {
		t.Fatalf("a blind overwrite must be refused: %d %v", code, body)
	}
	if len(rr.aud.ev) != 1 {
		t.Fatalf("a refused write must not be audited as applied: %d events", len(rr.aud.ev))
	}
}

func TestFeeSchedulePutIsIdempotent(t *testing.T) {
	rr := newFeeAdminRig(t, true)
	rr.put(goodBody(0), "idem-1")
	code, body := rr.put(goodBody(0), "idem-1") // retry after a timeout
	if code != http.StatusOK || body["current"].(map[string]any)["version"].(float64) != 1 {
		t.Fatalf("a retry must replay the same result: %d %v", code, body)
	}
	if h, _ := rr.f.History(context.Background(), 10); len(h) != 1 {
		t.Fatalf("a retry must not append a second row, have %d", len(h))
	}
	if len(rr.aud.ev) != 1 {
		t.Fatalf("a replay must not emit a second audit event, got %d", len(rr.aud.ev))
	}
	other := goodBody(0)
	other["major_bps"] = 99
	code, body = rr.put(other, "idem-1")
	if code != http.StatusConflict || body["error"] != "idempotency_conflict" {
		t.Fatalf("same key, different body must conflict: %d %v", code, body)
	}
}

func TestFeeSchedulePutValidatesBeforeAnythingIsStored(t *testing.T) {
	for name, tc := range map[string]struct {
		body any
		key  string
		code int
		err  string
	}{
		"no idempotency key":       {goodBody(0), "", 400, ""},
		"bad idempotency key":      {goodBody(0), "has spaces!", 400, "invalid_idempotency_key"},
		"above the ceiling":        {func() any { b := goodBody(0); b["major_bps"] = HardMaxBps + 1; return b }(), "k", 400, "invalid_fee_schedule"},
		"blank reason":             {func() any { b := goodBody(0); b["reason"] = " "; return b }(), "k", 400, "invalid_fee_schedule"},
		"unknown field":            {func() any { b := goodBody(0); b["max_bps"] = 9999; return b }(), "k", 400, "invalid_body"},
		"missing expected_version": {map[string]any{"major_bps": 80, "other_bps": 110, "majors": []string{"BTC"}, "reason": "x"}, "k", 400, "invalid_body"},
		"not json":                 {"{not json", "k", 400, "invalid_body"},
		"oversized":                {strings.Repeat("x", maxJSONBytes+10), "k", 400, "invalid_body"},
	} {
		rr := newFeeAdminRig(t, true)
		code, body := rr.put(tc.body, tc.key)
		if code != tc.code {
			t.Errorf("%s: status %d, want %d (%v)", name, code, tc.code, body)
		}
		if tc.err != "" && body["error"] != tc.err {
			t.Errorf("%s: error %v, want %s", name, body["error"], tc.err)
		}
		if h, _ := rr.f.History(context.Background(), 10); len(h) != 0 {
			t.Errorf("%s: a rejected request stored a row", name)
		}
		if len(rr.aud.ev) != 0 {
			t.Errorf("%s: a rejected request emitted an audit event", name)
		}
	}
}

func TestFeeScheduleEndpointsAre503WithoutAStore(t *testing.T) {
	rr := newFeeAdminRig(t, false)
	if code, _ := rr.get(); code != http.StatusServiceUnavailable {
		t.Errorf("GET without a store -> %d", code)
	}
	if code, _ := rr.put(goodBody(0), "k"); code != http.StatusServiceUnavailable {
		t.Errorf("PUT without a store -> %d", code)
	}
}

func TestFeeScheduleHistoryIsNewestFirstWithWhoAndWhy(t *testing.T) {
	rr := newFeeAdminRig(t, true)
	rr.put(goodBody(0), "k1")
	b := goodBody(1)
	b["reason"] = "second change"
	rr.put(b, "k2")
	_, body := rr.get()
	h := body["history"].([]any)
	if len(h) != 2 || h[0].(map[string]any)["version"].(float64) != 2 || h[0].(map[string]any)["reason"] != "second change" || h[1].(map[string]any)["created_by"] != "admin-7" {
		t.Fatalf("history wrong: %v", h)
	}
}
