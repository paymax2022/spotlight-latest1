package support

// LIVE-DB coverage for the support/safety admin surface. Skipped unless
// TEST_DATABASE_URL is set. The whole scenario runs inside ONE outer transaction
// that is always rolled back (the store opens savepoints on it), so it leaves no
// rows behind and never touches shared data.

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fixture struct {
	t                                   *testing.T
	ctx                                 context.Context
	tx                                  pgx.Tx
	st                                  *Store
	doctor, admin, other                string
	ticket, dispute, call, safety, kase string
	esc                                 string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping support admin live-DB tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	f := &fixture{t: t, ctx: ctx, tx: tx, st: NewStoreOn(tx),
		doctor: uuid.NewString(), admin: uuid.NewString(), other: uuid.NewString(),
		ticket: uuid.NewString(), dispute: uuid.NewString(), call: uuid.NewString(),
		safety: uuid.NewString(), kase: uuid.NewString(), esc: uuid.NewString()}
	f.exec(`INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2),($3::uuid,$4),($5::uuid,$6)`,
		f.doctor, f.doctor+"@seed.test", f.admin, f.admin+"@seed.test", f.other, f.other+"@seed.test")
	f.exec(`INSERT INTO doctors (user_id,name,specialty,consult_fee_kobo) VALUES ($1::uuid,'Dr Live Fixture','general',100000)`, f.doctor)
	f.exec(`INSERT INTO doctor_support_tickets (id,user_id,ref,subject,category,status,last_reply) VALUES ($1::uuid,$2::uuid,'TKT-live','Audio fails','technical','open','first')`, f.ticket, f.doctor)
	f.exec(`INSERT INTO doctor_support_messages (user_id,thread_id,author,body,idempotency_key) VALUES ($1::uuid,$2,'doctor','hello',$3)`, f.doctor, f.ticket, uuid.NewString())
	f.exec(`INSERT INTO doctor_support_disputes (id,user_id,status,subject,detail,evidence) VALUES ($1::uuid,$2::uuid,'open','Fee dispute','{"patientName":"Ada","amount":5}','[{"k":1}]')`, f.dispute, f.doctor)
	f.exec(`INSERT INTO doctor_call_disputes (id,user_id,status,reason,detail) VALUES ($1::uuid,$2::uuid,'open','Dropped call','{}')`, f.call, f.doctor)
	f.exec(`INSERT INTO doctor_safety_issues (id,user_id,severity,status,subject,detail) VALUES ($1::uuid,$2::uuid,'critical','open','Wrong dose','{}')`, f.safety, f.doctor)
	f.exec(`INSERT INTO doctor_emergency_cases (id,user_id,patient_id,status,summary,detail) VALUES ($1::uuid,$2::uuid,'PAT-0012345678','open','Chest pain','{"redFlags":["x"],"patientPhone":"0803"}')`, f.kase, f.doctor)
	f.exec(`INSERT INTO doctor_emergency_escalations (id,user_id,patient_id,escalation_type,status,detail) VALUES ($1::uuid,$2::uuid,'PAT-0012345678','ambulance','initiated','{}')`, f.esc, f.doctor)
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("fixture sql failed: %v\n%s", err, sql)
	}
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("count: %v\n%s", err, sql)
	}
	return n
}

func TestLiveDB_ListFiltersAndMasking(t *testing.T) {
	f := newFixture(t)
	items, total, err := f.st.List(f.ctx, KindCase, ListQuery{Limit: 25}, f.admin)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var found *Item
	for i := range items {
		if items[i].ID == f.kase {
			found = &items[i]
		}
	}
	if found == nil || total < 1 {
		t.Fatalf("seeded case missing from list (total %d)", total)
	}
	if found.DoctorName != "Dr Live Fixture" || found.Status != "open" || found.Subject != "Chest pain" {
		t.Errorf("row = %+v", found)
	}
	if strings.Contains(found.PatientRef, "0012345678") || found.PatientRef == "" {
		t.Errorf("patient ref not masked: %q", found.PatientRef)
	}

	got, _, _ := f.st.List(f.ctx, KindSafety, ListQuery{Severity: "critical", Q: "wrong dose", Limit: 25}, f.admin)
	if len(got) != 1 || got[0].ID != f.safety || got[0].Severity != "critical" {
		t.Errorf("severity+search filter = %+v", got)
	}
	if low, _, _ := f.st.List(f.ctx, KindSafety, ListQuery{Severity: "low", Q: "wrong dose", Limit: 25}, f.admin); len(low) != 0 {
		t.Errorf("low severity must not match, got %d", len(low))
	}
	if wild, _, _ := f.st.List(f.ctx, KindTicket, ListQuery{Q: "%", Limit: 25}, f.admin); len(wild) != 0 {
		t.Errorf("a literal %% must not act as a wildcard, got %d rows", len(wild))
	}
	byDoctor, _, _ := f.st.List(f.ctx, KindTicket, ListQuery{Q: "live fixture", Limit: 25}, f.admin)
	if len(byDoctor) != 1 {
		t.Errorf("search by doctor name = %d rows", len(byDoctor))
	}
}

