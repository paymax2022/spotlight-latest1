package owner

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

func keysOf(t *testing.T, v any) []string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// The wire types must carry exactly the camelCase keys the app's types.ts reads.
func TestWireShapes(t *testing.T) {
	cases := []struct {
		name string
		v    any
		want string
	}{
		{"appointment", wireAppointment{Location: strPtr("x"), ConsultID: strPtr("c"), SummaryID: strPtr("s"), PrescriptionID: strPtr("r")},
			"consultId,createdAt,feeKobo,homeVisitFeeKobo,id,location,paymentHeld,petId,petName,prescriptionId,reason,scheduledFor,status,summaryId,totalKobo,type,vetId,vetName"},
		{"record", wireRecord{ProviderName: strPtr("v")}, "at,flagged,id,kind,petId,providerName,sensitive,summary,title"},
		{"vaccination", wireVaccination{LastGivenAt: strPtr("a"), Notes: strPtr("n")}, "dueAt,id,lastGivenAt,notes,petId,status,vaccine"},
		{"review", wireReview{}, "at,author,body,id,rating"},
		{"message", wireConsultMessage{}, "authorName,body,fromProvider,id,sentAt"},
		{"consult", wireConsult{}, "appointmentId,id,messages,mode,petId,petName,providerReady,scheduledAt,status,vetId,vetName"},
		{"summary", wireSummary{FollowUpNote: strPtr("n"), PrescriptionID: strPtr("p"), LabOrderID: strPtr("l")},
			"appointmentId,completedAt,diagnosis,followUpNote,followUpRecommended,id,labOrderId,petId,petName,prescriptionId,soap,vetId,vetName"},
		{"soap", wireSoap{}, "assessment,objective,plan,subjective"},
		{"rxItem", wireRxItem{Instructions: strPtr("i")}, "dosage,drugName,durationDays,form,frequency,id,instructions,pom,quantity"},
		{"prescription", wirePrescription{AppointmentID: strPtr("a"), Notes: strPtr("n")},
			"appointmentId,expiresAt,id,issuedAt,items,notes,petId,petName,sensitive,status,vetCredential,vetId,vetName"},
		{"credential", wireCredential{}, "authority,licenseNo,status"},
		{"medication", wireMedication{PrescriptionID: strPtr("p")}, "active,dosage,drugName,frequency,id,nextRefillAt,petId,petName,prescriptionId,refillsRemaining"},
		{"tracking", wireTracking{}, "address,appointmentId,destLat,destLng,etaLabel,stage,vehicle,vetLat,vetLng,vetName,vetPhone"},
		{"emergency", wireEmergencyVet{}, "address,distanceLabel,id,lat,lng,name,open24h,phone"},
	}
	for _, tc := range cases {
		if got := strings.Join(keysOf(t, tc.v), ","); got != tc.want {
			t.Errorf("%s keys:\n got  %s\n want %s", tc.name, got, tc.want)
		}
	}
}

func TestFeeSplitAlwaysAddsUp(t *testing.T) {
	for _, tc := range []struct {
		visit     string
		total     int64
		fee, home int64
	}{
		{"TELE", 500000, 500000, 0}, {"CLINIC", 750000, 750000, 0}, {"HOME", 1200000, 0, 1200000}, {"home", 900, 0, 900},
	} {
		fee, home := feeSplit(tc.visit, tc.total)
		if fee != tc.fee || home != tc.home || fee+home != tc.total {
			t.Errorf("%s: got %d+%d want %d+%d", tc.visit, fee, home, tc.fee, tc.home)
		}
	}
}

