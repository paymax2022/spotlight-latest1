package pricingadmin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/crossborder/pricing"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// ---- fakes --------------------------------------------------------------

type fakeRBAC struct {
	services.RBACService
	allowed map[string]bool // userID -> has PermPricing
}

func (f fakeRBAC) CheckPermission(userID, perm, _, _ string) (bool, error) {
	return perm == PermPricing && f.allowed[userID], nil
}

type fakeStore struct {
	rules  []FeeRuleRecord
	card   []RateCardRow
	guard  *Guardrails
	coll   CollectionSettings
	refund RefundPolicy
	seq    int
}

func (s *fakeStore) id() string { s.seq++; return fmt.Sprintf("id-%d", s.seq) }

func (s *fakeStore) ListFeeRules(_ context.Context, st string) ([]FeeRuleRecord, error) {
	var out []FeeRuleRecord
	for _, r := range s.rules {
		if st == "" || r.Status == st {
			out = append(out, r)
		}
	}
	return out, nil
}
func (s *fakeStore) GetFeeRule(_ context.Context, id string) (FeeRuleRecord, error) {
	for _, r := range s.rules {
		if r.ID == id {
			return r, nil
		}
	}
	return FeeRuleRecord{}, ErrNotFound
}
func (s *fakeStore) CreateFeeRuleChange(_ context.Context, r FeeRuleRecord) (FeeRuleRecord, error) {
	if r.RuleKey == "" {
		r.RuleKey = s.id()
	}
	v := 1
	for _, x := range s.rules {
		if x.RuleKey == r.RuleKey && x.Version >= v {
			v = x.Version + 1
		}
	}
	r.ID, r.Version, r.Status = s.id(), v, StatusPending
	s.rules = append(s.rules, r)
	return r, nil
}
func (s *fakeStore) setStatus(id, checker, st string) (FeeRuleRecord, error) {
	for i, r := range s.rules {
		if r.ID != id {
			continue
		}
		if strings.EqualFold(r.Maker, checker) {
			return FeeRuleRecord{}, ErrSelfApproval
		}
		if r.Status != StatusPending {
			return FeeRuleRecord{}, ErrNotPending
		}
		s.rules[i].Status, s.rules[i].Checker = st, checker
		return s.rules[i], nil
	}
	return FeeRuleRecord{}, ErrNotFound
}
func (s *fakeStore) ApproveFeeRule(_ context.Context, id, c string, _ time.Time) (FeeRuleRecord, error) {
	return s.setStatus(id, c, StatusActive)
}
func (s *fakeStore) RejectFeeRule(_ context.Context, id, c string, _ time.Time) (FeeRuleRecord, error) {
	return s.setStatus(id, c, StatusRejected)
}
func (s *fakeStore) RollbackFeeRule(_ context.Context, key string, to int, maker, reason string, eff time.Time) (FeeRuleRecord, error) {
	for _, r := range s.rules {
		if r.RuleKey == key && r.Version == to {
			return s.CreateFeeRuleChange(context.Background(), FeeRuleRecord{
				RuleKey: key, Level: r.Level, Service: r.Service, Corridor: r.Corridor, PayerMode: r.PayerMode,
				FlatMinor: r.FlatMinor, PctBPS: r.PctBPS, EffectiveFrom: &eff, Maker: maker, Reason: reason, RolledBackFrom: r.ID,
			})
		}
	}
	return FeeRuleRecord{}, ErrVersionNotFound
}
func (s *fakeStore) ActiveFeeSchedule(ctx context.Context) (pricing.FeeSchedule, error) {
	act, _ := s.ListFeeRules(ctx, StatusActive)
	var fs pricing.FeeSchedule
	for _, r := range act {
		fs.Rules = append(fs.Rules, r.ToFeeRule())
	}
	return fs, nil
}
func (s *fakeStore) ListRateCard(context.Context) ([]RateCardRow, error) { return s.card, nil }
func (s *fakeStore) CreateRateCard(_ context.Context, r RateCardRow) (RateCardRow, error) {
	r.ID = s.id()
	s.card = append(s.card, r)
	return r, nil
}
func (s *fakeStore) UpdateRateCard(_ context.Context, r RateCardRow) (RateCardRow, error) {
	for i := range s.card {
		if s.card[i].ID == r.ID {
			s.card[i] = r
			return r, nil
		}
	}
	return r, ErrNotFound
}
func (s *fakeStore) ExpireRateCard(_ context.Context, id, _ string, at time.Time) (RateCardRow, error) {
	for i := range s.card {
		if s.card[i].ID == id {
			s.card[i].ValidTo = &at
			return s.card[i], nil
		}
	}
	return RateCardRow{}, ErrNotFound
}
func (s *fakeStore) GetGuardrails(context.Context) (Guardrails, bool, error) {
	if s.guard == nil {
		return Guardrails{}, false, nil
	}
	return *s.guard, true, nil
}
func (s *fakeStore) PutGuardrails(_ context.Context, g Guardrails, _ string) (Guardrails, error) {
	s.guard = &g
	return g, nil
}
func (s *fakeStore) GetCollection(context.Context) (CollectionSettings, error) { return s.coll, nil }
func (s *fakeStore) PutCollection(_ context.Context, c CollectionSettings, _ string) (CollectionSettings, error) {
	s.coll = c
	return c, nil
}
func (s *fakeStore) GetRefundPolicy(context.Context) (RefundPolicy, error) { return s.refund, nil }
func (s *fakeStore) PutRefundPolicy(_ context.Context, p RefundPolicy, _ string) (RefundPolicy, error) {
	s.refund = p
	return p, nil
}

