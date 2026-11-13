package doctor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// appointments_plane_live_db_test.go — the doctor portal's appointment plane.
//
// A patient booking writes exactly ONE row, into public.appointments (see
// internal/telemedicine/service.go). The doctor screens read
// doctor_appointments / doctor_appointment_requests, and nothing in this repo
// ever inserts into either table, so the portal could not show a real booking
// however many were made — an appointment stuck on "Awaiting doctor
// confirmation" with an empty doctor inbox, forever.
//
// These tests pin the three reads and the accept/reject write-back onto the
// table the booking actually lands in. They assert the JSON the react-native
// screens parse (`${slotDate}T00:00:00`, ConsultStatus vocabulary, the nested
// request.appointment) rather than Go field types, because that wire contract —
// not the struct — is what broke.
//
// Runs only with TEST_DATABASE_URL set; owns and removes its fixture.

const lagosSlot = "2026-11-14T11:00:00Z" // 12:00 PM Africa/Lagos, the doctor's timezone

type apptFixture struct {
	doctorUser  string
	doctorID    string
	patientUser string
	apptID      string
}

func newAppointmentFixture(t *testing.T, scheduledAt string) apptFixture {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)

	f := apptFixture{
		doctorUser:  uuid.NewString(),
		doctorID:    uuid.NewString(),
		patientUser: uuid.NewString(),
		apptID:      uuid.NewString(),
	}

	// auth.users' handle_new_user trigger derives user_profiles from
	// raw_user_meta_data, so the profile row — and the patient's name — must be
	// seeded through the insert, not alongside it.
	seed := []struct {
		q    string
		args []any
	}{
		{`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1,$2,$3)`,
			[]any{f.doctorUser, f.doctorUser + "@apptplane.invalid",
				map[string]any{"full_name": "Doctor A Abiaka", "role": "doctor"}}},
		{`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1,$2,$3)`,
			[]any{f.patientUser, f.patientUser + "@apptplane.invalid",
				map[string]any{"full_name": "Chidi Okeke", "role": "patient"}}},
		{`INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo) VALUES ($1,$2,$3,$4,$5)`,
			[]any{f.doctorID, f.doctorUser, "Doctor A Abiaka", "general", 200000}},
		{`INSERT INTO doctor_availability (user_id, timezone) VALUES ($1,$2)`,
			[]any{f.doctorUser, "Africa/Lagos"}},
		{`INSERT INTO appointments
		     (id, patient_id, doctor_id, doctor_name, consultation_type,
		      scheduled_at, status, notes, fee_kobo, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,'booked',$7,$8,$9)`,
			[]any{f.apptID, f.patientUser, f.doctorID, "Doctor A Abiaka", "video",
				scheduledAt, "Recurring abdominal pain", 200000, "idem_" + f.apptID}},
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx, s.q, s.args...); err != nil {
			t.Fatalf("seed %q: %v", truncate(s.q), err)
		}
	}

	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		clean := []string{
			`DELETE FROM appointments WHERE id=$1`,
			`DELETE FROM doctors WHERE id=$1`,
			`DELETE FROM auth.users WHERE id=$1`,
			`DELETE FROM auth.users WHERE id=$1`,
		}
		ids := []string{f.apptID, f.doctorID, f.doctorUser, f.patientUser}
		for i, q := range clean {
			if _, err := pool.Exec(cctx, q, ids[i]); err != nil {
				t.Logf("cleanup %q: %v", truncate(q), err)
			}
		}
	})
	return f
}

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping appointment-plane live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func truncate(q string) string {
	q = strings.Join(strings.Fields(q), " ")
	if len(q) > 60 {
		return q[:60]
	}
	return q
}