func TestVaccinationStatus(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	day := func(n int) time.Time { return now.AddDate(0, 0, n) }
	given, sched := day(-3), day(9)
	for _, tc := range []struct {
		name         string
		due          time.Time
		given, sched *time.Time
		status       string
		shown        time.Time
	}{
		{"given", day(-10), &given, nil, "up_to_date", day(-10)},
		{"scheduled", day(-5), nil, &sched, "scheduled", sched},
		{"overdue", day(-1), nil, nil, "overdue", day(-1)},
		{"due soon", day(12), nil, nil, "due_soon", day(12)},
		{"far", day(120), nil, nil, "up_to_date", day(120)},
	} {
		st, shown := vaccinationStatus(now, tc.due, tc.given, tc.sched)
		if st != tc.status || !shown.Equal(tc.shown) {
			t.Errorf("%s: got %s %v want %s %v", tc.name, st, shown, tc.status, tc.shown)
		}
	}
}

func TestRxStatusMapping(t *testing.T) {
	now := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	fresh, old := now.AddDate(0, 0, -2), now.AddDate(0, 0, -45)
	for _, tc := range []struct {
		state   string
		created time.Time
		want    string
	}{
		{"ISSUED", fresh, "ISSUED"}, {"ISSUED", old, "EXPIRED"}, {"SENT_TO_PHARMACY", old, "SENT_TO_PHARMACY"},
		{"VERIFYING", fresh, "SENT_TO_PHARMACY"}, {"VERIFIED", fresh, "SENT_TO_PHARMACY"},
		{"DISPENSED", old, "DISPENSED"}, {"FULFILLED", old, "DISPENSED"}, {"REJECTED", fresh, "EXPIRED"},
	} {
		if got := rxStatus(tc.state, tc.created, now); got != tc.want {
			t.Errorf("%s/%v: got %s want %s", tc.state, tc.created, got, tc.want)
		}
	}
}

func TestStageAndConsultStatus(t *testing.T) {
	for _, tc := range []struct {
		state      string
		dispatched bool
		want       string
	}{
		{"REQUESTED", false, "assigned"}, {"CONFIRMED", false, "assigned"}, {"CONFIRMED", true, "en_route"},
		{"IN_PROGRESS", true, "in_progress"}, {"COMPLETED", true, "completed"},
	} {
		if got := homeVisitStage(tc.state, tc.dispatched); got != tc.want {
			t.Errorf("%s/%v: got %s want %s", tc.state, tc.dispatched, got, tc.want)
		}
	}
	for in, want := range map[string]string{"IN_PROGRESS": "in_progress", "COMPLETED": "completed", "SCHEDULED": "scheduled", "": "scheduled"} {
		if got := consultStatus(in); got != want {
			t.Errorf("consult %q: got %s want %s", in, got, want)
		}
	}
}

func TestRecordHelpers(t *testing.T) {
	for in, want := range map[string]string{"LAB_RESULT": "lab_result", "WEIGHT_CHECK": "weight", "VACCINATION": "vaccination",
		"RX_NOTE": "prescription", "CONSULT_NOTE": "consult_note", "OTHER": "document"} {
		if got := recordKind(in); got != want {
			t.Errorf("recordKind(%s) = %s want %s", in, got, want)
		}
	}
	if got := normaliseRecordRef(" pet_1234 "); got != "1234" {
		t.Errorf("normaliseRecordRef: %q", got)
	}
	if got := snippet("a   b\nc", 10); got != "a b c" {
		t.Errorf("snippet: %q", got)
	}
	if got := snippet(strings.Repeat("x", 30), 5); got != "xxxxx…" {
		t.Errorf("snippet truncation: %q", got)
	}
}

func TestToWireAppointmentSummaryOnlyWhenConsultCompleted(t *testing.T) {
	cid, done, open := "consult-1", "COMPLETED", "IN_PROGRESS"
	base := apptRow{ID: "a", ProviderID: "v", Visit: "HOME", State: "COMPLETED", PayState: "RELEASED", Total: 900, ConsultID: &cid}
	base.ConsultState = &done
	a := toWireAppointment(base)
	if a.SummaryID == nil || *a.SummaryID != cid || a.Type != "home" || a.HomeVisitFeeKobo != 900 || a.FeeKobo != 0 || a.PaymentHeld {
		t.Fatalf("completed: %+v", a)
	}
	base.ConsultState = &open
	if toWireAppointment(base).SummaryID != nil {
		t.Fatal("summaryId must be empty until the consult is completed")
	}
	base.PayState = "HELD"
	if !toWireAppointment(base).PaymentHeld {
		t.Fatal("paymentHeld must be true while the hold is open")
	}
}