type fixedSpread int

func (f fixedSpread) EffectiveBPS(_, _ string) int { return int(f) }

type fakeSpread struct{ bps int }

func (f fakeSpread) Source(context.Context) (pricing.SpreadSource, error) {
	return fixedSpread(f.bps), nil
}
func (f fakeSpread) Rules(context.Context) ([]SpreadRow, error) {
	return []SpreadRow{{Corridor: "USD-NGN", BPS: f.bps, Active: true}}, nil
}

type fakeVerto struct{ rows []SpreadRow }

func (f fakeVerto) MarkupConfig(context.Context) ([]SpreadRow, error) { return f.rows, nil }

// ---- harness ------------------------------------------------------------

var t0 = time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)

func newRouter(st *fakeStore, verto VertoMarkupReader, allowed ...string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	allow := map[string]bool{}
	for _, a := range allowed {
		allow[a] = true
	}
	r := gin.New()
	g := r.Group("/api/finance/admin/fx")
	g.Use(func(c *gin.Context) {
		if u := c.GetHeader("X-User"); u != "" {
			c.Set("user_id", u)
			c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: u})
		}
		c.Next()
	})
	h := NewHandler(st, fakeSpread{bps: 100}, verto).WithClock(func() time.Time { return t0 })
	h.Register(g, fakeRBAC{allowed: allow})
	return r
}

func do(r *gin.Engine, method, path, user string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/api/finance/admin/fx"+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-User", user)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func seededStore() *fakeStore {
	eff := t0.Add(-24 * time.Hour)
	st := &fakeStore{
		card:  []RateCardRow{{ID: "rc1", Service: "send", Corridor: "USD-NGN", Currency: "USD", FlatMinor: 50, PctBPS: 10}},
		guard: &Guardrails{FloorMarginMinor: 10, HardCapBPS: 5000, TaxBPS: 750},
		rules: []FeeRuleRecord{{
			ID: "r1", RuleKey: "k1", Version: 1, Level: int(pricing.LevelCorridorService), Service: "send", Corridor: "USD-NGN",
			AmountMin: 1000, FlatMinor: 100, PctBPS: 50, PayerMode: string(pricing.PayerFeeOnTop), EffectiveFrom: &eff,
			Status: StatusActive, Maker: "alice", Checker: "bob",
		}},
	}
	return st
}

// ---- tests --------------------------------------------------------------

