package finance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCommissionMath_MatchesSQLFloorAndConserves(t *testing.T) {
	cases := map[int64]int64{0: 0, 1: 0, 6: 0, 7: 1, 99: 14, 100: 15, 12345: 1851, 500000: 75000, 800000: 120000}
	for fee, want := range cases {
		if got := commissionKobo(fee); got != want {
			t.Errorf("commissionKobo(%d) = %d, want %d", fee, got, want)
		}
	}
	for fee := int64(0); fee <= 200000; fee += 37 {
		if c, n := commissionKobo(fee), doctorNetKobo(fee); c+n != fee {
			t.Fatalf("fee %d: commission %d + net %d != fee (kobo created or lost)", fee, c, n)
		}
	}
	if commissionKobo(-5) != 0 || doctorNetKobo(-5) != 0 {
		t.Error("negative fees must yield zero, never a negative commission")
	}
	if PlatformCommissionBps+DoctorShareBps != 10000 {
		t.Error("commission + doctor share must total 10000 bps")
	}
}

func TestLast4_NeverReturnsFullAccountNumber(t *testing.T) {
	full := "0123456789"
	got := last4(&full)
	if got == nil || *got != "6789" {
		t.Fatalf("last4 = %v, want 6789", got)
	}
	short := "12"
	if g := last4(&short); g == nil || *g != "12" {
		t.Errorf("short value should pass through, got %v", g)
	}
	empty := ""
	if last4(&empty) != nil || last4(nil) != nil {
		t.Error("empty/nil account must yield nil")
	}
	b, _ := json.Marshal(BankAccountMasked{Last4: got})
	if strings.Contains(string(b), "012345") || strings.Contains(string(b), "tax") {
		t.Errorf("masked account JSON leaks data: %s", b)
	}
}

func TestParsePage(t *testing.T) {
	if p, err := parsePage("", ""); err != nil || p.Limit != defaultLimit || p.Offset != 0 {
		t.Errorf("defaults = %+v, %v", p, err)
	}
	if p, err := parsePage("200", "40"); err != nil || p.Limit != 200 || p.Offset != 40 {
		t.Errorf("valid = %+v, %v", p, err)
	}
	for _, bad := range [][2]string{{"0", ""}, {"201", ""}, {"abc", ""}, {"-1", ""}, {"", "-1"}, {"", "x"}} {
		if _, err := parsePage(bad[0], bad[1]); err == nil {
			t.Errorf("parsePage(%q,%q) should fail", bad[0], bad[1])
		}
	}
}

func TestParseWindow(t *testing.T) {
	w, err := parseWindow("2026-01-01", "2026-02-01T00:00:00Z")
	if err != nil || w.From == nil || w.To == nil || !w.To.After(*w.From) {
		t.Fatalf("window = %+v, %v", w, err)
	}
	if w, err := parseWindow("", ""); err != nil || w.From != nil || w.To != nil {
		t.Errorf("empty window should be unbounded: %+v %v", w, err)
	}
	for _, bad := range [][2]string{{"yesterday", ""}, {"", "2026-13-40"}, {"2026-02-01", "2026-01-01"}, {"2026-02-01", "2026-02-01"}} {
		if _, err := parseWindow(bad[0], bad[1]); err == nil {
			t.Errorf("parseWindow(%q,%q) should fail", bad[0], bad[1])
		}
	}
}

func TestParseFilters(t *testing.T) {
	if s, err := parsePayoutStatus("PAID"); err != nil || *s != "paid" {
		t.Errorf("status normalise: %v %v", s, err)
	}
	if _, err := parsePayoutStatus("paid'; DROP TABLE x;--"); err == nil {
		t.Error("injection-shaped status must be rejected")
	}
	if _, err := parsePayoutStatus("bogus"); err == nil {
		t.Error("unknown payout status must be rejected")
	}
	if _, err := parseFreeStatus("under review"); err == nil {
		t.Error("free status with a space must be rejected")
	}
	if s, err := parseFreeStatus("open"); err != nil || *s != "open" {
		t.Errorf("free status: %v %v", s, err)
	}
	if _, err := parseUUIDParam("not-a-uuid"); err == nil {
		t.Error("bad uuid must be rejected")
	}
	if u, err := parseUUIDParam("3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f"); err != nil || u == nil {
		t.Errorf("good uuid: %v %v", u, err)
	}
}