func TestToWireMedication(t *testing.T) {
	now := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	disp := now.AddDate(0, 0, -10)
	m := toWireMedication(medRow{ItemID: "i", RxID: "r", Duration: 14, Created: now.AddDate(0, 0, -12), Dispensed: &disp,
		RefillsAuthorized: 2, RefillsUsed: 1, State: "DISPENSED"}, now)
	if m.RefillsRemaining != 1 || !m.Active || m.NextRefillAt != rfc(disp.AddDate(0, 0, 14)) || m.PrescriptionID == nil || *m.PrescriptionID != "r" {
		t.Fatalf("%+v", m)
	}
	over := toWireMedication(medRow{Created: now.AddDate(0, 0, -90), RefillsAuthorized: 1, RefillsUsed: 3, State: "DISPENSED"}, now)
	if over.RefillsRemaining != 0 || over.Active {
		t.Fatalf("a finished course with no refills must be inactive: %+v", over)
	}
	if rej := toWireMedication(medRow{Created: now, State: "REJECTED", RefillsAuthorized: 5}, now); rej.Active {
		t.Fatal("a rejected prescription is never active")
	}
}

func TestValidateBook(t *testing.T) {
	const pet, vet = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	good := func() bookRequest {
		return bookRequest{PetID: pet, VetID: vet, Type: "tele", ScheduledFor: "2026-11-02T09:00:00Z", Reason: " cough "}
	}
	r := good()
	start, visit, msg := validateBook(&r)
	if msg != "" || visit != "TELE" || !start.Equal(time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)) || r.Reason != "cough" {
		t.Fatalf("good request rejected: %q %q %v", msg, visit, start)
	}
	for name, mut := range map[string]func(*bookRequest){
		"bad pet":      func(b *bookRequest) { b.PetID = "x" },
		"bad vet":      func(b *bookRequest) { b.VetID = "" },
		"bad type":     func(b *bookRequest) { b.Type = "video" },
		"bad time":     func(b *bookRequest) { b.ScheduledFor = "tomorrow" },
		"long reason":  func(b *bookRequest) { b.Reason = strings.Repeat("a", 1001) },
		"home no addr": func(b *bookRequest) { b.Type = "home"; b.Location = "  " },
		"bad intake":   func(b *bookRequest) { s := "nope"; b.IntakeResponseID = &s },
	} {
		b := good()
		mut(&b)
		if _, _, m := validateBook(&b); m == "" {
			t.Errorf("%s: expected a validation message", name)
		}
	}
	h := good()
	h.Type, h.Location = "HOME", "12 Admiralty Way"
	if _, v, m := validateBook(&h); m != "" || v != "HOME" {
		t.Errorf("home with address: %q %q", m, v)
	}
}

func TestDraftAddress(t *testing.T) {
	if got := draftAddress(`{"draft":{"personalInfo":{"address":"5 Bode St","city":"Lagos"}}}`); got != "5 Bode St, Lagos" {
		t.Errorf("got %q", got)
	}
	if draftAddress("not json") != "" || draftAddress(`{"draft":{}}`) != "" {
		t.Error("an unreadable draft has no address")
	}
	if got := formatDistance(350); got != "350 m" {
		t.Errorf("got %q", got)
	}
	if got := formatDistance(2400); got != "2.4 km" {
		t.Errorf("got %q", got)
	}
}

// ---- routing / guards ----

func newGroup() (*gin.Engine, *gin.RouterGroup) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	return r, r.Group("/health/vet")
}

func routeSet(r *gin.Engine) []string {
	var out []string
	for _, ri := range r.Routes() {
		out = append(out, ri.Method+" "+ri.Path)
	}
	sort.Strings(out)
	return out
}

