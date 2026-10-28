package owner

// LIVE-DB test: every owner endpoint against the real schema. Everything — users,
// pets, appointments, consults, clinical notes (append-only), prescriptions — is
// seeded inside ONE transaction that is rolled back, so nothing is left behind.
// Skipped unless TEST_DATABASE_URL is set.

import (
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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type liveWorld struct {
	tx                                          pgx.Tx
	h                                           *Handler
	owner, vetUser, stranger                    string
	pet, provider, appt, consult, rx, item, vac string
	homeAppt                                    string
}

func must(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("seed failed: %v\nSQL: %s", err, sql)
	}
}

func newLiveWorld(t *testing.T) *liveWorld {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet owner live-DB tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	w := &liveWorld{tx: tx, owner: uuid.NewString(), vetUser: uuid.NewString(), stranger: uuid.NewString(),
		pet: uuid.NewString(), provider: uuid.NewString(), appt: uuid.NewString(), consult: uuid.NewString(),
		rx: uuid.NewString(), item: uuid.NewString(), vac: uuid.NewString(), homeAppt: uuid.NewString()}
	w.h = &Handler{db: tx, now: time.Now}

	for _, u := range []string{w.owner, w.vetUser, w.stranger} {
		must(t, tx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`, u, u+"@seed.test")
	}
	must(t, tx, `INSERT INTO pets (id, owner_user_id, name, species, breed, sex) VALUES ($1,$2,'Rex','DOG','Boerboel','MALE')`, w.pet, w.owner)
	must(t, tx, `INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status, discoverable)
	             VALUES ($1,$2,'VET','vet','Dr Ada Vet','APPROVED', true)`, w.provider, w.vetUser)
	must(t, tx, `UPDATE health_providers SET geo = ST_SetSRID(ST_MakePoint(3.4, 6.5),4326)::geography WHERE id=$1`, w.provider)
	must(t, tx, `INSERT INTO doctor_vet_profiles (user_id, is_published, verification, profile_draft)
	             VALUES ($1, true, 'approved', '{"draft":{"personalInfo":{"address":"5 Bode St","city":"Lagos"}}}'::jsonb)`, w.vetUser)
	must(t, tx, `INSERT INTO vet_services (provider_id, code, name, visit_type, price_kobo, active) VALUES ($1,'CLINIC1','Clinic visit','CLINIC',800000,true)`, w.provider)

	// a completed tele appointment with a completed consult, note, prescription
	must(t, tx, `INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
	             VALUES ($1,$2,$3,'PET','TELE','COMPLETED', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes')`, w.appt, w.provider, w.owner)
	must(t, tx, `INSERT INTO health_consults (id, appointment_id, provider_id, patient_id, state, completed_at)
	             VALUES ($1,$2,$3,$4,'COMPLETED', now() - interval '2 days')`, w.consult, w.appt, w.provider, w.owner)
	must(t, tx, `INSERT INTO vet_appointment_payments (appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state, consult_id, idempotency_key)
	             VALUES ($1,$2,$3,$4,'TELE',500000,'RELEASED',$5,$6)`, w.appt, w.owner, w.provider, w.pet, w.consult, "k-"+w.appt)
	must(t, tx, `INSERT INTO vet_appointment_details (appointment_id, owner_id, reason, location) VALUES ($1,$2,'Limping on the left leg','')`, w.appt, w.owner)
	must(t, tx, `INSERT INTO health_clinical_notes (consult_id, author_id, subjective, objective, assessment, plan)
	             VALUES ($1,$2,'Limp for 3 days','Swollen paw','Soft tissue strain','Rest and meds')`, w.consult, w.vetUser)
	must(t, tx, `INSERT INTO vet_consult_summary_extras (consult_id, diagnosis, follow_up_recommended, follow_up_note) VALUES ($1,'Paw sprain',true,'Recheck in 2 weeks')`, w.consult)
	must(t, tx, `INSERT INTO health_prescriptions (id, consult_id, prescriber_id, patient_id, state, dispensed_at, refills_authorized, refills_used)
	             VALUES ($1,$2,$3,$4,'DISPENSED', now() - interval '1 day', 2, 0)`, w.rx, w.consult, w.vetUser, w.owner)
	must(t, tx, `INSERT INTO health_prescription_items (id, prescription_id, drug_name, dosage, quantity, is_pom) VALUES ($1,$2,'Meloxicam','0.1 mg/kg',10,true)`, w.item, w.rx)
	must(t, tx, `INSERT INTO vet_rx_item_details (item_id, form, frequency, duration_days, instructions) VALUES ($1,'tablet','once daily',10,'Give with food')`, w.item)
	must(t, tx, `INSERT INTO vaccination_schedules (id, pet_id, owner_user_id, vaccine, due_at) VALUES ($1,$2,$3,'Rabies', now() + interval '10 days')`, w.vac, w.pet, w.owner)
	must(t, tx, `INSERT INTO health_records (subject_type, owner_user_id, pet_ref, record_type, title, body, created_by)
	             VALUES ('PET',$1,$2,'LAB_RESULT','Blood panel','All values normal, mild anaemia noted',$3)`, w.owner, w.pet, w.vetUser)

	// a confirmed HOME visit with a dispatch
	must(t, tx, `INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
	             VALUES ($1,$2,$3,'PET','HOME','CONFIRMED', now() + interval '2 days', now() + interval '2 days' + interval '30 minutes')`, w.homeAppt, w.provider, w.owner)
	must(t, tx, `INSERT INTO vet_appointment_payments (appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state, delivery_ref, idempotency_key)
	             VALUES ($1,$2,$3,$4,'HOME',1200000,'HELD','dlv_1',$5)`, w.homeAppt, w.owner, w.provider, w.pet, "k-"+w.homeAppt)
	must(t, tx, `INSERT INTO vet_appointment_details (appointment_id, owner_id, reason, location) VALUES ($1,$2,'Annual check','12 Admiralty Way, Lekki')`, w.homeAppt, w.owner)
	return w
}

// call runs one handler as `user` and decodes the JSON body.
func (w *liveWorld) call(t *testing.T, fn gin.HandlerFunc, method, route, target, user, body string, out any) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if user != "" {
			c.Set("user_id", user)
		}
	})
	r.Handle(method, route, fn)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	if out != nil && rec.Code < 300 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("decode %s: %v\n%s", target, err, rec.Body.String())
		}
	}
	return rec.Code
}

