package reviews

// Live-DB coverage for review moderation. Skipped unless TEST_DATABASE_URL is
// set. The whole scenario runs inside ONE outer transaction that is rolled back
// at the end (the store accepts a pgx.Tx and opens savepoints), so nothing is
// left behind in the target database.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fixture struct {
	admin, doctorUser, patient string
	doctorID                   string
	tmGood, tmBad              string // telemedicine reviews (5 and 1 stars)
	drLow, drOther             string // doctor_module reviews
	dispUphold, dispReject     string
}

func must(t *testing.T, err error, what string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
}

func seed(t *testing.T, ctx context.Context, tx pgx.Tx) fixture {
	t.Helper()
	f := fixture{
		admin: uuid.NewString(), doctorUser: uuid.NewString(), patient: uuid.NewString(),
		doctorID: uuid.NewString(), tmGood: uuid.NewString(), tmBad: uuid.NewString(),
		drLow: uuid.NewString(), drOther: uuid.NewString(),
		dispUphold: uuid.NewString(), dispReject: uuid.NewString(),
	}
	for _, u := range []string{f.admin, f.doctorUser, f.patient} {
		_, err := tx.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, u, u+"@reviews-seed.test")
		must(t, err, "seed user")
	}
	_, err := tx.Exec(ctx, `INSERT INTO doctors (id, user_id, name, consult_fee_kobo) VALUES ($1::uuid, $2::uuid, 'Dr Moderated', 500000)`,
		f.doctorID, f.doctorUser)
	must(t, err, "seed doctor")
	for i, tm := range []struct {
		id     string
		rating int
	}{{f.tmGood, 5}, {f.tmBad, 1}} {
		appt := uuid.NewString()
		_, err = tx.Exec(ctx, `
			INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, status, fee_kobo, idempotency_key)
			VALUES ($1::uuid, $2::uuid, $3::uuid, now(), 'completed', 500000, $4)`,
			appt, f.patient, f.doctorID, "reviews-seed-"+appt)
		must(t, err, "seed appointment")
		_, err = tx.Exec(ctx, `
			INSERT INTO telemedicine_reviews (id, appointment_id, doctor_id, patient_id, rating, comment)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)`,
			tm.id, appt, f.doctorID, f.patient, tm.rating, []string{"Great doctor", "Rude and late"}[i])
		must(t, err, "seed telemedicine review")
	}
	// The doctor's projection as AddReview would have left it: avg(5,1)=3.00, 2 reviews.
	_, err = tx.Exec(ctx, `UPDATE doctors SET rating = 3.00, review_count = 2 WHERE id = $1::uuid`, f.doctorID)
	must(t, err, "seed projection")

	_, err = tx.Exec(ctx, `
		INSERT INTO doctor_reviews (id, user_id, rating, body) VALUES
		  ($1::uuid, $3::uuid, 2, 'Slow to respond'), ($2::uuid, $3::uuid, 5, 'Helpful')`, f.drLow, f.drOther, f.doctorUser)
	must(t, err, "seed doctor reviews")
	_, err = tx.Exec(ctx, `
		INSERT INTO doctor_review_disputes (id, user_id, review_id, kind, reason, idempotency_key) VALUES
		  ($1::uuid, $3::uuid, $4::uuid, 'dispute', 'Patient never attended', $5),
		  ($2::uuid, $3::uuid, $6::uuid, 'report', 'Looks fine to me', $7)`,
		f.dispUphold, f.dispReject, f.doctorUser, f.drLow, "k1-"+f.dispUphold, f.drOther, "k2-"+f.dispReject)
	must(t, err, "seed disputes")
	return f
}

func projection(t *testing.T, ctx context.Context, tx pgx.Tx, doctorID string) (float64, int) {
	t.Helper()
	var r float64
	var n int
	must(t, tx.QueryRow(ctx, `SELECT rating::float8, review_count FROM doctors WHERE id=$1::uuid`, doctorID).Scan(&r, &n), "projection")
	return r, n
}