// wire marshals a returned DTO the way the HTTP handler would emit it, so the
// assertions test the contract the screens parse instead of Go's field types.
func wire(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func field(t *testing.T, obj map[string]any, key string) string {
	t.Helper()
	v, ok := obj[key]
	if !ok || v == nil {
		t.Fatalf("%s is absent — screens do `new Date(`${%s}T00:00:00`)`, so it must be present", key, key)
	}
	s, ok := v.(string)
	if !ok {
		t.Fatalf("%s = %#v (%T), want a string", key, v, v)
	}
	return s
}

func apptStatus(t *testing.T, obj map[string]any) string {
	t.Helper()
	return field(t, obj, "status")
}

// TestListAppointments_SeesTheTelemedicineBooking is the reported bug: the
// booking exists in `appointments` and the doctor's tab showed "No
// appointments".
func TestListAppointments_SeesTheTelemedicineBooking(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()

	got, err := NewRepository(livePool(t)).ListAppointments(ctx, f.doctorUser, "")
	if err != nil {
		t.Fatalf("ListAppointments: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want the one booked appointment visible to its doctor", len(got))
	}

	w := wire(t, got[0])
	if id := field(t, w, "id"); id != f.apptID {
		t.Errorf("id = %s, want %s", id, f.apptID)
	}
	// `booked` is the UI's `upcoming` (ConsultStatus has no `booked`).
	if s := apptStatus(t, w); s != "upcoming" {
		t.Errorf("status = %q, want %q — the tab's Upcoming filter and the status badge key off it", s, "upcoming")
	}
	// A full timestamp here makes `new Date(`${slotDate}T00:00:00`)` Invalid Date.
	if d := field(t, w, "slotDate"); d != "2026-11-14" {
		t.Errorf("slotDate = %q, want date-only %q", d, "2026-11-14")
	}
	if tm := field(t, w, "slotTime"); tm != "12:00 PM" {
		t.Errorf("slotTime = %q, want the doctor's local %q (Africa/Lagos) — the patient screen shows 12:00 PM", tm, "12:00 PM")
	}
	if ct := field(t, w, "consultType"); ct != "video" {
		t.Errorf("consultType = %q, want %q", ct, "video")
	}
	if fee, _ := w["feeKobo"].(float64); fee != 200000 {
		t.Errorf("feeKobo = %v, want 200000", w["feeKobo"])
	}
	if r := field(t, w, "reason"); r != "Recurring abdominal pain" {
		t.Errorf("reason = %q, want the booking notes", r)
	}
	// appointments.ref is NULL for bookings; the patient plane derives the
	// reference from the id, so the doctor must see the same one.
	wantRef := fmt.Sprintf("TM-%s", strings.ToUpper(f.apptID[:6]))
	if ref := field(t, w, "ref"); ref != wantRef {
		t.Errorf("ref = %q, want %q (same derivation as features/telemedicine/mapping.ts)", ref, wantRef)
	}

	patient, ok := w["patient"].(map[string]any)
	if !ok {
		t.Fatal("patient is absent — AppointmentRow dereferences appointment.patient.name")
	}
	if n, _ := patient["name"].(string); n != "Chidi Okeke" {
		t.Errorf("patient.name = %q, want the booking patient's profile name", n)
	}
	if pid, _ := patient["id"].(string); pid != f.patientUser {
		t.Errorf("patient.id = %q, want the booking patient's auth id %q — the chat and records links key off it", pid, f.patientUser)
	}
	// `initials` and `avatarColor` are deliberately NOT asserted here: they are
	// derived from RN theme tokens, so the server answering them would hardcode
	// brand hexes into an API. features/doctor/mapping.ts fills them, the same
	// way mapHeaderAvatar does for the profile header.
}

// TestListAppointments_FilterUsesUIVocabulary: the tab sends ?status=upcoming,
// so the server-side filter must translate that back onto `booked`.
func TestListAppointments_FilterUsesUIVocabulary(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	repo := NewRepository(livePool(t))
	ctx := context.Background()

	upcoming, err := repo.ListAppointments(ctx, f.doctorUser, "upcoming")
	if err != nil {
		t.Fatalf("ListAppointments(upcoming): %v", err)
	}
	if len(upcoming) != 1 {
		t.Errorf("status=upcoming returned %d rows, want the booked appointment", len(upcoming))
	}

	completed, err := repo.ListAppointments(ctx, f.doctorUser, "completed")
	if err != nil {
		t.Fatalf("ListAppointments(completed): %v", err)
	}
	if len(completed) != 0 {
		t.Errorf("status=completed returned %d rows, want none for a booked appointment", len(completed))
	}
}

func TestListAppointments_ScopesToTheOwningDoctor(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()

	otherUser := uuid.NewString()
	otherID := uuid.NewString()
	pool := livePool(t)
	defer func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM doctors WHERE id=$1`, otherID)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, otherUser)
	}()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		otherUser, otherUser+"@apptplane.invalid"); err != nil {
		t.Fatalf("seed other doctor: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo)
		VALUES ($1,$2,$3,$4,$5)`, otherID, otherUser, "Doctor B Other", "general", 200000); err != nil {
		t.Fatalf("seed other doctors row: %v", err)
	}

	own, err := NewRepository(pool).ListAppointments(ctx, f.doctorUser, "")
	if err != nil {
		t.Fatalf("ListAppointments(owner): %v", err)
	}
	if len(own) != 1 {
		t.Fatalf("the owning doctor saw %d rows, want 1 — without this the 0 below proves nothing", len(own))
	}

	got, err := NewRepository(pool).ListAppointments(ctx, otherUser, "")
	if err != nil {
		t.Fatalf("ListAppointments(other): %v", err)
	}
	if len(got) != 0 {
		t.Errorf("a second doctor was shown %d appointment(s), want 0 — PHI must not cross doctors", len(got))
	}
}

