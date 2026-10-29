package provider

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func init() { gin.SetMode(gin.TestMode) }

var expectedRoutes = []string{
	"GET /v/provider/profile",
	"PUT /v/provider/profile",
	"GET /v/provider/appointments",
	"POST /v/provider/appointments/:id/decision",
	"GET /v/provider/appointments/:id/nav",
	"POST /v/provider/appointments/:id/soap",
	"GET /v/provider/pets/:petId/chart",
	"POST /v/provider/prescriptions",
	"POST /v/provider/lab-orders",
	"POST /v/provider/referrals",
	"GET /v/provider/earnings",
	"POST /v/provider/payouts",
	"GET /v/provider/reviews",
}

func routesOf(e *gin.Engine) []string {
	var out []string
	for _, r := range e.Routes() {
		out = append(out, r.Method+" "+r.Path)
	}
	sort.Strings(out)
	return out
}

// Register must mount exactly the routes the app calls, and be a no-op without a
// pool (the orchestrator skips vet when the database is absent).
func TestRegisterMountsEveryRoute(t *testing.T) {
	// pgxpool connects lazily, so a pool for an unreachable host is enough here.
	pool, err := pgxpool.New(t.Context(), "postgres://u:p@127.0.0.1:1/none")
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	e := gin.New()
	Register(e.Group("/v"), pool)
	got := strings.Join(routesOf(e), "\n")
	for _, want := range expectedRoutes {
		if !strings.Contains(got, want) {
			t.Errorf("route not mounted: %s", want)
		}
	}
	if n := len(e.Routes()); n != len(expectedRoutes) {
		t.Errorf("mounted %d routes, want exactly %d", n, len(expectedRoutes))
	}

	empty := gin.New()
	Register(empty.Group("/v"), nil)
	if len(empty.Routes()) != 0 {
		t.Error("Register with a nil pool must mount nothing")
	}
}

// Every provider route is member-authenticated: without a user id the answer is 401
// before any database access (the handler under test has no pool at all).
func TestEveryRouteRequiresAuthentication(t *testing.T) {
	e := gin.New()
	(&Handler{}).mount(e.Group("/v"))
	const id = "11111111-1111-4111-8111-111111111111"
	for _, route := range e.Routes() {
		path := strings.NewReplacer(":id", id, ":petId", id).Replace(route.Path)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(route.Method, path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		e.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s = %d, want 401", route.Method, route.Path, w.Code)
		}
	}
}

func TestUUIDGuard(t *testing.T) {
	for _, ok := range []string{"11111111-1111-4111-8111-111111111111", "AAAAAAAA-aaaa-4AAA-8aaa-123456789abc"} {
		if !uuidish(ok) {
			t.Errorf("%q should be a uuid", ok)
		}
	}
	for _, bad := range []string{"", "nope", "11111111-1111-4111-8111-11111111111", "11111111-1111-4111-8111-11111111111g", "1' OR '1'='1"} {
		if uuidish(bad) {
			t.Errorf("%q must not pass the uuid guard", bad)
		}
	}
}

func TestValidateSoap(t *testing.T) {
	var b soapBody
	if validateSoap(&b) == "" {
		t.Error("an empty note must be refused")
	}
	b.Diagnosis = "Otitis externa"
	if m := validateSoap(&b); m != "" {
		t.Errorf("a diagnosis alone is a valid note, got %q", m)
	}
	b.Soap.Plan = strings.Repeat("x", maxNoteLen+1)
	if validateSoap(&b) == "" {
		t.Error("an oversized field must be refused")
	}
}

func TestValidateRx(t *testing.T) {
	ok := rxBody{Items: []rxItemBody{{DrugName: "Amoxicillin", Dosage: "250 mg", Frequency: "BID", DurationDays: 7, Quantity: 14}}}
	if m := validateRx(&ok); m != "" {
		t.Fatalf("valid prescription refused: %s", m)
	}
	cases := map[string]func(b *rxBody){
		"no items":      func(b *rxBody) { b.Items = nil },
		"too many":      func(b *rxBody) { b.Items = make([]rxItemBody, maxRxItems+1) },
		"blank name":    func(b *rxBody) { b.Items[0].DrugName = "  " },
		"no dosage":     func(b *rxBody) { b.Items[0].Dosage = "" },
		"zero quantity": func(b *rxBody) { b.Items[0].Quantity = 0 },
		"negative days": func(b *rxBody) { b.Items[0].DurationDays = -1 },
		"year+ course":  func(b *rxBody) { b.Items[0].DurationDays = 366 },
	}
	for name, mutate := range cases {
		b := rxBody{Items: []rxItemBody{ok.Items[0]}}
		mutate(&b)
		if validateRx(&b) == "" {
			t.Errorf("%s: should be refused", name)
		}
	}
}