func TestRegisterMountsOwnerRoutesWithoutClashingWithExistingOnes(t *testing.T) {
	r, g := newGroup()
	Register(g, &pgxpool.Pool{})
	// The existing vet group's routes, registered alongside, must not panic on a clash.
	for _, p := range []string{"/pets", "/pets/:id", "/pets/:id/vaccinations", "/vets", "/vets/:id", "/vets/:id/availability",
		"/provider/availability", "/services", "/appointments/:id/accept", "/appointments/:id/confirm", "/appointments/:id/dispatch",
		"/consults/:id/start", "/consults/:id/complete", "/sos"} {
		g.Any(p, func(*gin.Context) {})
	}
	want := []string{
		"GET /health/vet/appointments/:id/tracking", "GET /health/vet/consults/:id", "GET /health/vet/emergency",
		"GET /health/vet/medications", "GET /health/vet/pets/:id/records", "GET /health/vet/prescriptions",
		"GET /health/vet/prescriptions/:id", "GET /health/vet/summaries/:id", "GET /health/vet/vaccinations",
		"GET /health/vet/vets/:id/reviews", "POST /health/vet/consults/:id/messages", "POST /health/vet/medications/:id/refill",
		"POST /health/vet/prescriptions/:id/send-to-pharmacy", "POST /health/vet/records/:id/consent", "POST /health/vet/reviews",
		"POST /health/vet/vaccinations/:id/schedule",
	}
	have := map[string]bool{}
	for _, s := range routeSet(r) {
		have[s] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("missing route %s", w)
		}
	}
}

func TestRegisterIsANoOpWithoutDependencies(t *testing.T) {
	r, g := newGroup()
	Register(g, nil)
	RegisterAppointmentAdapters(g, nil, nil)
	if len(r.Routes()) != 0 {
		t.Fatalf("expected no routes, got %v", routeSet(r))
	}
}

func do(h gin.HandlerFunc, method, path string, userID string, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
	})
	r.Handle(method, "/x/:id", h)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestHandlersRejectAnonymousAndMalformedIDsBeforeTouchingTheDatabase(t *testing.T) {
	h := &Handler{now: time.Now} // nil db: any query would panic, proving the guards run first
	handlers := map[string]gin.HandlerFunc{
		"PetRecords": h.PetRecords, "ScheduleVaccination": h.ScheduleVaccination, "ListReviews": h.ListReviews,
		"GetConsult": h.GetConsult, "SendConsultMessage": h.SendConsultMessage, "GetSummary": h.GetSummary,
		"GetPrescription": h.GetPrescription, "SendToPharmacy": h.SendToPharmacy, "AcknowledgeConsent": h.AcknowledgeConsent,
		"RequestRefill": h.RequestRefill, "HomeVisitTracking": h.HomeVisitTracking,
	}
	for name, fn := range handlers {
		if w := do(fn, http.MethodGet, "/x/11111111-1111-1111-1111-111111111111", "", "{}"); w.Code != http.StatusUnauthorized {
			t.Errorf("%s anonymous: got %d want 401", name, w.Code)
		}
		if w := do(fn, http.MethodGet, "/x/not-a-uuid", "u1", "{}"); w.Code != http.StatusBadRequest {
			t.Errorf("%s malformed id: got %d want 400", name, w.Code)
		}
	}
	for name, fn := range map[string]gin.HandlerFunc{"ListVaccinations": h.ListVaccinations, "ListPrescriptions": h.ListPrescriptions,
		"ListMedications": h.ListMedications, "EmergencyVets": h.EmergencyVets, "SubmitReview": h.SubmitReview} {
		if w := do(fn, http.MethodGet, "/x/1", "", "{}"); w.Code != http.StatusUnauthorized {
			t.Errorf("%s anonymous: got %d want 401", name, w.Code)
		}
	}
}