// TestListAppointments_NoDoctorRowIsEmptyNotError keeps the honest empty state:
// a signed-in non-doctor must get [] (the tab renders "No appointments"), not a
// 500 from a not-found lookup.
func TestListAppointments_NoDoctorRowIsEmptyNotError(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		user, user+"@aptdir.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id=$1`, user)
	})

	got, err := NewRepository(pool).ListAppointments(ctx, user, "")
	if err != nil {
		t.Fatalf("ListAppointments for a user with no doctors row = err %v, want no error", err)
	}
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

// TestAppointmentStatusCounts_PendingBadge: the dashboard reads
// counts.pending for its "Pending requests" tile (doctor.batch1.api.ts).
func TestAppointmentStatusCounts_PendingBadge(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()

	counts, err := NewRepository(livePool(t)).appointmentStatusCounts(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("appointmentStatusCounts: %v", err)
	}
	if counts["pending"] != 1 {
		t.Errorf("counts[pending] = %d, want 1 for the booked appointment (got %v)", counts["pending"], counts)
	}
}

// TestTransitionAppointment_AcceptConfirmsTheBooking is the other half of the
// bug: confirming must leave `appointments` in a state that ends the patient's
// "Awaiting doctor confirmation".
func TestTransitionAppointment_AcceptConfirmsTheBooking(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()
	pool := livePool(t)

	got, err := NewRepository(pool).TransitionAppointment(ctx, f.doctorUser, f.apptID, "confirmed", nil, nil)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if s := apptStatus(t, wire(t, got)); s != "confirmed" {
		t.Errorf("returned status = %q, want %q", s, "confirmed")
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, f.apptID).Scan(&status); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if status != "confirmed" {
		t.Errorf("appointments.status = %q, want %q — the patient screen only leaves 'Awaiting doctor confirmation' when this flips", status, "confirmed")
	}
}