func TestDoseMg(t *testing.T) {
	for in, want := range map[string]float64{"250 mg": 250, "12.5mg twice": 12.5, "1 tablet": 0, "": 0, "5 MG": 5} {
		if got := doseMg(in); got != want {
			t.Errorf("doseMg(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestShortName(t *testing.T) {
	for in, want := range map[string]string{
		"Chioma Eze": "Chioma E.", "Chioma": "Chioma", "": "Pet owner", "  ada  obi  ": "ada O.", "Ngozi 3rd": "Ngozi",
	} {
		if got := shortName(in, "Pet owner"); got != want {
			t.Errorf("shortName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSpeciesAndSex(t *testing.T) {
	if speciesToWire("DOG") != "dog" || speciesToWire("Reptile") != "reptile" || speciesToWire("HAMSTER") != "other" {
		t.Error("species folding is wrong")
	}
	if sexToWire("FEMALE") != "female" || sexToWire("") != "unknown" {
		t.Error("sex folding is wrong")
	}
}

func TestVaccinationStatus(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	past, soon, later := now.AddDate(0, 0, -3), now.AddDate(0, 0, 10), now.AddDate(0, 3, 0)
	cases := []struct {
		name         string
		given, sched *time.Time
		due          time.Time
		want         string
	}{
		{"administered", &past, nil, past, "up_to_date"},
		{"booked ahead", nil, &later, soon, "scheduled"},
		{"overdue", nil, nil, past, "overdue"},
		{"due soon", nil, nil, soon, "due_soon"},
		{"far off", nil, nil, later, "scheduled"},
	}
	for _, tc := range cases {
		if got := vaccinationStatus(tc.given, tc.sched, tc.due, now); got != tc.want {
			t.Errorf("%s = %s, want %s", tc.name, got, tc.want)
		}
	}
}

func TestRecordKind(t *testing.T) {
	for in, want := range map[string]string{
		"VACCINATION": "vaccination", "lab_result": "lab_result", "WEIGHT_LOG": "weight",
		"prescription": "prescription", "CONSULT_NOTE": "consult_note", "scan": "document",
	} {
		if got := recordKind(in); got != want {
			t.Errorf("recordKind(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestApplicationStatus(t *testing.T) {
	for in, want := range map[string]string{
		"DRAFT": "draft", "SUBMITTED": "submitted", "UNDER_REVIEW": "under_review", "APPROVED": "approved",
		"NEEDS_INFO": "needs_info", "REJECTED": "needs_info", "SUSPENDED": "needs_info",
	} {
		if got := applicationStatus(in); got != want {
			t.Errorf("applicationStatus(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestEtaAndDistance(t *testing.T) {
	// Lekki Phase 1 → Ikeja GRA is ~19 km straight-line.
	km := haversineKm(6.4474, 3.4707, 6.5833, 3.3500)
	if km < 17 || km > 21 {
		t.Errorf("haversine = %.1f km, want ≈19", km)
	}
	if etaLabel(0) != "1 min" || etaLabel(15) != "30 min" {
		t.Errorf("eta labels: %s / %s", etaLabel(0), etaLabel(15))
	}
}

func TestPetColorIsStable(t *testing.T) {
	if petColor("abc") != petColor("abc") {
		t.Error("the avatar colour must not change between loads")
	}
}

func TestAgeLabel(t *testing.T) {
	now := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	if ageLabel(nil, now) != "Unknown age" {
		t.Error("unknown age")
	}
	d := now.AddDate(-3, 0, 0)
	if ageLabel(&d, now) != "3 yrs" {
		t.Errorf("got %s", ageLabel(&d, now))
	}
	d = now.AddDate(0, -4, 0)
	if !strings.HasSuffix(ageLabel(&d, now), "mos") {
		t.Errorf("got %s", ageLabel(&d, now))
	}
}

// The app reads these keys verbatim (types.ts); a rename here breaks a screen
// silently, so the wire contract is pinned.
func TestWireShapesMatchTheApp(t *testing.T) {
	keys := func(v any) map[string]bool {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for k := range m {
			out[k] = true
		}
		return out
	}
	need := func(name string, got map[string]bool, want ...string) {
		for _, k := range want {
			if !got[k] {
				t.Errorf("%s is missing key %q", name, k)
			}
		}
	}
	need("ProviderProfile", keys(wireProfile{Types: []string{}, Species: []string{}}),
		"status", "displayName", "vcnLicenseNo", "clinicName", "bio", "consultFeeKobo", "homeVisitFeeKobo", "types", "species", "credential")
	need("ProviderAppointmentRow", keys(wireApptRow{}),
		"appointmentId", "ownerName", "petName", "species", "type", "status", "scheduledFor", "reason")
	need("PetChart", keys(wireChart{}), "pet", "ownerName", "vaccinations", "records", "weightSeries")
	need("Pet", keys(wirePet{}), "id", "name", "species", "breed", "sex", "ageLabel", "avatarColor")
	need("EPrescription", keys(wireRx{}),
		"id", "petId", "petName", "vetId", "vetName", "vetCredential", "status", "issuedAt", "expiresAt", "items", "sensitive")
	need("RxItem", keys(wireRxItem{}), "id", "drugName", "form", "dosage", "frequency", "durationDays", "quantity", "pom")
	need("ProviderEarnings", keys(wireEarnings{Payouts: []wirePayout{}}), "availableKobo", "pendingKobo", "heldKobo", "payouts")
	need("VetReview", keys(wireReview{}), "id", "author", "rating", "body", "at")
	need("ProviderHomeNav", keys(wireNav{}),
		"appointmentId", "ownerName", "petName", "address", "destLat", "destLng", "vetLat", "vetLng", "etaLabel", "distanceLabel", "phone")
	need("VaccinationEntry", keys(wireVaccination{}), "id", "petId", "vaccine", "status", "dueAt")
	need("PetRecordEntry", keys(wireRecord{}), "id", "petId", "kind", "title", "summary", "at")
}

// Money guard: the payout route never reports success, even for a valid vet. A bad
// refactor that returned 200 here would silently pretend a withdrawal happened.
func TestPayoutRouteNeverClaimsSuccess(t *testing.T) {
	h := &Handler{}
	e := gin.New()
	e.POST("/payouts", func(c *gin.Context) { c.Set("user_id", ""); h.RequestPayout(c) })
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/payouts", strings.NewReader(`{"amountKobo":100}`)))
	if w.Code == http.StatusOK || w.Code == http.StatusCreated || w.Code == http.StatusAccepted {
		t.Fatalf("payout answered %d — it must never claim a withdrawal", w.Code)
	}
}

func TestValidateClinic(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	s := func(v string) *string { return &v }
	long := strings.Repeat("x", 201)
	cases := []struct {
		name string
		body profileBody
		bad  bool
	}{
		{"empty body is fine", profileBody{}, false},
		{"address only is fine", profileBody{ClinicAddress: s("5 Awolowo Rd")}, false},
		{"valid point", profileBody{ClinicLat: f(6.45), ClinicLng: f(3.43)}, false},
		{"lat without lng", profileBody{ClinicLat: f(6.45)}, true},
		{"lng without lat", profileBody{ClinicLng: f(3.43)}, true},
		{"lat too high", profileBody{ClinicLat: f(91), ClinicLng: f(3)}, true},
		{"lng too low", profileBody{ClinicLat: f(6), ClinicLng: f(-181)}, true},
		{"null island", profileBody{ClinicLat: f(0), ClinicLng: f(0)}, true},
		{"zero lat alone is a real place", profileBody{ClinicLat: f(0), ClinicLng: f(3)}, false},
		{"address too long", profileBody{ClinicAddress: s(long)}, true},
		{"city too long", profileBody{ClinicCity: s(strings.Repeat("c", 101))}, true},
		{"padding does not count", profileBody{ClinicAddress: s("  " + strings.Repeat("a", 200) + "  ")}, false},
	}
	for _, c := range cases {
		if got := validateClinic(c.body) != ""; got != c.bad {
			t.Errorf("%s: rejected=%v, want %v", c.name, got, c.bad)
		}
	}
}

func TestClinicDraftPatchOnlyIncludesSentKeys(t *testing.T) {
	s := func(v string) *string { return &v }
	p := clinicDraftPatch(profileBody{ClinicAddress: s("  5 Awolowo Rd "), ClinicCity: s("Lagos")})
	if len(p) != 2 || p["address"] != "5 Awolowo Rd" || p["city"] != "Lagos" {
		t.Errorf("patch = %v", p)
	}
	if _, ok := p["state"]; ok {
		t.Error("state must not be written when it was not sent")
	}
	if len(clinicDraftPatch(profileBody{})) != 0 {
		t.Error("an empty body must produce an empty patch")
	}
}