func TestLiveDB_TicketLifecycle(t *testing.T) {
	f := newFixture(t)

	// Reply: auto-moves open -> in_progress, notifies, audits, last_reply updated.
	d, err := f.st.Reply(f.ctx, KindTicket, f.ticket, f.admin, "We are looking into it", "key-1")
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if d.Status != "in_progress" || d.Body != "We are looking into it" {
		t.Errorf("after reply status=%s body=%q", d.Status, d.Body)
	}
	last := d.Messages[len(d.Messages)-1]
	if last.Author != "agent" || len(d.Messages) != 2 {
		t.Errorf("thread = %+v", d.Messages)
	}
	if f.count(`SELECT count(*) FROM doctor_notifications WHERE user_id=$1::uuid AND notif_type='support_response'`, f.doctor) != 1 {
		t.Error("doctor was not notified of the reply")
	}

	// Replaying the same Idempotency-Key changes nothing.
	again, err := f.st.Reply(f.ctx, KindTicket, f.ticket, f.admin, "We are looking into it", "key-1")
	if err != nil || len(again.Messages) != 2 {
		t.Fatalf("replay must be a no-op: err=%v messages=%d", err, len(again.Messages))
	}
	if f.count(`SELECT count(*) FROM doctor_notifications WHERE user_id=$1::uuid`, f.doctor) != 1 {
		t.Error("replay duplicated the notification")
	}

	// Illegal transition is refused and writes nothing.
	auditBefore := f.count(`SELECT count(*) FROM doctor_compliance_audit WHERE entity_id=$1`, f.ticket)
	if _, err := f.st.SetStatus(f.ctx, KindTicket, f.ticket, f.admin, "open", ""); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("in_progress -> open must be refused, got %v", err)
	}
	if f.count(`SELECT count(*) FROM doctor_compliance_audit WHERE entity_id=$1`, f.ticket) != auditBefore {
		t.Error("refused transition still wrote an audit row")
	}

	// Resolve with a note: note lands in the thread and as last_reply.
	d, err = f.st.SetStatus(f.ctx, KindTicket, f.ticket, f.admin, "resolved", "Fixed in the latest build")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if d.Status != "resolved" || d.Body != "Fixed in the latest build" || len(d.Messages) != 3 {
		t.Errorf("resolved ticket = status %s body %q messages %d", d.Status, d.Body, len(d.Messages))
	}
	if len(d.AllowedStatuses) != 2 || d.AllowedStatuses[0] != "closed" || d.AllowedStatuses[1] != "open" {
		t.Errorf("allowed after resolve = %v", d.AllowedStatuses)
	}

	// Close is terminal: no further reply, no further transition.
	if _, err := f.st.SetStatus(f.ctx, KindTicket, f.ticket, f.admin, "closed", ""); err != nil {
		t.Fatalf("close: %v", err)
	}
	if _, err := f.st.Reply(f.ctx, KindTicket, f.ticket, f.admin, "too late", ""); !errors.Is(err, ErrClosed) {
		t.Errorf("reply on closed ticket = %v, want ErrClosed", err)
	}
	if _, err := f.st.SetStatus(f.ctx, KindTicket, f.ticket, f.admin, "open", ""); !errors.Is(err, ErrInvalidTransition) {
		t.Errorf("closed -> open = %v, want ErrInvalidTransition", err)
	}

	// History carries every admin action, newest first, and the doctor owns the rows.
	hist := f.mustGet(KindTicket, f.ticket).History
	if len(hist) != 3 || hist[0].Action != "admin.status" || hist[0].To != "closed" || hist[0].AdminID != f.admin {
		t.Errorf("history = %+v", hist)
	}
	if n := f.count(`SELECT count(*) FROM doctor_compliance_audit WHERE entity_type='support_ticket' AND entity_id=$1 AND user_id=$2::uuid`, f.ticket, f.doctor); n != 3 {
		t.Errorf("audit rows owned by doctor = %d, want 3", n)
	}
}

