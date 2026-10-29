package provider

// LIVE-DB coverage for the vet provider routes: real handlers over real tables,
// exercising authZ (no cross-vet access), the shared state machine, HL-8 chart
// gating, fee/profile writes, earnings and the rx/lab/referral writes.
//
// Skips unless TEST_DATABASE_URL is set. Every fixture hangs off throwaway
// auth.users rows that are deleted (cascading) on cleanup.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthconsult "spotlight/backend/internal/health/consult"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	healthvet "spotlight/backend/internal/health/vet"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/testsupport"
)

type liveFx struct {
	t         *testing.T
	pool      *pgxpool.Pool
	h         *Handler
	engine    *gin.Engine
	vetUser   string // approved vet
	vet2User  string // a different approved vet (the would-be snooper)
	ownerID   string
	petID     string
	provider  string
	provider2 string
}

func newLiveFx(t *testing.T) *liveFx {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet provider live-DB tests")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	sched := healthscheduling.NewService(pool, scheduler.NewService(pool), nil)
	rxSvc := healthrx.NewService(pool, nil)
	consult := healthconsult.NewService(pool, "live-test-key", nil)
	vetSvc := healthvet.NewService(pool, nil, nil, nil, nil, sched, consult, rxSvc, nil, scheduler.NewService(pool), nil)
	h := &Handler{db: pool, sched: sched, rx: rxSvc, vet: vetSvc}

	e := gin.New()
	e.Use(func(c *gin.Context) {
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
	})
	h.mount(e.Group("/v"))

	f := &liveFx{t: t, pool: pool, h: h, engine: e,
		vetUser: uuid.NewString(), vet2User: uuid.NewString(), ownerID: uuid.NewString()}
	ctx := t.Context()
	for _, u := range []string{f.vetUser, f.vet2User, f.ownerID} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO user_profiles (id, full_name, phone) VALUES ($1,'Chioma Eze','+2348012345678')
		ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, phone=EXCLUDED.phone`, f.ownerID); err != nil {
		t.Logf("user_profiles seed skipped: %v", err)
	}
	f.provider = f.seedProvider(f.vetUser, "APPROVED", "Dr Ade Vet")
	f.provider2 = f.seedProvider(f.vet2User, "APPROVED", "Dr Other Vet")
	f.petID = uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO pets (id, owner_user_id, name, species, breed, sex, weight_kg)
		VALUES ($1,$2,'Rex','DOG','Boerboel','MALE',32.5)`, f.petID, f.ownerID); err != nil {
		t.Fatalf("seed pet: %v", err)
	}
	return f
}

func (f *liveFx) seedProvider(owner, status, name string) string {
	f.t.Helper()
	id := uuid.NewString()
	if _, err := f.pool.Exec(f.t.Context(), `
		INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		VALUES ($1,$2,'VET','vet',$3,$4)`, id, owner, name, status); err != nil {
		f.t.Fatalf("seed provider: %v", err)
	}
	return id
}

// seedAppt books a PET appointment for the fixture pet with the given state and a
// payment row in payState (no escrow hold — money movement is the escrow rail's
// own test surface, not this package's).
func (f *liveFx) seedAppt(provider, state, payState string, start time.Time, kobo int64) string {
	f.t.Helper()
	id := uuid.NewString()
	ctx := f.t.Context()
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET','HOME',$4,$5,$6)`, id, provider, f.ownerID, state, start, start.Add(time.Hour)); err != nil {
		f.t.Fatalf("seed appointment: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments
		  (id, appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state, idempotency_key,
		   dest_lat, dest_lng)
		VALUES ($1,$2,$3,$4,$5,'HOME',$6,$7,$8,6.4474,3.4707)`,
		uuid.NewString(), id, f.ownerID, provider, f.petID, kobo, payState, "live-"+id); err != nil {
		f.t.Fatalf("seed payment: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO vet_appointment_details (appointment_id, owner_id, reason, location)
		VALUES ($1,$2,'Itchy ears','12 Admiralty Way, Lekki')`, id, f.ownerID); err != nil {
		f.t.Fatalf("seed details: %v", err)
	}
	return id
}

func (f *liveFx) do(user, method, path string, body any, hdr ...string) (int, []byte) {
	f.t.Helper()
	var rd *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, "/v"+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	w := httptest.NewRecorder()
	f.engine.ServeHTTP(w, req)
	return w.Code, w.Body.Bytes()
}

