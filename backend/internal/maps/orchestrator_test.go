package maps

import (
	"context"
	"errors"
	"testing"
)

// orchestrator_test.go — MS-2/MS-3/MS-6/MS-7 invariant tests for the v2 chain.

// --- fakes ---

type fakeGeocoder struct {
	name      string
	conf      float64
	src       Source
	cacheable bool
	calls     *int
}

func (f *fakeGeocoder) Name() string { return f.name }
func (f *fakeGeocoder) Geocode(_ context.Context, address string) (GeoResult, error) {
	*f.calls++
	return GeoResult{Lat: 6.50, Lng: 3.35, Address: address, Provider: f.name, Source: f.src, Confidence: f.conf, Cacheable: f.cacheable}, nil
}
func (f *fakeGeocoder) ReverseGeocode(_ context.Context, lat, lng float64) (GeoResult, error) {
	*f.calls++
	return GeoResult{Lat: lat, Lng: lng, Provider: f.name, Source: f.src, Confidence: f.conf, Cacheable: f.cacheable}, nil
}

type fakeCacheV2 struct {
	store map[string]GeoResult
	puts  int
}

func (c *fakeCacheV2) Get(_ context.Context, k string) (GeoResult, bool) {
	r, ok := c.store[k]
	return r, ok
}
func (c *fakeCacheV2) Put(_ context.Context, k string, r GeoResult) error {
	c.puts++
	c.store[k] = r
	return nil
}

type fakeGaz struct {
	hit     GeoResult
	ok      bool
	upserts int
}

func (f *fakeGaz) Lookup(context.Context, string, string) (GeoResult, bool, error) {
	return f.hit, f.ok, nil
}
func (f *fakeGaz) ReverseLookup(context.Context, string, float64, float64) (GeoResult, bool, error) {
	return f.hit, f.ok, nil
}
func (f *fakeGaz) Upsert(context.Context, GazetteerEntry) error { f.upserts++; return nil }

type fakeCov struct {
	tier     CoverageTier
	observes int
}

func (f *fakeCov) Tier(context.Context, string) CoverageTier { return f.tier }
func (f *fakeCov) Observe(context.Context, string, string, bool, Confidence) error {
	f.observes++
	return nil
}

type fakePred struct {
	hit GeoResult
	ok  bool
}

func (f *fakePred) Predict(context.Context, string, string, *Point) (GeoResult, bool, error) {
	return f.hit, f.ok, nil
}

type fakeRec struct{ events []ResolutionEvent }

func (f *fakeRec) Record(_ context.Context, e ResolutionEvent) error {
	f.events = append(f.events, e)
	return nil
}
func (f *fakeRec) last() ResolutionEvent { return f.events[len(f.events)-1] }

type fakeGuard struct {
	allow map[string]bool
	def   bool
}

func (f *fakeGuard) Allow(_ context.Context, provider string, _ Primitive) bool {
	if v, ok := f.allow[provider]; ok {
		return v
	}
	return f.def
}
func (f *fakeGuard) Observe(context.Context, string, bool, int64) {}

// buildV2 constructs a v2 Service with the given geocoders + collaborators.
func buildV2(t *testing.T, tier CoverageTier, gaz *fakeGaz, pred *fakePred, guard *fakeGuard, rec *fakeRec, cache *fakeCacheV2, gcs ...*fakeGeocoder) *Service {
	t.Helper()
	reg := NewRegistry()
	for _, g := range gcs {
		reg.AddGeocoder(g)
	}
	cfg := DefaultV2Config()
	cov := &fakeCov{tier: tier}
	return NewService(Deps{
		Config: DefaultSurfaceConfig(), Registry: reg, Cache: cache,
		V2Enabled: true, V2Config: &cfg,
		Gazetteer: gaz, Coverage: cov, Predictor: pred, Recorder: rec, Guard: guard,
	})
}

func ctxUser() context.Context { return context.WithValue(context.Background(), CtxUserID, "user-1") }