func TestLiveDB_OwnerAppointmentsAndProjection(t *testing.T) {
	w := newLiveWorld(t)

	var list struct {
		Appointments []wireAppointment `json:"appointments"`
	}
	if code := w.call(t, w.h.ListAppointments, "GET", "/a", "/a", w.owner, "", &list); code != 200 || len(list.Appointments) != 2 {
		t.Fatalf("list: %d %+v", code, list)
	}
	var done *wireAppointment
	for i := range list.Appointments {
		if list.Appointments[i].ID == w.appt {
			done = &list.Appointments[i]
		}
	}
	if done == nil || done.Status != "COMPLETED" || done.Type != "tele" || done.PetName != "Rex" || done.VetName != "Dr Ada Vet" ||
		done.Reason != "Limping on the left leg" || done.TotalKobo != 500000 || done.FeeKobo != 500000 || done.PaymentHeld ||
		done.SummaryID == nil || *done.SummaryID != w.consult || done.PrescriptionID == nil || *done.PrescriptionID != w.rx {
		t.Fatalf("projection: %+v", done)
	}

	// a stranger sees nothing in their list and 404 on the owner's appointment
	var other struct {
		Appointments []wireAppointment `json:"appointments"`
	}
	if code := w.call(t, w.h.ListAppointments, "GET", "/a", "/a", w.stranger, "", &other); code != 200 || len(other.Appointments) != 0 {
		t.Fatalf("stranger list: %d %+v", code, other)
	}
	if code := w.call(t, w.h.GetAppointment, "GET", "/a/:id", "/a/"+w.appt, w.stranger, "", nil); code != http.StatusNotFound {
		t.Fatalf("IDOR: stranger got %d", code)
	}
	// the owner and the vet's owner may read it
	var one wireAppointment
	if code := w.call(t, w.h.GetAppointment, "GET", "/a/:id", "/a/"+w.appt, w.vetUser, "", &one); code != 200 || one.ID != w.appt {
		t.Fatalf("vet read: %d %+v", code, one)
	}

	// the HOME visit: fee split + tracking
	var trk wireTracking
	if code := w.call(t, w.h.HomeVisitTracking, "GET", "/t/:id", "/t/"+w.homeAppt, w.owner, "", &trk); code != 200 ||
		trk.Stage != "en_route" || trk.Address != "12 Admiralty Way, Lekki" || trk.VetName != "Dr Ada Vet" || trk.VetLat < 6.4 || trk.VetLat > 6.6 {
		t.Fatalf("tracking: %d %+v", code, trk)
	}
	if code := w.call(t, w.h.HomeVisitTracking, "GET", "/t/:id", "/t/"+w.appt, w.owner, "", nil); code != http.StatusNotFound {
		t.Fatalf("tracking a TELE visit: %d", code)
	}
	if code := w.call(t, w.h.HomeVisitTracking, "GET", "/t/:id", "/t/"+w.homeAppt, w.stranger, "", nil); code != http.StatusNotFound {
		t.Fatalf("tracking IDOR: %d", code)
	}
}