func (f *liveFx) apptState(id string) string {
	var s string
	if err := f.pool.QueryRow(f.t.Context(), `SELECT state FROM health_appointments WHERE id=$1`, id).Scan(&s); err != nil {
		f.t.Fatalf("state: %v", err)
	}
	return s
}

func inDays(n int) time.Time {
	return time.Now().Add(time.Duration(n) * 24 * time.Hour).Truncate(time.Minute)
}

func TestLive_ListIsScopedAndGated(t *testing.T) {
	f := newLiveFx(t)
	appt := f.seedAppt(f.provider, "REQUESTED", "HELD", inDays(2), 500000)

	code, body := f.do(f.vetUser, "GET", "/provider/appointments", nil)
	if code != 200 {
		t.Fatalf("list = %d %s", code, body)
	}
	var rows []wireApptRow
	if err := json.Unmarshal(body, &rows); err != nil || len(rows) != 1 {
		t.Fatalf("want 1 row, got %s (%v)", body, err)
	}
	r := rows[0]
	if r.AppointmentID != appt || r.PetName != "Rex" || r.Species != "dog" || r.Type != "home" ||
		r.Status != "REQUESTED" || r.Reason != "Itchy ears" {
		t.Errorf("row shape wrong: %+v", r)
	}
	if strings.Contains(r.OwnerName, "Eze") {
		t.Errorf("owner surname leaked: %q", r.OwnerName)
	}

	// Another vet sees nothing, and cannot act on or read around this appointment.
	if code, body = f.do(f.vet2User, "GET", "/provider/appointments", nil); code != 200 || strings.Contains(string(body), appt) {
		t.Errorf("a second vet must not see the appointment: %d %s", code, body)
	}
	if code, _ = f.do(f.vet2User, "POST", "/provider/appointments/"+appt+"/decision", map[string]string{"decision": "accept"}); code != 404 {
		t.Errorf("foreign decision = %d, want 404", code)
	}
	if code, _ = f.do(f.vet2User, "GET", "/provider/pets/"+f.petID+"/chart", nil); code != 404 {
		t.Errorf("a vet with no appointment for the pet must get 404, got %d", code)
	}
	// A pet owner is not a vet.
	if code, _ = f.do(f.ownerID, "GET", "/provider/appointments", nil); code != 403 {
		t.Errorf("owner on a provider route = %d, want 403", code)
	}
	// A vet whose VCN approval lapsed loses the workspace immediately (HL-2).
	if _, err := f.pool.Exec(t.Context(), `UPDATE health_providers SET status='SUSPENDED' WHERE id=$1`, f.provider2); err != nil {
		t.Fatal(err)
	}
	if code, _ = f.do(f.vet2User, "GET", "/provider/appointments", nil); code != 403 {
		t.Errorf("suspended vet = %d, want 403", code)
	}
	if code, _ = f.do("", "GET", "/provider/appointments", nil); code != 401 {
		t.Errorf("anonymous = %d, want 401", code)
	}
}