func (f *fixture) mustGet(kind Kind, id string) *ItemDetail {
	f.t.Helper()
	d, err := f.st.Get(f.ctx, kind, id)
	if err != nil {
		f.t.Fatalf("get %s: %v", kind, err)
	}
	return d
}

func TestLiveDB_DisputesAndCallDisputes(t *testing.T) {
	f := newFixture(t)

	d := f.mustGet(KindDispute, f.dispute)
	if _, leaked := d.Detail["patientName"]; leaked || d.Detail["amount"] == nil || len(d.Evidence) != 1 {
		t.Errorf("dispute detail not scrubbed/complete: %+v evidence=%v", d.Detail, d.Evidence)
	}
	d, err := f.st.Reply(f.ctx, KindDispute, f.dispute, f.admin, "Please send the receipt", "")
	if err != nil || d.Status != "under_review" {
		t.Fatalf("reply: status=%v err=%v", d.Status, err)
	}
	d, err = f.st.SetStatus(f.ctx, KindDispute, f.dispute, f.admin, "awaiting_response", "")
	if err != nil || d.Status != "awaiting_response" {
		t.Fatalf("awaiting_response: %v", err)
	}
	d, err = f.st.SetStatus(f.ctx, KindDispute, f.dispute, f.admin, "resolved", "Refunded")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	res, _ := d.Detail["admin_resolution"].(map[string]any)
	if res["note"] != "Refunded" || res["status"] != "resolved" {
		t.Errorf("resolution not recorded: %v", d.Detail)
	}
	if _, err := f.st.Reply(f.ctx, KindDispute, f.dispute, f.admin, "x", ""); !errors.Is(err, ErrClosed) {
		t.Errorf("reply on resolved dispute = %v", err)
	}

	// Call dispute has no thread/reply.
	if _, err := f.st.Reply(f.ctx, KindCall, f.call, f.admin, "x", ""); !errors.Is(err, ErrValidation) {
		t.Errorf("call-dispute reply = %v, want ErrValidation", err)
	}
	if _, err := f.st.SetStatus(f.ctx, KindCall, f.call, f.admin, "awaiting_response", ""); !errors.Is(err, ErrValidation) {
		t.Errorf("foreign status = %v, want ErrValidation", err)
	}
	cd, err := f.st.SetStatus(f.ctx, KindCall, f.call, f.admin, "rejected", "No fault found")
	if err != nil || cd.Status != "rejected" || cd.Body != "Dropped call" {
		t.Fatalf("reject call dispute: %+v err=%v", cd, err)
	}
}

func TestLiveDB_SafetyAndEmergency(t *testing.T) {
	f := newFixture(t)

	s, err := f.st.SetStatus(f.ctx, KindSafety, f.safety, f.admin, "investigating", "")
	if err != nil || s.Status != "investigating" {
		t.Fatalf("investigating: %v", err)
	}
	if _, err := f.st.SetStatus(f.ctx, KindSafety, f.safety, f.admin, "acknowledged", ""); !errors.Is(err, ErrInvalidTransition) {
		t.Errorf("investigating -> acknowledged = %v", err)
	}
	if f.count(`SELECT count(*) FROM doctor_notifications WHERE user_id=$1::uuid AND notif_type='compliance'`, f.doctor) != 1 {
		t.Error("safety status change did not notify the doctor")
	}

	c := f.mustGet(KindCase, f.kase)
	if _, leaked := c.Detail["patientPhone"]; leaked || c.Detail["redFlags"] == nil {
		t.Errorf("case detail = %v", c.Detail)
	}
	if len(c.Escalations) != 1 || c.Escalations[0].ID != f.esc || strings.Contains(c.Escalations[0].PatientRef, "0012345678") {
		t.Errorf("case escalations = %+v", c.Escalations)
	}
	if _, err := f.st.SetStatus(f.ctx, KindCase, f.kase, f.admin, "resolved", "Patient transferred"); err != nil {
		t.Fatalf("resolve case: %v", err)
	}

	e, err := f.st.SetStatus(f.ctx, KindEscalation, f.esc, f.admin, "notified", "")
	if err != nil || e.Status != "notified" {
		t.Fatalf("notify escalation: %v", err)
	}
	if _, err := f.st.SetStatus(f.ctx, KindEscalation, f.esc, f.admin, "initiated", ""); !errors.Is(err, ErrInvalidTransition) {
		t.Errorf("notified -> initiated = %v", err)
	}

	if _, err := f.st.Get(f.ctx, KindCase, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown id = %v, want ErrNotFound", err)
	}
	if _, err := f.st.SetStatus(f.ctx, KindCase, uuid.NewString(), f.admin, "resolved", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("status on unknown id = %v, want ErrNotFound", err)
	}
}