// MS-2: gazetteer is checked before any paid provider (zero external cost).
func TestMS2_GazetteerDeflectsProvider(t *testing.T) {
	calls := 0
	gc := &fakeGeocoder{name: "geoapify", conf: 0.9, src: SourceOpenStack, cacheable: true, calls: &calls}
	gaz := &fakeGaz{hit: GeoResult{Lat: 6.6, Lng: 3.3, Address: "home", Confidence: 1.0}, ok: true}
	rec := &fakeRec{}
	svc := buildV2(t, TierGood, gaz, &fakePred{}, &fakeGuard{def: true}, rec, &fakeCacheV2{store: map[string]GeoResult{}}, gc)

	r, err := svc.Geocode(ctxUser(), "home", "default")
	if err != nil {
		t.Fatal(err)
	}
	if r.Source != SourceGazetteer {
		t.Errorf("source=%s want gazetteer", r.Source)
	}
	if calls != 0 {
		t.Errorf("MS-2 violated: provider called %d times despite gazetteer hit", calls)
	}
	if rec.last().ChosenSource != "gazetteer" || rec.last().CostUnit != 0 {
		t.Errorf("expected deflected gazetteer event cost 0, got %+v", rec.last())
	}
}

// MS-2: cache + prediction also deflect before any provider.
func TestMS2_CacheAndPredictionDeflect(t *testing.T) {
	// cache hit
	calls := 0
	gc := &fakeGeocoder{name: "geoapify", conf: 0.9, src: SourceOpenStack, calls: &calls}
	cache := &fakeCacheV2{store: map[string]GeoResult{NormalizeQuery("addr"): {Address: "addr", Source: SourceCache}}}
	rec := &fakeRec{}
	svc := buildV2(t, TierGood, &fakeGaz{}, &fakePred{}, &fakeGuard{def: true}, rec, cache, gc)
	if _, err := svc.Geocode(ctxUser(), "addr", "default"); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Errorf("MS-2: cache hit should not call provider, got %d", calls)
	}

	// prediction hit
	calls2 := 0
	gc2 := &fakeGeocoder{name: "geoapify", conf: 0.9, src: SourceOpenStack, calls: &calls2}
	pred := &fakePred{hit: GeoResult{Address: "predicted", Confidence: 0.95}, ok: true}
	svc2 := buildV2(t, TierGood, &fakeGaz{}, pred, &fakeGuard{def: true}, &fakeRec{}, &fakeCacheV2{store: map[string]GeoResult{}}, gc2)
	r, err := svc2.Geocode(ctxUser(), "somewhere new", "default")
	if err != nil {
		t.Fatal(err)
	}
	if r.Source != SourcePrediction || calls2 != 0 {
		t.Errorf("MS-2: prediction should deflect provider; source=%s calls=%d", r.Source, calls2)
	}
}

// MS-3: provider order is coverage-aware and escalation is confidence-driven.
func TestMS3_CoverageOrderAndConfidenceEscalation(t *testing.T) {
	gCalls, hCalls, geoCalls := 0, 0, 0
	google := &fakeGeocoder{name: "google", conf: 0.40, src: SourceGoogle, calls: &gCalls}
	here := &fakeGeocoder{name: "here", conf: 0.92, src: SourceHere, calls: &hCalls}
	geoapify := &fakeGeocoder{name: "geoapify", conf: 0.99, src: SourceOpenStack, cacheable: true, calls: &geoCalls}
	rec := &fakeRec{}
	// LOW coverage → order [google, here, geoapify] (accuracy first).
	svc := buildV2(t, TierLow, &fakeGaz{}, &fakePred{}, &fakeGuard{def: true}, rec, &fakeCacheV2{store: map[string]GeoResult{}}, google, here, geoapify)

	// Coverage-aware ordering only engages when the request carries a location hint
	// (the area cell is what the coverage tier is keyed on). Forward-geocode via the
	// resolution chain with a near point so the TierLow order is consulted.
	near := &Point{Lat: 6.45, Lng: 3.39}
	r, err := svc.forwardV2(ctxUser(), "informal area", "default", "geocode", near)
	if err != nil {
		t.Fatal(err)
	}
	if r.Source != SourceHere {
		t.Errorf("expected HERE to win (0.92≥τ), got %s", r.Source)
	}
	if gCalls != 1 || hCalls != 1 {
		t.Errorf("expected google then here called once each, got g=%d h=%d", gCalls, hCalls)
	}
	if geoCalls != 0 {
		t.Errorf("MS-3: should stop escalating after τ met; geoapify called %d", geoCalls)
	}
	if !rec.last().Escalated {
		t.Error("expected escalated=true (moved past first provider)")
	}
}