func TestLive_DecisionFlow(t *testing.T) {
	f := newLiveFx(t)
	appt := f.seedAppt(f.provider, "REQUESTED", "HELD", inDays(3), 500000)
	f.seedAppt(f.provider, "CONFIRMED", "HELD", inDays(5), 500000)
	path := "/provider/appointments/" + appt + "/decision"

	if code, _ := f.do(f.vetUser, "POST", path, map[string]string{"decision": "maybe"}); code != 400 {
		t.Errorf("unknown decision = %d, want 400", code)
	}
	code, body := f.do(f.vetUser, "POST", path, map[string]string{"decision": "accept"})
	if code != 200 || !strings.Contains(string(body), `"CONFIRMED"`) || f.apptState(appt) != "CONFIRMED" {
		t.Fatalf("accept = %d %s state=%s", code, body, f.apptState(appt))
	}
	// A retried tap is harmless.
	if code, _ = f.do(f.vetUser, "POST", path, map[string]string{"decision": "accept"}); code != 200 {
		t.Errorf("repeat accept = %d, want 200", code)
	}

	// Reschedule: refuses a clash with the vet's own other booking, past times and
	// a missing time; accepts a free future slot.
	clash := inDays(5).Add(30 * time.Minute).Format(time.RFC3339)
	if code, _ = f.do(f.vetUser, "POST", path, map[string]string{"decision": "reschedule", "scheduledFor": clash}); code != 409 {
		t.Errorf("clashing reschedule = %d, want 409", code)
	}
	if code, _ = f.do(f.vetUser, "POST", path, map[string]string{"decision": "reschedule", "scheduledFor": inDays(-1).Format(time.RFC3339)}); code != 400 {
		t.Errorf("past reschedule = %d, want 400", code)
	}
	if code, _ = f.do(f.vetUser, "POST", path, map[string]string{"decision": "reschedule"}); code != 400 {
		t.Errorf("reschedule without a time = %d, want 400", code)
	}
	free := inDays(8)
	if code, body = f.do(f.vetUser, "POST", path, map[string]string{"decision": "reschedule", "scheduledFor": free.Format(time.RFC3339)}); code != 200 {
		t.Fatalf("reschedule = %d %s", code, body)
	}
	var start time.Time
	_ = f.pool.QueryRow(t.Context(), `SELECT slot_start FROM health_appointments WHERE id=$1`, appt).Scan(&start)
	if !start.Equal(free) || f.apptState(appt) != "CONFIRMED" {
		t.Errorf("slot=%s state=%s, want %s CONFIRMED", start, f.apptState(appt), free)
	}

	// Decline cancels; a second decline is a conflict, not a crash.
	if code, body = f.do(f.vetUser, "POST", path, map[string]string{"decision": "decline"}); code != 200 || f.apptState(appt) != "CANCELLED" {
		t.Fatalf("decline = %d %s state=%s", code, body, f.apptState(appt))
	}
	var pay string
	_ = f.pool.QueryRow(t.Context(), `SELECT pay_state FROM vet_appointment_payments WHERE appointment_id=$1`, appt).Scan(&pay)
	if code, _ = f.do(f.vetUser, "POST", path, map[string]string{"decision": "decline"}); code != 409 {
		t.Errorf("second decline = %d, want 409", code)
	}
	if code, _ = f.do(f.vetUser, "POST", "/provider/appointments/not-a-uuid/decision", map[string]string{"decision": "accept"}); code != 400 {
		t.Errorf("bad id = %d, want 400", code)
	}
}

func TestLive_ChartIsConsentGated(t *testing.T) {
	f := newLiveFx(t)
	ctx := t.Context()
	f.seedAppt(f.provider, "CONFIRMED", "HELD", inDays(1), 500000)

	// Another vet's consult note + an owner-uploaded vault record.
	otherAppt := f.seedAppt(f.provider2, "COMPLETED", "RELEASED", inDays(-20), 500000)
	f.seedConsult(otherAppt, f.provider2, "COMPLETED", "Previous clinic: ear mites")
	recID := uuid.NewString()
	if _, err := f.pool.Exec(ctx, `INSERT INTO health_records (id, subject_type, owner_user_id, pet_ref, record_type, title, body, created_by)
		VALUES ($1,'PET',$2,$3,'LAB_RESULT','Blood panel','Normal',$2)`, recID, f.ownerID, f.petID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO vaccination_schedules (pet_id, owner_user_id, vaccine, due_at) VALUES ($1,$2,'Rabies',now() - interval '5 days')`,
		f.petID, f.ownerID); err != nil {
		t.Fatal(err)
	}

	type chart struct {
		Pet          wirePet           `json:"pet"`
		OwnerName    string            `json:"ownerName"`
		Vaccinations []wireVaccination `json:"vaccinations"`
		Records      []wireRecord      `json:"records"`
		WeightSeries []wireWeightPoint `json:"weightSeries"`
	}
	read := func() chart {
		code, body := f.do(f.vetUser, "GET", "/provider/pets/"+f.petID+"/chart", nil)
		if code != 200 {
			t.Fatalf("chart = %d %s", code, body)
		}
		var c chart
		if err := json.Unmarshal(body, &c); err != nil {
			t.Fatal(err)
		}
		return c
	}

	c := read()
	if c.Pet.Name != "Rex" || c.Pet.Species != "dog" || c.Pet.Sex != "male" || c.Pet.WeightKg == nil || *c.Pet.WeightKg != 32.5 {
		t.Errorf("pet = %+v", c.Pet)
	}
	if c.OwnerName == "" || strings.Contains(c.OwnerName, "Eze") {
		t.Errorf("owner name must be abbreviated, got %q", c.OwnerName)
	}
	if len(c.Vaccinations) != 1 || c.Vaccinations[0].Status != "overdue" {
		t.Errorf("vaccinations = %+v", c.Vaccinations)
	}
	if len(c.Records) != 0 {
		t.Errorf("without consent another provider's history and the vault must stay hidden, got %+v", c.Records)
	}
	if len(c.WeightSeries) != 1 {
		t.Errorf("weight series = %+v", c.WeightSeries)
	}

	// The owner grants the vet RECORDS consent → the history opens, and the vault
	// read is access-logged.
	if _, err := f.pool.Exec(ctx, `INSERT INTO health_consents (grantor_id, grantee_id, subject_owner_id, scope) VALUES ($1,$2,$1,'RECORDS')`,
		f.ownerID, f.vetUser); err != nil {
		t.Fatal(err)
	}
	c = read()
	if len(c.Records) != 2 {
		t.Fatalf("with consent want 2 records, got %+v", c.Records)
	}
	var logged int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM health_record_access_log WHERE record_id=$1 AND accessor_id=$2 AND access_basis='CONSENT'`,
		recID, f.vetUser).Scan(&logged)
	if logged != 1 {
		t.Errorf("vault access must be logged once, got %d", logged)
	}
}