func TestTransitionAppointment_RejectCancelsTheBooking(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()
	pool := livePool(t)

	if _, err := NewRepository(pool).TransitionAppointment(ctx, f.doctorUser, f.apptID, "cancelled", nil, nil); err != nil {
		t.Fatalf("reject: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, f.apptID).Scan(&status); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if status != "cancelled" {
		t.Errorf("appointments.status = %q, want %q", status, "cancelled")
	}
}

// TestTransitionAppointment_OtherDoctorCannotConfirm keeps the scoping tight
// while moving the write onto the shared table: a doctor may only decide their
// own bookings.
func TestTransitionAppointment_OtherDoctorCannotConfirm(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()
	pool := livePool(t)

	otherUser := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		otherUser, otherUser+"@apptscope.invalid"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id=$1`, otherUser)
	})

	if _, err := NewRepository(pool).TransitionAppointment(ctx, otherUser, f.apptID, "confirmed", nil, nil); err == nil {
		t.Fatal("a second doctor confirmed someone else's booking, want ErrNotFound")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, f.apptID).Scan(&status); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if status != "booked" {
		t.Errorf("appointments.status = %q after a foreign accept, want it untouched at %q", status, "booked")
	}
}

// appointments.status is CHECKed to booked|confirmed|completed|cancelled, so a
// consult that has started (`in_progress`) or a patient who never turned up
// (`no_show`) has no state to be written into. The handler used to answer these
// as a 404 off the empty shadow table; passed through they would fail on the
// CHECK and surface as an opaque 500. A refusal the client can say the reason
// for is the honest answer until those states live in the consult-session plane.
func TestTransitionAppointment_StatusWithNoBookingStateIsRefused(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()
	pool := livePool(t)

	for _, status := range []string{"in_progress", "no_show"} {
		_, err := NewRepository(pool).TransitionAppointment(ctx, f.doctorUser, f.apptID, status, nil, nil)
		if !errors.Is(err, ErrStatusUnsupported) {
			t.Errorf("TransitionAppointment(%q) = %v, want ErrStatusUnsupported", status, err)
		}
	}

	var after string
	if err := pool.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, f.apptID).Scan(&after); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if after != "booked" {
		t.Errorf("appointments.status = %q after a refused transition, want the booking untouched at %q", after, "booked")
	}
}

// A proposed slot is the same problem one column over: `appointments` has no
// requested_slot, and the row that used to hold it belongs to the table this
// plane no longer reads. Writing 'booked' and reporting a reschedule the
// patient will never see is the bug class this change exists to end.
func TestTransitionAppointment_ProposedSlotIsNotSilentlyDropped(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()
	pool := livePool(t)

	slot := "2026-11-20T10:00"
	if _, err := NewRepository(pool).TransitionAppointment(ctx, f.doctorUser, f.apptID, "upcoming", &slot, nil); !errors.Is(err, ErrStatusUnsupported) {
		t.Fatalf("reschedule = %v, want ErrStatusUnsupported — no column can record the proposal", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, f.apptID).Scan(&status); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if status != "booked" {
		t.Errorf("appointments.status = %q, want the booking left for the patient to decide", status)
	}
}

// The refusal must not reach the doctor as a 500 — Handler.fail is the one place
// service errors become HTTP statuses.
func TestFail_StatusUnsupportedIsABadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(nil)
	r := gin.New()
	r.GET("/probe", func(c *gin.Context) { h.fail(c, ErrStatusUnsupported) })

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/probe", nil))
	if w.Code != http.StatusBadRequest {
		t.Errorf("fail(ErrStatusUnsupported) = %d, want %d, body %s", w.Code, http.StatusBadRequest, w.Body.String())
	}
}

// TestListAppointmentRequests_PendingRequestCarriesTheAppointment: the inbox
// renders r.appointment.consultType / .patient.name / .slotDate and r.priority,
// so the request must carry the nested appointment rather than the flat fields
// — otherwise the first real row crashes the screen.
func TestListAppointmentRequests_PendingRequestCarriesTheAppointment(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	ctx := context.Background()

	got, err := NewRepository(livePool(t)).ListAppointmentRequests(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("ListAppointmentRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want the booked appointment awaiting a decision", len(got))
	}

	w := wire(t, got[0])
	if s := apptStatus(t, w); s != "pending" {
		t.Errorf("status = %q, want %q — the inbox keeps only r.status === 'pending'", s, "pending")
	}
	if id := field(t, w, "appointmentId"); id != f.apptID {
		t.Errorf("appointmentId = %s, want %s — accept posts to /appointments/{appointmentId}/accept", id, f.apptID)
	}
	nested, ok := w["appointment"].(map[string]any)
	if !ok {
		t.Fatal("appointment is absent — requests/index.tsx reads r.appointment.consultType and throws")
	}
	if ct := field(t, nested, "consultType"); ct != "video" {
		t.Errorf("appointment.consultType = %q, want %q", ct, "video")
	}
	if d := field(t, nested, "slotDate"); d != "2026-11-14" {
		t.Errorf("appointment.slotDate = %q, want date-only %q", d, "2026-11-14")
	}
	if p, ok := nested["patient"].(map[string]any); !ok {
		t.Error("appointment.patient is absent")
	} else if n, _ := p["name"].(string); n != "Chidi Okeke" {
		t.Errorf("appointment.patient.name = %q, want %q", n, "Chidi Okeke")
	}
	if pr := field(t, w, "priority"); pr != "normal" {
		t.Errorf("priority = %q, want %q — appointments has no triage column, so the inbox must not invent one", pr, "normal")
	}
	if note := field(t, w, "patientNote"); note != "Recurring abdominal pain" {
		t.Errorf("patientNote = %q, want the booking notes", note)
	}
	if _, ok := w["requestedAt"]; !ok {
		t.Error("requestedAt is absent — AppointmentRequest.requestedAt is required")
	}
	if b := field(t, w, "billing"); b != "paid" {
		t.Errorf("billing = %q, want %q — the booking escrowed a real payment", b, "paid")
	}
}