func TestEveryEndpointRequiresPermission(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "admin") // "nobody" lacks the permission
	routes := []struct{ method, path string }{
		{"GET", "/rate-card"}, {"POST", "/rate-card"}, {"PUT", "/rate-card/rc1"}, {"POST", "/rate-card/rc1/expire"},
		{"GET", "/fee-schedule"}, {"POST", "/fee-schedule"}, {"GET", "/fee-schedule/r1"},
		{"POST", "/fee-schedule/r1/approve"}, {"POST", "/fee-schedule/r1/reject"}, {"POST", "/fee-schedule/k1/rollback"},
		{"GET", "/spread"}, {"GET", "/spread/sync"},
		{"GET", "/guardrails"}, {"PUT", "/guardrails"}, {"GET", "/collection-settings"}, {"PUT", "/collection-settings"},
		{"GET", "/refund-policy"}, {"PUT", "/refund-policy"}, {"POST", "/simulate"},
	}
	for _, rt := range routes {
		if w := do(r, rt.method, rt.path, "nobody", map[string]any{}); w.Code != http.StatusForbidden {
			t.Errorf("%s %s without permission = %d, want 403", rt.method, rt.path, w.Code)
		}
		if w := do(r, rt.method, rt.path, "", nil); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s unauthenticated = %d, want 401", rt.method, rt.path, w.Code)
		}
	}
	// With the permission the reads are 2xx.
	for _, p := range []string{"/rate-card", "/fee-schedule", "/fee-schedule/r1", "/spread", "/guardrails", "/collection-settings", "/refund-policy"} {
		if w := do(r, "GET", p, "admin", nil); w.Code != http.StatusOK {
			t.Errorf("GET %s with permission = %d body=%s", p, w.Code, w.Body.String())
		}
	}
}

func feeBody() map[string]any {
	return map[string]any{
		"level": int(pricing.LevelCorridorService), "service": "send", "corridor": "usd-ngn",
		"flat_minor": 200, "pct_bps": 60, "payer_mode": "FEE_ON_TOP",
		"effective_from": t0.Add(time.Hour).Format(time.RFC3339), "reason": "Q1 repricing",
	}
}

func TestMakerCannotSelfApprove(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "maker", "checker")

	w := do(r, "POST", "/fee-schedule", "maker", feeBody())
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", w.Code, w.Body.String())
	}
	var created struct{ Data FeeRuleRecord }
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	id := created.Data.ID
	if created.Data.Status != StatusPending || created.Data.Maker != "maker" || created.Data.Corridor != "USD-NGN" {
		t.Fatalf("unexpected created record %+v", created.Data)
	}

	// Same admin: rejected (403), and the change stays pending / inactive.
	if w := do(r, "POST", "/fee-schedule/"+id+"/approve", "maker", nil); w.Code != http.StatusForbidden {
		t.Fatalf("self-approve = %d, want 403 (%s)", w.Code, w.Body.String())
	}
	if w := do(r, "POST", "/fee-schedule/"+id+"/reject", "MAKER", nil); w.Code != http.StatusForbidden {
		t.Fatalf("self-reject (case-insensitive) = %d, want 403", w.Code)
	}
	if rec, _ := st.GetFeeRule(context.Background(), id); rec.Status != StatusPending {
		t.Fatalf("status after self-approve attempt = %s, want pending", rec.Status)
	}

	// A different admin approves.
	if w := do(r, "POST", "/fee-schedule/"+id+"/approve", "checker", nil); w.Code != http.StatusOK {
		t.Fatalf("checker approve = %d %s", w.Code, w.Body.String())
	}
	rec, _ := st.GetFeeRule(context.Background(), id)
	if rec.Status != StatusActive || rec.Checker != "checker" {
		t.Fatalf("after approve %+v", rec)
	}
	// Re-approving is a conflict, not a silent success.
	if w := do(r, "POST", "/fee-schedule/"+id+"/approve", "checker", nil); w.Code != http.StatusConflict {
		t.Fatalf("double approve = %d, want 409", w.Code)
	}
}

func TestCreateFeeChangeValidation(t *testing.T) {
	r := newRouter(seededStore(), nil, "maker")
	cases := map[string]func(m map[string]any){
		"no reason":         func(m map[string]any) { delete(m, "reason") },
		"no effective_from": func(m map[string]any) { delete(m, "effective_from") },
		"bad payer":         func(m map[string]any) { m["payer_mode"] = "NOPE" },
		"negative flat":     func(m map[string]any) { m["flat_minor"] = -1 },
		"float flat":        func(m map[string]any) { m["flat_minor"] = 1.5 },
		"max < min":         func(m map[string]any) { m["min_minor"] = 500; m["max_minor"] = 100 },
		"effective_to <= from": func(m map[string]any) {
			m["effective_to"] = t0.Format(time.RFC3339)
		},
	}
	for name, mut := range cases {
		b := feeBody()
		mut(b)
		if w := do(r, "POST", "/fee-schedule", "maker", b); w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400 (%s)", name, w.Code, w.Body.String())
		}
	}
}