func TestLiveDB_RecordsVaccinationsConsent(t *testing.T) {
	w := newLiveWorld(t)

	var recs []wireRecord
	if code := w.call(t, w.h.PetRecords, "GET", "/p/:id/records", "/p/"+w.pet+"/records", w.owner, "", &recs); code != 200 {
		t.Fatalf("records: %d", code)
	}
	kinds := map[string]bool{}
	for _, r := range recs {
		kinds[r.Kind] = true
		if r.PetID != w.pet {
			t.Fatalf("wrong pet on %+v", r)
		}
	}
	if !kinds["lab_result"] || !kinds["consult_note"] || !kinds["prescription"] || len(recs) != 3 {
		t.Fatalf("expected lab_result + consult_note + prescription, got %+v", recs)
	}
	if code := w.call(t, w.h.PetRecords, "GET", "/p/:id/records", "/p/"+w.pet+"/records", w.stranger, "", nil); code != http.StatusNotFound {
		t.Fatalf("records IDOR: %d", code)
	}

	var vacs []wireVaccination
	if code := w.call(t, w.h.ListVaccinations, "GET", "/v", "/v?petId="+w.pet, w.owner, "", &vacs); code != 200 || len(vacs) != 1 ||
		vacs[0].Vaccine != "Rabies" || vacs[0].Status != "due_soon" {
		t.Fatalf("vaccinations: %d %+v", code, vacs)
	}
	var none []wireVaccination
	if code := w.call(t, w.h.ListVaccinations, "GET", "/v", "/v", w.stranger, "", &none); code != 200 || len(none) != 0 {
		t.Fatalf("vaccination IDOR: %d %+v", code, none)
	}
	when := time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)
	var sched wireVaccination
	if code := w.call(t, w.h.ScheduleVaccination, "POST", "/v/:id/schedule", "/v/"+w.vac+"/schedule", w.owner, `{"dueAt":"`+when+`"}`, &sched); code != 200 ||
		sched.Status != "scheduled" || sched.DueAt != when {
		t.Fatalf("schedule: %d %+v", code, sched)
	}
	if code := w.call(t, w.h.ScheduleVaccination, "POST", "/v/:id/schedule", "/v/"+w.vac+"/schedule", w.stranger, `{"dueAt":"`+when+`"}`, nil); code != http.StatusNotFound {
		t.Fatalf("schedule IDOR: %d", code)
	}

	var ack struct{ Acknowledged bool }
	if code := w.call(t, w.h.AcknowledgeConsent, "POST", "/c/:id", "/c/pet_"+w.pet, w.owner, "{}", &ack); code != 200 || !ack.Acknowledged {
		t.Fatalf("consent (pet ref): %d", code)
	}
	if code := w.call(t, w.h.AcknowledgeConsent, "POST", "/c/:id", "/c/"+w.rx, w.owner, "{}", nil); code != 200 {
		t.Fatalf("consent (rx): %d", code)
	}
	if code := w.call(t, w.h.AcknowledgeConsent, "POST", "/c/:id", "/c/"+w.rx, w.owner, "{}", nil); code != 200 {
		t.Fatalf("consent replay must stay 200: %d", code)
	}
	var n int
	if err := w.tx.QueryRow(context.Background(), `SELECT count(*) FROM vet_record_consents WHERE owner_id=$1`, w.owner).Scan(&n); err != nil || n != 2 {
		t.Fatalf("consent rows: %d %v", n, err)
	}
	if code := w.call(t, w.h.AcknowledgeConsent, "POST", "/c/:id", "/c/"+w.rx, w.stranger, "{}", nil); code != http.StatusNotFound {
		t.Fatalf("consent IDOR: %d", code)
	}
}