// MS-6: when all providers are blocked (budget/circuit) → NEEDS_PIN, never hard-fail.
func TestMS6_BudgetCircuitDegradesToNeedsPin(t *testing.T) {
	calls := 0
	gc := &fakeGeocoder{name: "geoapify", conf: 0.99, src: SourceOpenStack, calls: &calls}
	rec := &fakeRec{}
	svc := buildV2(t, TierGood, &fakeGaz{}, &fakePred{}, &fakeGuard{def: false}, rec, &fakeCacheV2{store: map[string]GeoResult{}}, gc)

	_, err := svc.Geocode(ctxUser(), "anywhere", "default")
	if !errors.Is(err, ErrNeedsPin) {
		t.Fatalf("expected ErrNeedsPin when all providers blocked, got %v", err)
	}
	if calls != 0 {
		t.Errorf("blocked provider should not be called, got %d", calls)
	}
	if !rec.last().OutcomePin {
		t.Error("expected NEEDS_PIN event recorded")
	}
}

// MS-6: confidence below the floor → NEEDS_PIN.
func TestMS6_LowConfidenceNeedsPin(t *testing.T) {
	calls := 0
	gc := &fakeGeocoder{name: "geoapify", conf: 0.30, src: SourceOpenStack, calls: &calls} // < pin_floor 0.45
	svc := buildV2(t, TierGood, &fakeGaz{}, &fakePred{}, &fakeGuard{def: true}, &fakeRec{}, &fakeCacheV2{store: map[string]GeoResult{}}, gc)
	if _, err := svc.Geocode(ctxUser(), "vague", "default"); !errors.Is(err, ErrNeedsPin) {
		t.Fatalf("expected NEEDS_PIN below floor, got %v", err)
	}
}

// MS-7: every external resolution is cached (OSM only) + emitted as a ResolutionEvent.
func TestMS7_CacheWriteThroughAndAudit(t *testing.T) {
	calls := 0
	geo := &fakeGeocoder{name: "geoapify", conf: 0.99, src: SourceOpenStack, cacheable: true, calls: &calls}
	cache := &fakeCacheV2{store: map[string]GeoResult{}}
	rec := &fakeRec{}
	svc := buildV2(t, TierGood, &fakeGaz{}, &fakePred{}, &fakeGuard{def: true}, rec, cache, geo)

	if _, err := svc.Geocode(ctxUser(), "Ikeja", "default"); err != nil {
		t.Fatal(err)
	}
	if cache.puts != 1 {
		t.Errorf("MS-7: OSM result should be cached write-through, puts=%d", cache.puts)
	}
	if len(rec.events) == 0 || rec.last().ChosenSource != string(SourceOpenStack) {
		t.Errorf("MS-7: expected ResolutionEvent for the provider call, got %+v", rec.events)
	}
}

// MS-7: a non-OSM (Google/HERE) win is NOT cached (license coherence).
func TestMS7_GoogleResultNotCached(t *testing.T) {
	calls := 0
	g := &fakeGeocoder{name: "google", conf: 0.95, src: SourceGoogle, cacheable: false, calls: &calls}
	cache := &fakeCacheV2{store: map[string]GeoResult{}}
	// LOW tier → google first.
	svc := buildV2(t, TierLow, &fakeGaz{}, &fakePred{}, &fakeGuard{def: true}, &fakeRec{}, cache, g)
	if _, err := svc.Geocode(ctxUser(), "informal", "default"); err != nil {
		t.Fatal(err)
	}
	if cache.puts != 0 {
		t.Errorf("license coherence: google result must not be cached, puts=%d", cache.puts)
	}
}