func auditCount(t *testing.T, ctx context.Context, tx pgx.Tx, entityID, action string) int {
	t.Helper()
	var n int
	must(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_compliance_audit WHERE entity_id=$1 AND action=$2`, entityID, action).Scan(&n), "audit count")
	return n
}

func TestLiveDB_ReviewModeration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping review moderation live-DB test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	must(t, err, "pool")
	defer pool.Close()

	tx, err := pool.Begin(ctx)
	must(t, err, "begin outer tx")
	defer func() { _ = tx.Rollback(context.Background()) }()

	f := seed(t, ctx, tx)
	st := newStore(tx)

	t.Run("list unifies both sources and filters", func(t *testing.T) {
		rows, total, err := st.ListReviews(ctx, ListFilter{DoctorID: f.doctorID})
		must(t, err, "list")
		if total != 4 || len(rows) != 4 {
			t.Fatalf("doctor has 4 reviews across sources, got total=%d len=%d", total, len(rows))
		}
		for _, r := range rows {
			if r.Source == SourceTelemedicine && (len(r.PatientRef) == 0 || r.PatientRef == f.patient) {
				t.Fatalf("patient not masked: %q", r.PatientRef)
			}
		}
		rows, _, err = st.ListReviews(ctx, ListFilter{DoctorID: f.doctorID, Source: SourceDoctorModule, Rating: 2})
		must(t, err, "list filtered")
		if len(rows) != 1 || rows[0].ID != f.drLow || rows[0].OpenDisputes != 1 {
			t.Fatalf("filter mismatch: %+v", rows)
		}
		rows, _, err = st.ListReviews(ctx, ListFilter{DoctorID: f.doctorID, Query: "rude"})
		must(t, err, "list search")
		if len(rows) != 1 || rows[0].ID != f.tmBad {
			t.Fatalf("search mismatch: %+v", rows)
		}
		hidden := true
		rows, _, err = st.ListReviews(ctx, ListFilter{DoctorID: f.doctorID, Hidden: &hidden})
		must(t, err, "list hidden")
		if len(rows) != 0 {
			t.Fatalf("nothing is hidden yet: %+v", rows)
		}
	})

	t.Run("hide telemedicine review refreshes the rating projection, idempotently", func(t *testing.T) {
		before, err := st.Summary(ctx)
		must(t, err, "summary")
		rv, err := st.SetHidden(ctx, f.admin, SourceTelemedicine, f.tmBad, true, "abusive language")
		must(t, err, "hide")
		if !rv.Hidden {
			t.Fatal("review not hidden")
		}
		if r, n := projection(t, ctx, tx, f.doctorID); r != 5.00 || n != 1 {
			t.Fatalf("projection after hide = %v/%d, want 5.00/1", r, n)
		}
		if _, err := st.SetHidden(ctx, f.admin, SourceTelemedicine, f.tmBad, true, "abusive language"); err != nil {
			t.Fatalf("replay: %v", err)
		}
		if n := auditCount(t, ctx, tx, f.tmBad, "telemedicine.admin.review.hidden"); n != 1 {
			t.Fatalf("replay wrote %d audit rows, want exactly 1", n)
		}
		after, err := st.Summary(ctx)
		must(t, err, "summary after")
		if after.HiddenReviews != before.HiddenReviews+1 || after.LowRatedVisible != before.LowRatedVisible-1 {
			t.Fatalf("summary not updated: before=%+v after=%+v", before, after)
		}

		if _, err := st.SetHidden(ctx, f.admin, SourceTelemedicine, f.tmBad, false, "reviewed again, acceptable"); err != nil {
			t.Fatalf("unhide: %v", err)
		}
		if r, n := projection(t, ctx, tx, f.doctorID); r != 3.00 || n != 2 {
			t.Fatalf("projection after unhide = %v/%d, want 3.00/2", r, n)
		}
		d, err := st.GetReview(ctx, SourceTelemedicine, f.tmBad)
		must(t, err, "get review")
		// Both rows share the outer test transaction's now(), so order is undefined here.
		actions := map[string]string{}
		for _, h := range d.History {
			actions[h.Action] = h.Reason
		}
		if len(d.History) != 2 || actions["telemedicine.admin.review.hidden"] != "abusive language" ||
			actions["telemedicine.admin.review.unhidden"] != "reviewed again, acceptable" {
			t.Fatalf("history = %+v", d.History)
		}
	})

	t.Run("a doctor cannot moderate reviews about themselves", func(t *testing.T) {
		if _, err := st.SetHidden(ctx, f.doctorUser, SourceTelemedicine, f.tmBad, true, "hiding my own bad review"); !errors.Is(err, ErrSelfModeration) {
			t.Fatalf("got %v, want ErrSelfModeration", err)
		}
		if _, err := st.Resolve(ctx, f.doctorUser, f.dispUphold, StatusUpheld, "approving my own dispute"); !errors.Is(err, ErrSelfModeration) {
			t.Fatalf("resolve got %v, want ErrSelfModeration", err)
		}
	})

	t.Run("unknown review is not found", func(t *testing.T) {
		if _, err := st.SetHidden(ctx, f.admin, SourceTelemedicine, uuid.NewString(), true, "no such review"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("got %v", err)
		}
		if _, err := st.GetReview(ctx, SourceDoctorModule, uuid.NewString()); !errors.Is(err, ErrNotFound) {
			t.Fatalf("get got %v", err)
		}
		if _, err := st.GetDispute(ctx, uuid.NewString()); !errors.Is(err, ErrNotFound) {
			t.Fatalf("dispute got %v", err)
		}
	})

	t.Run("dispute queue lists open first and resolves with the state machine", func(t *testing.T) {
		rows, total, err := st.ListDisputes(ctx, DisputeFilter{Status: StatusOpen})
		must(t, err, "list disputes")
		if total < 2 || len(rows) < 2 {
			t.Fatalf("expected at least our 2 open disputes, got %d", total)
		}

		got, err := st.Resolve(ctx, f.admin, f.dispUphold, StatusUpheld, "patient never booked a consultation")
		must(t, err, "resolve upheld")
		if got.Status != StatusUpheld || got.ResolutionReason == nil || got.ResolvedAt == nil {
			t.Fatalf("resolved dispute = %+v", got)
		}
		rv, err := st.GetReview(ctx, SourceDoctorModule, f.drLow)
		must(t, err, "review after uphold")
		if !rv.Hidden || rv.HiddenReason == nil || rv.OpenDisputes != 0 {
			t.Fatalf("upholding must hide the review in the same transaction: %+v", rv.Review)
		}
		if n := auditCount(t, ctx, tx, f.drLow, "telemedicine.admin.review.hidden"); n != 1 {
			t.Fatalf("hide audit rows = %d", n)
		}
		if n := auditCount(t, ctx, tx, f.dispUphold, "telemedicine.admin.review_dispute.upheld"); n != 1 {
			t.Fatalf("dispute audit rows = %d", n)
		}

		if _, err := st.Resolve(ctx, f.admin, f.dispUphold, StatusUpheld, "same decision again"); err != nil {
			t.Fatalf("idempotent replay: %v", err)
		}
		if n := auditCount(t, ctx, tx, f.dispUphold, "telemedicine.admin.review_dispute.upheld"); n != 1 {
			t.Fatalf("replay duplicated the audit row (%d)", n)
		}
		if _, err := st.Resolve(ctx, f.admin, f.dispUphold, StatusRejected, "changing my mind"); !errors.Is(err, ErrConflict) {
			t.Fatalf("flip of a resolved dispute got %v, want ErrConflict", err)
		}

		rej, err := st.Resolve(ctx, f.admin, f.dispReject, StatusRejected, "review is genuine, keep it")
		must(t, err, "resolve rejected")
		if rej.Status != StatusRejected {
			t.Fatalf("status = %s", rej.Status)
		}
		rv2, err := st.GetReview(ctx, SourceDoctorModule, f.drOther)
		must(t, err, "review after reject")
		if rv2.Hidden {
			t.Fatal("rejecting a dispute must leave the review visible")
		}

		det, err := st.GetDispute(ctx, f.dispUphold)
		must(t, err, "get dispute")
		if det.Review == nil || det.Review.ID != f.drLow || !det.Review.Hidden {
			t.Fatalf("dispute detail review = %+v", det.Review)
		}
		closed, _, err := st.ListDisputes(ctx, DisputeFilter{Status: StatusUpheld})
		must(t, err, "list upheld")
		found := false
		for _, d := range closed {
			found = found || d.ID == f.dispUphold
		}
		if !found {
			t.Fatal("upheld dispute missing from the upheld filter")
		}
	})

	t.Run("invalid decision never touches the database", func(t *testing.T) {
		if _, err := st.Resolve(ctx, f.admin, f.dispUphold, "maybe", "whatever reason"); !errors.Is(err, ErrValidation) {
			t.Fatalf("got %v", err)
		}
	})
}