func TestLiveDB_AssignmentAndSummary(t *testing.T) {
	f := newFixture(t)

	d := f.mustGet(KindTicket, f.ticket)
	if d.AssigneeID != nil {
		t.Fatalf("fresh ticket must be unassigned, got %v", *d.AssigneeID)
	}
	d, err := f.st.Assign(f.ctx, KindTicket, f.ticket, f.admin, f.admin)
	if err != nil || d.AssigneeID == nil || *d.AssigneeID != f.admin {
		t.Fatalf("assign to self: %+v err=%v", d.AssigneeID, err)
	}
	mine, _, _ := f.st.List(f.ctx, KindTicket, ListQuery{Assigned: "me", Q: "audio", Limit: 25}, f.admin)
	if len(mine) != 1 {
		t.Errorf("assigned=me returned %d", len(mine))
	}
	if un, _, _ := f.st.List(f.ctx, KindTicket, ListQuery{Assigned: "unassigned", Q: "audio", Limit: 25}, f.admin); len(un) != 0 {
		t.Errorf("assigned ticket still listed as unassigned")
	}

	// Re-assigning to the same admin is a no-op (no extra audit row).
	before := f.count(`SELECT count(*) FROM doctor_compliance_audit WHERE entity_id=$1 AND action='admin.assign'`, f.ticket)
	if _, err := f.st.Assign(f.ctx, KindTicket, f.ticket, f.admin, f.admin); err != nil {
		t.Fatalf("idempotent assign: %v", err)
	}
	if f.count(`SELECT count(*) FROM doctor_compliance_audit WHERE entity_id=$1 AND action='admin.assign'`, f.ticket) != before {
		t.Error("same-assignee assign wrote an audit row")
	}

	// Hand over, then clear.
	d, err = f.st.Assign(f.ctx, KindTicket, f.ticket, f.admin, f.other)
	if err != nil || *d.AssigneeID != f.other {
		t.Fatalf("reassign: %v", err)
	}
	d, err = f.st.Assign(f.ctx, KindTicket, f.ticket, f.admin, "")
	if err != nil || d.AssigneeID != nil {
		t.Fatalf("unassign: %+v err=%v", d.AssigneeID, err)
	}
	if _, err := f.st.Assign(f.ctx, KindTicket, f.ticket, f.admin, uuid.NewString()); !errors.Is(err, ErrValidation) {
		t.Errorf("unknown assignee = %v, want ErrValidation", err)
	}
	if f.count(`SELECT count(*) FROM doctor_notifications WHERE user_id=$1::uuid`, f.doctor) != 0 {
		t.Error("assignment must not notify the doctor")
	}

	sum, err := f.st.Summary(f.ctx)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	for _, k := range []Kind{KindTicket, KindDispute, KindCall, KindSafety, KindCase, KindEscalation} {
		ks, ok := sum[string(k)]
		if !ok || ks.Total < 1 || ks.UnassignedOpen < 1 {
			t.Errorf("summary[%s] = %+v", k, ks)
		}
	}
}

func TestLiveDB_Facilities(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO doctor_emergency_facilities (user_id,name,facility_type,location) VALUES ($1::uuid,'Live Fixture General','hospital','{"city":"Lagos"}')`, f.doctor)
	got, err := f.st.Facilities(f.ctx, "live fixture", 10, 0)
	if err != nil || len(got) != 1 || got[0].Name != "Live Fixture General" || got[0].Location["city"] != "Lagos" {
		t.Fatalf("facilities = %+v err=%v", got, err)
	}
}