func TestRollbackCreatesPendingNeedingDifferentChecker(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "alice", "carol")
	w := do(r, "POST", "/fee-schedule/k1/rollback", "carol", map[string]any{"to_version": 1, "reason": "bad change"})
	if w.Code != http.StatusCreated {
		t.Fatalf("rollback = %d %s", w.Code, w.Body.String())
	}
	var out struct{ Data FeeRuleRecord }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Data.Status != StatusPending || out.Data.Version != 2 || out.Data.Maker != "carol" {
		t.Fatalf("rollback record %+v", out.Data)
	}
	if w := do(r, "POST", "/fee-schedule/"+out.Data.ID+"/approve", "carol", nil); w.Code != http.StatusForbidden {
		t.Fatalf("rollback self-approve = %d, want 403", w.Code)
	}
	if w := do(r, "POST", "/fee-schedule/k1/rollback", "carol", map[string]any{"to_version": 9, "reason": "x"}); w.Code != http.StatusNotFound {
		t.Fatalf("rollback unknown version = %d, want 404", w.Code)
	}
}

func TestFeeRuleRoundTripsIntoPricing(t *testing.T) {
	eff := t0
	to := t0.Add(48 * time.Hour)
	in := pricing.FeeRule{
		ID: "x", Level: pricing.LevelPlanBand, Service: "send", Direction: "out", Corridor: "USD-NGN", Rail: "swift",
		Currency: "USD", Plan: "pro", Tier: "t2", AmountMin: 100, AmountMax: 9000,
		Fee:       pricing.FeeSpec{FlatMinor: 5, PctBPS: 70, MinMinor: 10, MaxMinor: 900},
		PayerMode: pricing.PayerSplit, ValidFrom: eff, ValidTo: to, Status: pricing.StatusActive, Maker: "a", Checker: "b",
	}
	rec := FromFeeRule(in)
	rec.Status = StatusActive
	if got := rec.ToFeeRule(); got != in {
		t.Fatalf("round trip mismatch:\n got %+v\nwant %+v", got, in)
	}
}

func TestSimulatorEqualsDirectResolve(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "admin")
	body := map[string]any{
		"service": "send", "corridor": "USD-NGN", "amount_minor": 100000, "currency": "USD", "fx_applies": true,
	}
	w := do(r, "POST", "/simulate", "admin", body)
	if w.Code != http.StatusOK {
		t.Fatalf("simulate = %d %s", w.Code, w.Body.String())
	}
	var got struct{ Data SimResult }
	_ = json.Unmarshal(w.Body.Bytes(), &got)

	// Direct call with independently-built (not handler-built) inputs.
	sched, _ := st.ActiveFeeSchedule(context.Background())
	rs, err := pricing.NewResolver(sched, fixedSpread(100),
		pricing.RateCard{Entries: []pricing.CostEntry{{Service: "send", Corridor: "USD-NGN", Currency: "USD", FlatMinor: 50, PctBPS: 10}}},
		pricing.Guardrails{FloorMarginMinor: 10, HardCapBPS: 5000}, 750)
	if err != nil {
		t.Fatal(err)
	}
	dec, err := rs.Resolve(context.Background(), pricing.PricingInput{
		Service: "send", Corridor: "USD-NGN", Amount: pricing.NewMoney(100000, "USD"), FXApplies: true, At: t0,
	})
	if err != nil {
		t.Fatal(err)
	}
	q := dec.Quote
	d := got.Data
	if d.RuleID != q.RuleID() || d.RevenueMinor != q.Revenue().AmountMinor || d.CostMinor != q.Cost().AmountMinor ||
		d.EstProfitMinor != q.EstProfit().AmountMinor || d.SenderPaysMinor != q.SenderPays().AmountMinor ||
		d.ReceiverGetsMinor != q.ReceiverGets().AmountMinor {
		t.Fatalf("simulator != Resolve:\n sim=%+v\n direct rule=%s rev=%d cost=%d profit=%d sender=%d recv=%d",
			d, q.RuleID(), q.Revenue().AmountMinor, q.Cost().AmountMinor, q.EstProfit().AmountMinor, q.SenderPays().AmountMinor, q.ReceiverGets().AmountMinor)
	}
	want := q.Lines()
	if len(d.Lines) != len(want) {
		t.Fatalf("lines %d != %d", len(d.Lines), len(want))
	}
	for i, l := range want {
		if d.Lines[i].Kind != string(l.Kind) || d.Lines[i].AmountMinor != l.Amount.AmountMinor || d.Lines[i].Payer != string(l.Payer) {
			t.Errorf("line %d mismatch: %+v vs %+v", i, d.Lines[i], l)
		}
	}
	if d.RevenueMinor == 0 || d.MarginBPS != marginBPS(d.EstProfitMinor, d.RevenueMinor) {
		t.Errorf("margin %d", d.MarginBPS)
	}
}