func TestLiveDB_ConsultSummaryChatReviews(t *testing.T) {
	w := newLiveWorld(t)

	// summary
	var s wireSummary
	if code := w.call(t, w.h.GetSummary, "GET", "/s/:id", "/s/"+w.consult, w.owner, "", &s); code != 200 ||
		s.Soap.Assessment != "Soft tissue strain" || s.Diagnosis != "Paw sprain" || !s.FollowUpRecommended ||
		s.FollowUpNote == nil || *s.FollowUpNote != "Recheck in 2 weeks" || s.PrescriptionID == nil || *s.PrescriptionID != w.rx ||
		s.AppointmentID != w.appt || s.PetName != "Rex" || s.CompletedAt == "" {
		t.Fatalf("summary: %d %+v", code, s)
	}
	if code := w.call(t, w.h.GetSummary, "GET", "/s/:id", "/s/"+w.consult, w.stranger, "", nil); code != http.StatusNotFound {
		t.Fatalf("summary IDOR: %d", code)
	}

	// consult resolves by consult id and by appointment id
	var c1, c2 wireConsult
	if code := w.call(t, w.h.GetConsult, "GET", "/c/:id", "/c/"+w.consult, w.owner, "", &c1); code != 200 || c1.Status != "completed" || c1.ID != w.consult || c1.AppointmentID != w.appt {
		t.Fatalf("consult by id: %d %+v", code, c1)
	}
	if code := w.call(t, w.h.GetConsult, "GET", "/c/:id", "/c/"+w.appt, w.owner, "", &c2); code != 200 || c2.ID != w.consult {
		t.Fatalf("consult by appointment: %d %+v", code, c2)
	}
	if code := w.call(t, w.h.GetConsult, "GET", "/c/:id", "/c/"+w.consult, w.stranger, "", nil); code != http.StatusNotFound {
		t.Fatalf("consult IDOR: %d", code)
	}
	// a consult that has not been started yet is addressed by the appointment id
	var pre wireConsult
	if code := w.call(t, w.h.GetConsult, "GET", "/c/:id", "/c/"+w.homeAppt, w.owner, "", &pre); code != 200 || pre.ID != w.homeAppt || pre.Status != "scheduled" || pre.ProviderReady {
		t.Fatalf("pre-start consult: %d %+v", code, pre)
	}

	// chat on the live (home) appointment: owner and vet can post, stranger cannot, closed appointments refuse
	var m1, m2 wireConsultMessage
	if code := w.call(t, w.h.SendConsultMessage, "POST", "/c/:id/m", "/c/"+w.homeAppt+"/m", w.owner, `{"body":"Hello doctor"}`, &m1); code != 201 || m1.FromProvider || m1.AuthorName != "You" {
		t.Fatalf("owner message: %d %+v", code, m1)
	}
	if code := w.call(t, w.h.SendConsultMessage, "POST", "/c/:id/m", "/c/"+w.homeAppt+"/m", w.vetUser, `{"body":"Hi, on my way"}`, &m2); code != 201 || !m2.FromProvider || m2.AuthorName != "Dr Ada Vet" {
		t.Fatalf("vet message: %d %+v", code, m2)
	}
	if code := w.call(t, w.h.SendConsultMessage, "POST", "/c/:id/m", "/c/"+w.homeAppt+"/m", w.stranger, `{"body":"x"}`, nil); code != http.StatusNotFound {
		t.Fatalf("chat IDOR: %d", code)
	}
	if code := w.call(t, w.h.SendConsultMessage, "POST", "/c/:id/m", "/c/"+w.appt+"/m", w.owner, `{"body":"late"}`, nil); code != http.StatusConflict {
		t.Fatalf("chat on a completed visit: %d", code)
	}
	var thread wireConsult
	if code := w.call(t, w.h.GetConsult, "GET", "/c/:id", "/c/"+w.homeAppt, w.owner, "", &thread); code != 200 || len(thread.Messages) != 2 ||
		thread.Messages[0].Body != "Hello doctor" || !thread.Messages[1].FromProvider {
		t.Fatalf("thread: %d %+v", code, thread)
	}

	// reviews: only a completed appointment, once, by its owner
	body := `{"appointmentId":"` + w.appt + `","vetId":"` + w.provider + `","rating":5,"body":"Wonderful with Rex"}`
	var rv wireReview
	if code := w.call(t, w.h.SubmitReview, "POST", "/r", "/r", w.owner, body, &rv); code != 201 || rv.Rating != 5 || rv.Author != "You" || rv.Body != "Wonderful with Rex" {
		t.Fatalf("review: %d %+v", code, rv)
	}
	var again wireReview
	if code := w.call(t, w.h.SubmitReview, "POST", "/r", "/r", w.owner, strings.Replace(body, `"rating":5`, `"rating":1`, 1), &again); code != 201 || again.ID != rv.ID || again.Rating != 5 {
		t.Fatalf("review replay must return the first one: %d %+v", code, again)
	}
	if code := w.call(t, w.h.SubmitReview, "POST", "/r", "/r", w.stranger, body, nil); code != http.StatusNotFound {
		t.Fatalf("review IDOR: %d", code)
	}
	live := `{"appointmentId":"` + w.homeAppt + `","vetId":"` + w.provider + `","rating":4}`
	if code := w.call(t, w.h.SubmitReview, "POST", "/r", "/r", w.owner, live, nil); code != http.StatusConflict {
		t.Fatalf("review before completion: %d", code)
	}
	var reviews []wireReview
	if code := w.call(t, w.h.ListReviews, "GET", "/v/:id/r", "/v/"+w.provider+"/r", w.stranger, "", &reviews); code != 200 || len(reviews) != 1 ||
		reviews[0].Author != "Pet owner" || reviews[0].Rating != 5 {
		t.Fatalf("list reviews: %d %+v", code, reviews)
	}
	// a hidden review disappears from the list
	must(t, w.tx, `UPDATE vet_reviews SET is_hidden = true WHERE id = $1`, rv.ID)
	var hidden []wireReview
	if code := w.call(t, w.h.ListReviews, "GET", "/v/:id/r", "/v/"+w.provider+"/r", w.stranger, "", &hidden); code != 200 || len(hidden) != 0 {
		t.Fatalf("hidden review still listed: %+v", hidden)
	}
}