func TestSubmitReviewValidationRunsBeforeTheDatabase(t *testing.T) {
	h := &Handler{now: time.Now}
	const a, v = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	for name, body := range map[string]string{
		"rating 0":  `{"appointmentId":"` + a + `","vetId":"` + v + `","rating":0}`,
		"rating 6":  `{"appointmentId":"` + a + `","vetId":"` + v + `","rating":6}`,
		"bad appt":  `{"appointmentId":"x","vetId":"` + v + `","rating":5}`,
		"bad vet":   `{"appointmentId":"` + a + `","vetId":"x","rating":5}`,
		"long body": `{"appointmentId":"` + a + `","vetId":"` + v + `","rating":5,"body":"` + strings.Repeat("a", 1001) + `"}`,
		"not json":  `nope`,
	} {
		if w := do(h.SubmitReview, http.MethodPost, "/x/1", "u1", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d want 400", name, w.Code)
		}
	}
}

func TestSendMessageAndScheduleValidation(t *testing.T) {
	h := &Handler{now: time.Now}
	const id = "11111111-1111-1111-1111-111111111111"
	for name, body := range map[string]string{"empty": `{"body":"  "}`, "too long": `{"body":"` + strings.Repeat("a", 2001) + `"}`, "not json": `x`} {
		if w := do(h.SendConsultMessage, http.MethodPost, "/x/"+id, "u1", body); w.Code != http.StatusBadRequest {
			t.Errorf("message %s: got %d want 400", name, w.Code)
		}
	}
	if w := do(h.ScheduleVaccination, http.MethodPost, "/x/"+id, "u1", `{"dueAt":"soon"}`); w.Code != http.StatusBadRequest {
		t.Errorf("schedule bad date: got %d", w.Code)
	}
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	if w := do(h.ScheduleVaccination, http.MethodPost, "/x/"+id, "u1", `{"dueAt":"`+past+`"}`); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("schedule in the past: got %d want 422", w.Code)
	}
}

func TestBookRequiresIdempotencyKeyAndValidBody(t *testing.T) {
	h := &Handler{now: time.Now}
	const pet, vet = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	noKey := `{"petId":"` + pet + `","vetId":"` + vet + `","type":"tele","scheduledFor":"2026-11-02T09:00:00Z"}`
	if w := do(h.BookAppointment, http.MethodPost, "/x/1", "u1", noKey); w.Code != http.StatusBadRequest ||
		!strings.Contains(w.Body.String(), "Idempotency-Key") {
		t.Errorf("missing key: %d %s", w.Code, w.Body.String())
	}
	if w := do(h.BookAppointment, http.MethodPost, "/x/1", "u1", `{"petId":"x"}`); w.Code != http.StatusBadRequest {
		t.Errorf("bad body: %d", w.Code)
	}
	if w := do(h.BookAppointment, http.MethodPost, "/x/1", "", noKey); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", w.Code)
	}
}

func TestValidateBook_HomeVisitCoordinates(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	base := func() bookRequest {
		return bookRequest{
			PetID: "6c0722bf-a3bc-428e-9c97-9131ccd87cfe", VetID: "830d96e8-848b-4b40-9e54-4d22d91dd9c3",
			Type: "home", ScheduledFor: "2026-10-28T08:00:00Z", Location: "5 Awolowo Rd, Ikoyi",
		}
	}
	cases := []struct {
		name    string
		mutate  func(r *bookRequest)
		wantErr bool
	}{
		{"no coordinates is fine", func(r *bookRequest) {}, false},
		{"both coordinates", func(r *bookRequest) { r.DestLat, r.DestLng = f(6.45), f(3.43) }, false},
		{"lat without lng", func(r *bookRequest) { r.DestLat = f(6.45) }, true},
		{"lat out of range", func(r *bookRequest) { r.DestLat, r.DestLng = f(91), f(3.43) }, true},
		{"lng out of range", func(r *bookRequest) { r.DestLat, r.DestLng = f(6.45), f(-181) }, true},
	}
	for _, tc := range cases {
		r := base()
		tc.mutate(&r)
		if _, _, msg := validateBook(&r); (msg != "") != tc.wantErr {
			t.Errorf("%s: got message %q, wantErr=%v", tc.name, msg, tc.wantErr)
		}
	}
}