func TestSimulatorGuardrailViolationIs4xx(t *testing.T) {
	st := seededStore()
	st.guard = &Guardrails{FloorMarginMinor: 10, HardCapBPS: 5} // fee+spread far above a 5bps cap
	r := newRouter(st, nil, "admin")
	w := do(r, "POST", "/simulate", "admin", map[string]any{"service": "send", "corridor": "USD-NGN", "amount_minor": 100000, "currency": "USD", "fx_applies": true})
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "above_hard_cap") {
		t.Fatalf("hard cap = %d %s, want 422 above_hard_cap", w.Code, w.Body.String())
	}

	st.guard = &Guardrails{FloorMarginMinor: 10_000_000, HardCapBPS: 5000} // floor beyond any revenue
	w = do(r, "POST", "/simulate", "admin", map[string]any{"service": "send", "corridor": "USD-NGN", "amount_minor": 100000, "currency": "USD", "fx_applies": true})
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "below_cost_floor") {
		t.Fatalf("below floor = %d %s, want 422 below_cost_floor", w.Code, w.Body.String())
	}
}

func TestSimulatorFailsClosed(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "admin")
	req := map[string]any{"service": "send", "corridor": "USD-NGN", "amount_minor": 100000, "currency": "USD", "fx_applies": true}

	// Cost-unknown flag: pricing must fail closed (422), not guess.
	st.card[0].CostUnknown = true
	if w := do(r, "POST", "/simulate", "admin", req); w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "no_l0_cost") {
		t.Fatalf("cost unknown = %d %s", w.Code, w.Body.String())
	}
	st.card[0].CostUnknown = false

	// Guardrails never configured -> 409, not a 500 and not a default.
	st.guard = nil
	if w := do(r, "POST", "/simulate", "admin", req); w.Code != http.StatusConflict {
		t.Fatalf("no guardrails = %d, want 409", w.Code)
	}
	st.guard = &Guardrails{HardCapBPS: 5000}

	// Unknown corridor -> 422 no rule.
	req["corridor"] = "USD-ZZZ"
	if w := do(r, "POST", "/simulate", "admin", req); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("no rule = %d, want 422", w.Code)
	}
	// Invalid amount -> 400. Float amount rejected by the decoder -> 400.
	req["corridor"], req["amount_minor"] = "USD-NGN", 0
	if w := do(r, "POST", "/simulate", "admin", req); w.Code != http.StatusBadRequest {
		t.Fatalf("zero amount = %d, want 400", w.Code)
	}
	req["amount_minor"] = 10.5
	if w := do(r, "POST", "/simulate", "admin", req); w.Code != http.StatusBadRequest {
		t.Fatalf("float amount = %d, want 400", w.Code)
	}
}

func TestRateCardCRUD(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "admin")
	w := do(r, "POST", "/rate-card", "admin", map[string]any{"service": "send", "corridor": "usd-ghs", "currency": "usd", "flat_minor": 30, "pct_bps": 5, "source_ref": "verto-rc-2027-01"})
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", w.Code, w.Body.String())
	}
	var c struct{ Data RateCardRow }
	_ = json.Unmarshal(w.Body.Bytes(), &c)
	if c.Data.Corridor != "USD-GHS" || c.Data.Currency != "USD" || c.Data.CreatedBy != "admin" {
		t.Fatalf("row %+v", c.Data)
	}
	if w := do(r, "PUT", "/rate-card/"+c.Data.ID, "admin", map[string]any{"service": "send", "corridor": "USD-GHS", "currency": "USD", "cost_unknown": true}); w.Code != http.StatusOK {
		t.Fatalf("update = %d", w.Code)
	}
	if w := do(r, "POST", "/rate-card/"+c.Data.ID+"/expire", "admin", nil); w.Code != http.StatusOK {
		t.Fatalf("expire = %d", w.Code)
	}
	if w := do(r, "POST", "/rate-card", "admin", map[string]any{"service": "send", "flat_minor": -1}); w.Code != http.StatusBadRequest {
		t.Fatalf("negative cost = %d, want 400", w.Code)
	}
	if w := do(r, "POST", "/rate-card/nope/expire", "admin", nil); w.Code != http.StatusNotFound {
		t.Fatalf("expire unknown = %d, want 404", w.Code)
	}
}