type fakeReader struct {
	gotStatus, gotDoctor *string
	gotWindow            window
	gotPage              page
	payoutErr            error
	called               []string
}

func (f *fakeReader) summary(_ context.Context, w window) (Summary, error) {
	f.called = append(f.called, "summary")
	f.gotWindow = w
	return Summary{Currency: "NGN", GrossConsultFeesKobo: 1000, PlatformCommissionKobo: 150, DoctorNetKobo: 850, PayoutsByStatus: []PayoutStatusTotal{}}, nil
}
func (f *fakeReader) payouts(_ context.Context, s, d *string, w window, p page) (list[Payout], error) {
	f.called = append(f.called, "payouts")
	f.gotStatus, f.gotDoctor, f.gotWindow, f.gotPage = s, d, w, p
	return list[Payout]{Items: []Payout{{ID: "p1", AmountKobo: 5000, Status: "pending", RequestedAt: time.Now()}}, Total: 1}, nil
}
func (f *fakeReader) payout(_ context.Context, id string) (PayoutDetail, error) {
	f.called = append(f.called, "payout")
	if f.payoutErr != nil {
		return PayoutDetail{}, f.payoutErr
	}
	return PayoutDetail{Payout: Payout{ID: id}}, nil
}
func (f *fakeReader) earnings(_ context.Context, d *string, w window, p page) (list[DoctorEarnings], error) {
	f.called = append(f.called, "earnings")
	f.gotDoctor, f.gotWindow, f.gotPage = d, w, p
	return list[DoctorEarnings]{Items: []DoctorEarnings{}}, nil
}
func (f *fakeReader) invoices(_ context.Context, d, s *string, w window, p page) (list[Invoice], error) {
	f.called = append(f.called, "invoices")
	return list[Invoice]{Items: []Invoice{}}, nil
}
func (f *fakeReader) disputes(_ context.Context, s, _ *string, p page) (list[Dispute], error) {
	f.called = append(f.called, "disputes")
	f.gotStatus, f.gotPage = s, p
	return list[Dispute]{Items: []Dispute{}}, nil
}
func (f *fakeReader) dispute(_ context.Context, id string) (DisputeDetail, error) {
	f.called = append(f.called, "dispute")
	return DisputeDetail{}, errNotFound
}
func (f *fakeReader) commissionConfig(_ context.Context) (CommissionConfigView, error) {
	f.called = append(f.called, "commission")
	return CommissionConfigView{PlatformCommissionBps: PlatformCommissionBps, DoctorShareBps: DoctorShareBps, Overrides: []CommissionOverride{}}, nil
}

func newRouter(f *fakeReader, view gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerRoutes(r.Group("/api/v1/telemedicine/admin"), f, view)
	return r
}

func allowAll(c *gin.Context) { c.Next() }

func do(r *gin.Engine, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequestWithContext(context.Background(), method, path, nil))
	return w
}

const base = "/api/v1/telemedicine/admin/finance"

func TestRoutes_AllGETAndAllGuardedByView(t *testing.T) {
	f := &fakeReader{}
	denied := func(c *gin.Context) { c.AbortWithStatus(http.StatusForbidden) }
	r := newRouter(f, denied)

	routes := r.Routes()
	if len(routes) != 8 {
		t.Fatalf("expected 8 routes, got %d: %v", len(routes), routes)
	}
	for _, rt := range routes {
		if rt.Method != http.MethodGet {
			t.Errorf("%s %s: finance oversight must be read-only (GET)", rt.Method, rt.Path)
		}
		path := strings.NewReplacer(":id", "3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f").Replace(rt.Path)
		if w := do(r, http.MethodGet, path); w.Code != http.StatusForbidden {
			t.Errorf("GET %s without permission = %d, want 403", rt.Path, w.Code)
		}
	}
	if len(f.called) != 0 {
		t.Errorf("store reached despite denied permission: %v", f.called)
	}
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if w := do(r, m, base+"/payouts"); w.Code != http.StatusNotFound {
			t.Errorf("%s /payouts = %d, want 404 (no mutation routes)", m, w.Code)
		}
	}
}