func TestLive_ProfileFeesAndTypes(t *testing.T) {
	f := newLiveFx(t)
	ctx := t.Context()
	if _, err := f.pool.Exec(ctx, `INSERT INTO doctor_vet_profiles (user_id, profile_draft)
		VALUES ($1, '{"draft":{"bio":"old","speciesTreated":["DOG","CAT"],"affiliations":[{"name":"Lekki Vet Clinic","isPrimary":true}]}}'::jsonb)`, f.vetUser); err != nil {
		t.Fatal(err)
	}

	for name, body := range map[string]map[string]any{
		"bad type":         {"types": []string{"teleport"}},
		"negative fee":     {"consultFeeKobo": -1},
		"home without fee": {"types": []string{"home"}},
		"tele without fee": {"types": []string{"tele"}},
	} {
		if code, _ := f.do(f.vetUser, "PUT", "/provider/profile", body); code != 400 {
			t.Errorf("%s = %d, want 400", name, code)
		}
	}

	code, raw := f.do(f.vetUser, "PUT", "/provider/profile", map[string]any{
		"bio": "Small-animal vet, 9 years.", "consultFeeKobo": 500000, "homeVisitFeeKobo": 750000, "types": []string{"tele", "home"},
	})
	if code != 200 {
		t.Fatalf("put = %d %s", code, raw)
	}
	var p wireProfile
	_ = json.Unmarshal(raw, &p)
	if p.Bio != "Small-animal vet, 9 years." || p.ConsultFeeKobo != 500000 || p.HomeVisitFeeKobo != 750000 ||
		strings.Join(p.Types, ",") != "home,tele" || p.Status != "approved" || p.ClinicName != "Lekki Vet Clinic" ||
		strings.Join(p.Species, ",") != "dog,cat" {
		t.Errorf("profile = %+v", p)
	}
	// The bio merge must not clobber the rest of the draft the public listing reads.
	var draft string
	_ = f.pool.QueryRow(ctx, `SELECT profile_draft::text FROM doctor_vet_profiles WHERE user_id=$1`, f.vetUser).Scan(&draft)
	if !strings.Contains(draft, "speciesTreated") || !strings.Contains(draft, "Lekki Vet Clinic") {
		t.Errorf("draft was clobbered: %s", draft)
	}

	// Dropping a type deactivates its service (never deletes it).
	if code, raw = f.do(f.vetUser, "PUT", "/provider/profile", map[string]any{"types": []string{"tele"}}); code != 200 {
		t.Fatalf("put types = %d %s", code, raw)
	}
	var active, total int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE active), count(*) FROM vet_services WHERE provider_id=$1`, f.provider).Scan(&active, &total)
	if active != 1 || total != 2 {
		t.Errorf("active=%d total=%d, want 1 active of 2 kept", active, total)
	}
	var got wireProfile
	code, raw = f.do(f.vetUser, "GET", "/provider/profile", nil)
	_ = json.Unmarshal(raw, &got)
	if code != 200 || strings.Join(got.Types, ",") != "tele" || got.HomeVisitFeeKobo != 0 {
		t.Errorf("get after drop = %d %+v", code, got)
	}
}

func TestLive_EarningsAreReadOnlyAndPayoutIsRefused(t *testing.T) {
	f := newLiveFx(t)
	f.seedAppt(f.provider, "REQUESTED", "HELD", inDays(2), 100000) // pending
	f.seedAppt(f.provider, "CONFIRMED", "HELD", inDays(3), 250000) // held in service
	f.seedAppt(f.provider, "COMPLETED", "RELEASED", inDays(-4), 400000)
	f.seedAppt(f.provider2, "COMPLETED", "RELEASED", inDays(-4), 999999) // someone else's

	code, raw := f.do(f.vetUser, "GET", "/provider/earnings", nil)
	var e wireEarnings
	_ = json.Unmarshal(raw, &e)
	if code != 200 || e.AvailableKobo != 400000 || e.PendingKobo != 100000 || e.HeldKobo != 250000 || e.Payouts == nil {
		t.Errorf("earnings = %d %+v", code, e)
	}

	if code, _ = f.do(f.vetUser, "POST", "/provider/payouts", map[string]int64{"amountKobo": 400000}); code != 400 {
		t.Errorf("payout without Idempotency-Key = %d, want 400", code)
	}
	code, raw = f.do(f.vetUser, "POST", "/provider/payouts", map[string]int64{"amountKobo": 400000}, "Idempotency-Key", uuid.NewString())
	if code != http.StatusConflict || !strings.Contains(string(raw), "payout_via_wallet") {
		t.Errorf("payout = %d %s, want 409 payout_via_wallet", code, raw)
	}
	var n int
	_ = f.pool.QueryRow(t.Context(), `SELECT count(*) FROM payouts WHERE user_id=$1`, f.vetUser).Scan(&n)
	if n != 0 {
		t.Errorf("a payout row was written (%d)", n)
	}
}

func TestLive_LabReferralAndReviews(t *testing.T) {
	f := newLiveFx(t)
	ctx := t.Context()
	confirmed := f.seedAppt(f.provider, "CONFIRMED", "HELD", inDays(1), 500000)
	requested := f.seedAppt(f.provider, "REQUESTED", "HELD", inDays(2), 500000)

	lab := map[string]any{"appointmentId": confirmed, "petId": f.petID, "testNames": []string{"CBC", " ", "Skin scrape"}, "note": "fasting"}
	code, raw := f.do(f.vetUser, "POST", "/provider/lab-orders", lab)
	var res struct {
		OK         bool   `json:"ok"`
		LabOrderID string `json:"labOrderId"`
	}
	_ = json.Unmarshal(raw, &res)
	if code != 201 || !res.OK || !uuidish(res.LabOrderID) {
		t.Fatalf("lab = %d %s", code, raw)
	}
	var names []string
	_ = f.pool.QueryRow(ctx, `SELECT test_names FROM vet_lab_orders WHERE id=$1`, res.LabOrderID).Scan(&names)
	if strings.Join(names, "|") != "CBC|Skin scrape" {
		t.Errorf("blank test names must be dropped, got %v", names)
	}
	lab["appointmentId"] = requested
	if code, _ = f.do(f.vetUser, "POST", "/provider/lab-orders", lab); code != 409 {
		t.Errorf("lab order on an unconfirmed appointment = %d, want 409", code)
	}
	lab["appointmentId"], lab["testNames"] = confirmed, []string{}
	if code, _ = f.do(f.vetUser, "POST", "/provider/lab-orders", lab); code != 400 {
		t.Errorf("lab order with no tests = %d, want 400", code)
	}
	if code, _ = f.do(f.vet2User, "POST", "/provider/lab-orders", map[string]any{"appointmentId": confirmed, "testNames": []string{"CBC"}}); code != 404 {
		t.Errorf("foreign lab order = %d, want 404", code)
	}

	ref := map[string]any{"appointmentId": confirmed, "petId": f.petID, "specialty": "Dermatology", "toVetName": "Dr Skin", "reason": "chronic"}
	if code, raw = f.do(f.vetUser, "POST", "/provider/referrals", ref); code != 201 {
		t.Fatalf("referral = %d %s", code, raw)
	}
	ref["toVetName"] = ""
	if code, _ = f.do(f.vetUser, "POST", "/provider/referrals", ref); code != 400 {
		t.Errorf("referral without a vet name = %d, want 400", code)
	}

	if _, err := f.pool.Exec(ctx, `INSERT INTO vet_reviews (appointment_id, provider_id, owner_id, rating, body) VALUES ($1,$2,$3,5,'Brilliant with Rex')`,
		confirmed, f.provider, f.ownerID); err != nil {
		t.Fatal(err)
	}
	code, raw = f.do(f.vetUser, "GET", "/provider/reviews", nil)
	var reviews []wireReview
	_ = json.Unmarshal(raw, &reviews)
	if code != 200 || len(reviews) != 1 || reviews[0].Rating != 5 || strings.Contains(reviews[0].Author, "Eze") {
		t.Errorf("reviews = %d %+v", code, reviews)
	}
	if code, raw = f.do(f.vet2User, "GET", "/provider/reviews", nil); code != 200 || strings.TrimSpace(string(raw)) != "[]" {
		t.Errorf("another vet's reviews must be empty, got %d %s", code, raw)
	}
}

func TestLive_PrescriptionAndSoapReplay(t *testing.T) {
	f := newLiveFx(t)
	ctx := t.Context()
	appt := f.seedAppt(f.provider, "IN_PROGRESS", "HELD", inDays(0).Add(-time.Hour), 500000)

	rx := map[string]any{
		"appointmentId": appt, "petId": f.petID, "notes": "give with food",
		"items": []map[string]any{{"drugName": "Amoxicillin", "form": "tablet", "dosage": "250 mg", "frequency": "twice daily",
			"durationDays": 7, "quantity": 14, "pom": true, "instructions": "with food"}},
	}
	// No consult started yet → refused, nothing written.
	if code, raw := f.do(f.vetUser, "POST", "/provider/prescriptions", rx); code != 409 {
		t.Fatalf("rx before the consult starts = %d %s, want 409", code, raw)
	}
	consultID := uuid.NewString()
	if _, err := f.pool.Exec(ctx, `INSERT INTO health_consults (id, appointment_id, provider_id, patient_id, state, started_at)
		VALUES ($1,$2,$3,$4,'IN_PROGRESS',now())`, consultID, appt, f.provider, f.ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE vet_appointment_payments SET consult_id=$2 WHERE appointment_id=$1`, appt, consultID); err != nil {
		t.Fatal(err)
	}

	code, raw := f.do(f.vetUser, "POST", "/provider/prescriptions", rx)
	if code != 201 {
		t.Fatalf("rx = %d %s", code, raw)
	}
	var out wireRx
	_ = json.Unmarshal(raw, &out)
	if out.Status != "ISSUED" || out.PetName != "Rex" || out.VetName != "Dr Ade Vet" || len(out.Items) != 1 ||
		out.Items[0].Frequency != "twice daily" || out.Items[0].DurationDays != 7 || !out.Items[0].POM || !out.Sensitive {
		t.Errorf("rx wire = %+v", out)
	}
	if exp, err := time.Parse(time.RFC3339, out.ExpiresAt); err != nil || time.Until(exp) < 29*24*time.Hour {
		t.Errorf("expiry = %q (%v), want ~30 days", out.ExpiresAt, err)
	}
	var frequency string
	_ = f.pool.QueryRow(ctx, `SELECT m.frequency FROM vet_rx_item_details m WHERE m.item_id=$1`, out.Items[0].ID).Scan(&frequency)
	if frequency != "twice daily" {
		t.Errorf("item meta not stored: %q", frequency)
	}

	bad := map[string]any{"appointmentId": appt, "petId": uuid.NewString(), "items": rx["items"]}
	if code, _ = f.do(f.vetUser, "POST", "/provider/prescriptions", bad); code != 400 {
		t.Errorf("rx for the wrong pet = %d, want 400", code)
	}
	if code, _ = f.do(f.vet2User, "POST", "/provider/prescriptions", rx); code != 404 {
		t.Errorf("foreign rx = %d, want 404", code)
	}

	// SOAP replay: an appointment that is already COMPLETED only needs its summary.
	if _, err := f.pool.Exec(ctx, `UPDATE health_appointments SET state='COMPLETED' WHERE id=$1`, appt); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE health_consults SET state='COMPLETED', completed_at=now() WHERE id=$1`, consultID); err != nil {
		t.Fatal(err)
	}
	soap := map[string]any{"petId": f.petID, "diagnosis": "Otitis externa", "followUpRecommended": true, "followUpNote": "recheck in 2 weeks",
		"soap": map[string]string{"subjective": "head shaking", "objective": "red canals", "assessment": "otitis", "plan": "drops"}}
	var first, second struct {
		OK        bool   `json:"ok"`
		SummaryID string `json:"summaryId"`
	}
	code, raw = f.do(f.vetUser, "POST", "/provider/appointments/"+appt+"/soap", soap)
	_ = json.Unmarshal(raw, &first)
	if code != 200 || !first.OK || !uuidish(first.SummaryID) {
		t.Fatalf("soap = %d %s", code, raw)
	}
	code, raw = f.do(f.vetUser, "POST", "/provider/appointments/"+appt+"/soap", soap)
	_ = json.Unmarshal(raw, &second)
	if code != 200 || second.SummaryID != first.SummaryID {
		t.Errorf("soap replay = %d %s, want the same summary %s", code, raw, first.SummaryID)
	}
	if first.SummaryID != consultID {
		t.Errorf("the summary id must be the consult id the owner reads (%s), got %s", consultID, first.SummaryID)
	}
	var diag string
	_ = f.pool.QueryRow(ctx, `SELECT diagnosis FROM vet_consult_summary_extras WHERE consult_id=$1`, consultID).Scan(&diag)
	if diag != "Otitis externa" {
		t.Errorf("diagnosis not stored with the consult: %q", diag)
	}
	if code, _ = f.do(f.vetUser, "POST", "/provider/appointments/"+appt+"/soap", map[string]any{"petId": f.petID}); code != http.StatusBadRequest {
		t.Errorf("an empty note is refused before any replay lookup, got %d", code)
	}
	var n int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vet_consult_summary_extras WHERE consult_id=$1`, consultID).Scan(&n)
	if n != 1 {
		t.Errorf("exactly one summary per appointment, got %d", n)
	}
	_ = context.Background()
}