func TestSettingsReadWriteValidation(t *testing.T) {
	st := seededStore()
	r := newRouter(st, nil, "admin")
	if w := do(r, "PUT", "/collection-settings", "admin", map[string]any{"strategy": "ngn_wallet", "sweep_interval_minutes": 60, "sweep_threshold_minor": 1000}); w.Code != http.StatusOK {
		t.Fatalf("collection put = %d %s", w.Code, w.Body.String())
	}
	if st.coll.Strategy != "ngn_wallet" {
		t.Fatalf("not persisted")
	}
	for _, b := range []map[string]any{
		{"strategy": "bogus", "sweep_interval_minutes": 60},
		{"strategy": "ledger_charge", "sweep_interval_minutes": 0},
		{"strategy": "ledger_charge", "sweep_interval_minutes": 5, "sweep_threshold_minor": -1},
	} {
		if w := do(r, "PUT", "/collection-settings", "admin", b); w.Code != http.StatusBadRequest {
			t.Errorf("bad collection %v = %d", b, w.Code)
		}
	}
	if w := do(r, "PUT", "/refund-policy", "admin", map[string]any{"on_failed": "refund", "on_cancelled": "retain", "on_customer_refund": "retain"}); w.Code != http.StatusOK {
		t.Fatalf("refund put = %d", w.Code)
	}
	if w := do(r, "PUT", "/refund-policy", "admin", map[string]any{"on_failed": "keep", "on_cancelled": "retain", "on_customer_refund": "retain"}); w.Code != http.StatusBadRequest {
		t.Fatalf("bad refund = %d", w.Code)
	}
	if w := do(r, "PUT", "/guardrails", "admin", map[string]any{"floor_margin_minor": 5}); w.Code != http.StatusBadRequest {
		t.Fatalf("guardrails without hard cap = %d, want 400", w.Code)
	}
	if w := do(r, "PUT", "/guardrails", "admin", map[string]any{"hard_cap_bps": 300, "tax_bps": 750}); w.Code != http.StatusOK {
		t.Fatalf("guardrails put = %d", w.Code)
	}
}

func TestSpreadSyncDiff(t *testing.T) {
	st := seededStore()
	// No Verto reader wired -> explicit "unavailable", never a fake in-sync.
	r := newRouter(st, nil, "admin")
	w := do(r, "GET", "/spread/sync", "admin", nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"unavailable"`) {
		t.Fatalf("unavailable = %d %s", w.Code, w.Body.String())
	}
	r = newRouter(st, fakeVerto{rows: []SpreadRow{{Corridor: "USD-NGN", BPS: 100, Active: true}}}, "admin")
	if w := do(r, "GET", "/spread/sync", "admin", nil); !strings.Contains(w.Body.String(), `"status":"in_sync"`) {
		t.Fatalf("in sync: %s", w.Body.String())
	}
	r = newRouter(st, fakeVerto{rows: []SpreadRow{{Corridor: "USD-NGN", BPS: 90}, {Corridor: "USD-GHS", BPS: 50}}}, "admin")
	w = do(r, "GET", "/spread/sync", "admin", nil)
	if !strings.Contains(w.Body.String(), `"status":"drift"`) || !strings.Contains(w.Body.String(), "mismatch") || !strings.Contains(w.Body.String(), "only_verto") {
		t.Fatalf("drift: %s", w.Body.String())
	}
}

func TestMarginBPSNoOverflow(t *testing.T) {
	if got := marginBPS(1<<62, 1<<62); got != 10000 {
		t.Fatalf("got %d", got)
	}
	if marginBPS(5, 0) != 0 {
		t.Fatal("zero revenue must be 0")
	}
}