func TestRegister_NilDBMountsReadsAndDecisions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	Register(r.Group("/api/v1/telemedicine/admin"), nil, allowAll, allowAll)
	if len(r.Routes()) != 12 {
		t.Errorf("Register mounted %d routes, want 12 (8 reads + 4 decisions)", len(r.Routes()))
	}
}

func TestListPayouts_PassesValidatedFilters(t *testing.T) {
	f := &fakeReader{}
	r := newRouter(f, allowAll)
	uid := "3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f"
	w := do(r, http.MethodGet, base+"/payouts?status=Paid&doctor_user_id="+uid+"&from=2026-01-01&to=2026-02-01&limit=10&offset=20")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if f.gotStatus == nil || *f.gotStatus != "paid" || f.gotDoctor == nil || *f.gotDoctor != uid {
		t.Errorf("filters not forwarded: %v %v", f.gotStatus, f.gotDoctor)
	}
	if f.gotPage != (page{Limit: 10, Offset: 20}) || f.gotWindow.From == nil || f.gotWindow.To == nil {
		t.Errorf("page/window not forwarded: %+v %+v", f.gotPage, f.gotWindow)
	}
	var env struct {
		Data struct {
			Items []map[string]any `json:"items"`
			Total int              `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || env.Data.Total != 1 || len(env.Data.Items) != 1 {
		t.Fatalf("envelope: %v %s", err, w.Body)
	}
	if v, isFloat := env.Data.Items[0]["amount_kobo"].(float64); !isFloat || v != 5000 {
		t.Errorf("amount_kobo should be a JSON integer number, got %v", env.Data.Items[0]["amount_kobo"])
	}
}

func TestBadParams_Return400WithoutTouchingStore(t *testing.T) {
	f := &fakeReader{}
	r := newRouter(f, allowAll)
	for _, p := range []string{
		"/summary?from=nope",
		"/payouts?status=bogus",
		"/payouts?doctor_user_id=1",
		"/payouts?limit=0",
		"/payouts?limit=500",
		"/earnings?offset=-3",
		"/invoices?status=a%20b",
		"/disputes?status=x%27y",
		"/payouts/not-a-uuid",
		"/disputes/12",
	} {
		if w := do(r, http.MethodGet, base+p); w.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400", p, w.Code)
		}
	}
	if len(f.called) != 0 {
		t.Errorf("store reached with invalid input: %v", f.called)
	}
}

func TestNotFoundMapsTo404(t *testing.T) {
	f := &fakeReader{payoutErr: errNotFound}
	r := newRouter(f, allowAll)
	if w := do(r, http.MethodGet, base+"/payouts/3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f"); w.Code != http.StatusNotFound {
		t.Errorf("missing payout = %d, want 404", w.Code)
	}
	if w := do(r, http.MethodGet, base+"/disputes/3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f"); w.Code != http.StatusNotFound {
		t.Errorf("missing dispute = %d, want 404", w.Code)
	}
}

func TestSummaryAndCommissionEnvelope(t *testing.T) {
	f := &fakeReader{}
	r := newRouter(f, allowAll)
	for _, p := range []string{"/summary", "/commission-config", "/earnings", "/invoices", "/disputes"} {
		w := do(r, http.MethodGet, base+p)
		if w.Code != http.StatusOK {
			t.Errorf("GET %s = %d", p, w.Code)
			continue
		}
		var env map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || env["data"] == nil {
			t.Errorf("GET %s missing {data} envelope: %s", p, w.Body)
		}
	}
}

func TestEveryRouteNameIsDeclaredInContractOrder(t *testing.T) {
	want := []string{"/finance/summary", "/finance/payouts", "/finance/payouts/:id", "/finance/earnings",
		"/finance/invoices", "/finance/disputes", "/finance/disputes/:id", "/finance/commission-config"}
	r := newRouter(&fakeReader{}, allowAll)
	var got []string
	for _, rt := range r.Routes() {
		got = append(got, strings.TrimPrefix(rt.Path, "/api/v1/telemedicine/admin"))
	}
	if !reflect.DeepEqual(sorted(got), sorted(want)) {
		t.Errorf("routes = %v, want %v", got, want)
	}
}

func sorted(in []string) []string {
	out := append([]string(nil), in...)
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}