func TestLive_HomeNavOnlyForActiveHomeVisits(t *testing.T) {
	f := newLiveFx(t)
	appt := f.seedAppt(f.provider, "CONFIRMED", "HELD", inDays(1), 500000)
	code, raw := f.do(f.vetUser, "GET", "/provider/appointments/"+appt+"/nav", nil)
	var nav wireNav
	_ = json.Unmarshal(raw, &nav)
	if code != 200 || nav.Address != "12 Admiralty Way, Lekki" || nav.DestLat == 0 || nav.PetName != "Rex" {
		t.Errorf("nav = %d %+v", code, nav)
	}
	if code, _ = f.do(f.vet2User, "GET", "/provider/appointments/"+appt+"/nav", nil); code != 404 {
		t.Errorf("foreign nav = %d, want 404 (the owner's phone must not leak)", code)
	}
	done := f.seedAppt(f.provider, "COMPLETED", "RELEASED", inDays(-3), 500000)
	if code, _ = f.do(f.vetUser, "GET", "/provider/appointments/"+done+"/nav", nil); code != 409 {
		t.Errorf("nav for a finished visit = %d, want 409", code)
	}
}

// seedConsult records a consult for an appointment and pins it on the payment row,
// with an optional diagnosis in the owner-readable extras.
func (f *liveFx) seedConsult(apptID, provider, state, diagnosis string) string {
	f.t.Helper()
	ctx := f.t.Context()
	id := uuid.NewString()
	if _, err := f.pool.Exec(ctx, `INSERT INTO health_consults (id, appointment_id, provider_id, patient_id, state, completed_at)
		VALUES ($1,$2,$3,$4,$5, CASE WHEN $5='COMPLETED' THEN now() END)`, id, apptID, provider, f.ownerID, state); err != nil {
		f.t.Fatalf("seed consult: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE vet_appointment_payments SET consult_id=$2 WHERE appointment_id=$1`, apptID, id); err != nil {
		f.t.Fatalf("pin consult: %v", err)
	}
	if diagnosis != "" {
		if _, err := f.pool.Exec(ctx, `INSERT INTO vet_consult_summary_extras (consult_id, diagnosis) VALUES ($1,$2)`, id, diagnosis); err != nil {
			f.t.Fatalf("seed extras: %v", err)
		}
	}
	return id
}

// Setting a clinic location writes the address into the draft the public listing
// reads, puts the vet on the map (health_providers.geo), never clobbers the rest
// of the draft, and makes discovery return the coordinates.
func TestLive_ClinicLocation(t *testing.T) {
	f := newLiveFx(t)
	ctx := t.Context()
	if _, err := f.pool.Exec(ctx, `INSERT INTO doctor_vet_profiles (user_id, profile_draft)
		VALUES ($1, '{"draft":{"bio":"keep me","speciesTreated":["DOG"],"personalInfo":{"firstName":"Ade","title":"Dr"},"affiliations":[{"name":"Lekki Vet Clinic","isPrimary":true}]}}'::jsonb)`, f.vetUser); err != nil {
		t.Fatal(err)
	}

	for name, body := range map[string]map[string]any{
		"lat only":     {"clinicLat": 6.45},
		"out of range": {"clinicLat": 95.0, "clinicLng": 3.4},
		"null island":  {"clinicLat": 0.0, "clinicLng": 0.0},
		"address long": {"clinicAddress": strings.Repeat("a", 201)},
	} {
		if code, _ := f.do(f.vetUser, "PUT", "/provider/profile", body); code != 400 {
			t.Errorf("%s = %d, want 400", name, code)
		}
	}
	var geoSet bool
	_ = f.pool.QueryRow(ctx, `SELECT geo IS NOT NULL FROM health_providers WHERE id=$1`, f.provider).Scan(&geoSet)
	if geoSet {
		t.Fatal("a rejected save must not set the geo point")
	}

	code, raw := f.do(f.vetUser, "PUT", "/provider/profile", map[string]any{
		"clinicAddress": "5 Awolowo Rd, Ikoyi", "clinicCity": "Lagos", "clinicState": "Lagos",
		"clinicLat": 6.4503, "clinicLng": 3.4316,
	})
	if code != 200 {
		t.Fatalf("put = %d %s", code, raw)
	}
	var p wireProfile
	_ = json.Unmarshal(raw, &p)
	if p.ClinicAddress != "5 Awolowo Rd, Ikoyi" || p.ClinicCity != "Lagos" || p.ClinicState != "Lagos" ||
		p.ClinicLat == nil || p.ClinicLng == nil || *p.ClinicLat < 6.4502 || *p.ClinicLat > 6.4504 || *p.ClinicLng < 3.4315 || *p.ClinicLng > 3.4317 {
		t.Errorf("profile = %+v", p)
	}

	// The rest of the draft survives, including sibling personalInfo keys.
	var draft string
	_ = f.pool.QueryRow(ctx, `SELECT profile_draft::text FROM doctor_vet_profiles WHERE user_id=$1`, f.vetUser).Scan(&draft)
	for _, want := range []string{"keep me", "speciesTreated", "Lekki Vet Clinic", `"firstName"`, "5 Awolowo Rd, Ikoyi"} {
		if !strings.Contains(draft, want) {
			t.Errorf("draft lost %q: %s", want, draft)
		}
	}

	// A later save that omits the location leaves it alone.
	if code, raw = f.do(f.vetUser, "PUT", "/provider/profile", map[string]any{"bio": "new bio"}); code != 200 {
		t.Fatalf("bio put = %d %s", code, raw)
	}
	var again wireProfile
	_ = json.Unmarshal(raw, &again)
	if again.ClinicLat == nil || again.ClinicAddress != "5 Awolowo Rd, Ikoyi" {
		t.Errorf("location was cleared by an unrelated save: %+v", again)
	}

	// Another vet cannot change this vet's point, and a suspended vet is still refused.
	if _, err := f.pool.Exec(ctx, `UPDATE health_providers SET status='SUSPENDED' WHERE id=$1`, f.provider2); err != nil {
		t.Fatal(err)
	}
	if code, _ = f.do(f.vet2User, "PUT", "/provider/profile", map[string]any{"clinicLat": 1.0, "clinicLng": 1.0}); code != 403 {
		t.Errorf("suspended vet = %d, want 403", code)
	}
	var otherGeo bool
	_ = f.pool.QueryRow(ctx, `SELECT geo IS NOT NULL FROM health_providers WHERE id=$1`, f.provider2).Scan(&otherGeo)
	if otherGeo {
		t.Error("a refused save must not set geo")
	}

	// Discovery now carries the coordinates for this vet.
	// Approval is what makes a vet discoverable in real use; the fixture sets it directly.
	if _, err := f.pool.Exec(ctx, `UPDATE health_providers SET discoverable=true WHERE id=$1`, f.provider); err != nil {
		t.Fatal(err)
	}
	dh := healthvet.NewHandler(f.h.vet, nil)
	f.engine.GET("/v/vets", func(c *gin.Context) { c.Set("user_id", f.ownerID); dh.DiscoverVets(c) })
	req := httptest.NewRequest("GET", "/v/vets?lat=6.45&lng=3.43&radiusKm=20", nil)
	req.Header.Set("X-Test-User", f.ownerID)
	w := httptest.NewRecorder()
	f.engine.ServeHTTP(w, req)
	var disc struct {
		Vets []struct {
			ID      string  `json:"id"`
			Address string  `json:"address"`
			Lat     float64 `json:"lat"`
			Lng     float64 `json:"lng"`
		} `json:"vets"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &disc)
	found := false
	for _, v := range disc.Vets {
		if v.ID == f.provider {
			found = true
			if v.Lat < 6.4502 || v.Lat > 6.4504 || v.Lng < 3.4315 || v.Lng > 3.4317 || !strings.Contains(v.Address, "5 Awolowo Rd") {
				t.Errorf("discovery row = %+v", v)
			}
		}
	}
	if !found {
		t.Errorf("vet missing from near-me discovery (%d), body: %s", w.Code, w.Body.String())
	}
}