func TestLiveDB_PrescriptionsMedicationsEmergency(t *testing.T) {
	w := newLiveWorld(t)

	var one wirePrescription
	if code := w.call(t, w.h.GetPrescription, "GET", "/p/:id", "/p/"+w.rx, w.owner, "", &one); code != 200 {
		t.Fatalf("get rx: %d", code)
	}
	if one.Status != "DISPENSED" || one.PetName != "Rex" || one.VetName != "Dr Ada Vet" || one.VetCredential.Status != "verified" ||
		one.VetCredential.Authority != "VCN" || !one.Sensitive || len(one.Items) != 1 {
		t.Fatalf("rx: %+v", one)
	}
	it := one.Items[0]
	if it.DrugName != "Meloxicam" || it.Form != "tablet" || it.Frequency != "once daily" || it.DurationDays != 10 || it.Quantity != 10 || !it.POM ||
		it.Instructions == nil || *it.Instructions != "Give with food" {
		t.Fatalf("rx item: %+v", it)
	}
	if code := w.call(t, w.h.GetPrescription, "GET", "/p/:id", "/p/"+w.rx, w.stranger, "", nil); code != http.StatusNotFound {
		t.Fatalf("rx IDOR: %d", code)
	}
	var all []wirePrescription
	if code := w.call(t, w.h.ListPrescriptions, "GET", "/p", "/p?petId="+w.pet, w.owner, "", &all); code != 200 || len(all) != 1 {
		t.Fatalf("list rx: %d %+v", code, all)
	}
	var otherPet []wirePrescription
	if code := w.call(t, w.h.ListPrescriptions, "GET", "/p", "/p?petId="+uuid.NewString(), w.owner, "", &otherPet); code != 200 || len(otherPet) != 0 {
		t.Fatalf("rx for another pet: %+v", otherPet)
	}

	// medications derive from the prescribed items
	var meds []wireMedication
	if code := w.call(t, w.h.ListMedications, "GET", "/m", "/m?petId="+w.pet, w.owner, "", &meds); code != 200 || len(meds) != 1 ||
		meds[0].ID != w.item || meds[0].DrugName != "Meloxicam" || meds[0].Frequency != "once daily" || meds[0].RefillsRemaining != 2 || !meds[0].Active {
		t.Fatalf("meds: %d %+v", code, meds)
	}
	if code := w.call(t, w.h.RequestRefill, "POST", "/m/:id/refill", "/m/"+w.item+"/refill", w.stranger, "{}", nil); code != http.StatusNotFound {
		t.Fatalf("refill IDOR: %d", code)
	}
	for i := 0; i < 2; i++ { // a repeat while the first is open is a no-op, not a duplicate row
		if code := w.call(t, w.h.RequestRefill, "POST", "/m/:id/refill", "/m/"+w.item+"/refill", w.owner, "{}", nil); code != 200 {
			t.Fatalf("refill #%d: %d", i, code)
		}
	}
	var n int
	if err := w.tx.QueryRow(context.Background(), `SELECT count(*) FROM vet_refill_requests WHERE item_id=$1`, w.item).Scan(&n); err != nil || n != 1 {
		t.Fatalf("refill rows: %d %v", n, err)
	}
	must(t, w.tx, `UPDATE health_prescriptions SET refills_used = refills_authorized WHERE id=$1`, w.rx)
	if code := w.call(t, w.h.RequestRefill, "POST", "/m/:id/refill", "/m/"+w.item+"/refill", w.owner, "{}", nil); code != http.StatusConflict {
		t.Fatalf("refill with none remaining: %d", code)
	}

	// send-to-pharmacy: a dispensed rx is returned as-is (idempotent), a stranger gets 404
	if code := w.call(t, w.h.SendToPharmacy, "POST", "/p/:id/send", "/p/"+w.rx+"/send", w.stranger, "{}", nil); code != http.StatusNotFound {
		t.Fatalf("send IDOR: %d", code)
	}
	var sent wirePrescription
	if code := w.call(t, w.h.SendToPharmacy, "POST", "/p/:id/send", "/p/"+w.rx+"/send", w.owner, "{}", &sent); code != 200 || sent.Status != "DISPENSED" {
		t.Fatalf("send on a dispensed rx: %d %+v", code, sent)
	}
	// an ISSUED rx with no pharmacy available is refused plainly
	issued := uuid.NewString()
	must(t, w.tx, `INSERT INTO health_prescriptions (id, consult_id, prescriber_id, patient_id, state) VALUES ($1,$2,$3,$4,'ISSUED')`, issued, w.consult, w.vetUser, w.owner)
	must(t, w.tx, `UPDATE health_providers SET discoverable=false WHERE domain='PHARMACY'`)
	if code := w.call(t, w.h.SendToPharmacy, "POST", "/p/:id/send", "/p/"+issued+"/send", w.owner, "{}", nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("send with no pharmacy: %d", code)
	}
	// (the success path runs the rx engine on its own connection pool, so it cannot see this
	// uncommitted transaction; the engine's own tests cover ISSUED → SENT_TO_PHARMACY.)

	// emergency vets: only in-person vets, distance-sorted when coordinates are given
	var em []wireEmergencyVet
	if code := w.call(t, w.h.EmergencyVets, "GET", "/e", "/e?lat=6.5&lng=3.4", w.owner, "", &em); code != 200 {
		t.Fatalf("emergency: %d", code)
	}
	var mine *wireEmergencyVet
	for i := range em {
		if em[i].ID == w.provider {
			mine = &em[i]
		}
	}
	if mine == nil || mine.Address != "5 Bode St, Lagos" || mine.Lat < 6.4 || mine.DistanceLabel == "" {
		t.Fatalf("emergency entry: %+v (all=%+v)", mine, em)
	}
	must(t, w.tx, `UPDATE vet_services SET visit_type='TELE' WHERE provider_id=$1`, w.provider)
	var teleOnly []wireEmergencyVet
	if code := w.call(t, w.h.EmergencyVets, "GET", "/e", "/e", w.owner, "", &teleOnly); code != 200 {
		t.Fatal(code)
	}
	for _, v := range teleOnly {
		if v.ID == w.provider {
			t.Fatal("a tele-only vet must not be offered for emergencies (HL-11)")
		}
	}
}
