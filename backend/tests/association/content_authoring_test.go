package association_test

// Regression tests for the content-authoring surface.
//
// Before it existed, assoc_announcements / meetings / documents / events /
// tasks / notifications / devices / dues_invoices all had READ endpoints and no
// writer anywhere in the repo. They were permanently empty, so every one of
// those screens rendered an empty state forever — and because nothing raised a
// dues invoice, the whole money path had nothing it could ever settle.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/association"
	"spotlight/backend/internal/finance/ledger"
)

// seedFounder creates a user who owns a fresh organisation, returning both ids.
// The founder is a SUPER_ADMIN of that org, so they can author content in it.
func seedFounder(t *testing.T, ctx context.Context, label string) (userID, orgID string, svc *association.Service, cleanup func()) {
	t.Helper()
	pool := liveDBPool(t)
	svc = newLiveAssociationService(pool)
	userID = uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@"+label+".test"); err != nil {
		pool.Close()
		t.Fatalf("seed auth.users: %v", err)
	}
	res, err := svc.PublishOrganisation(ctx, userID, newTestDraft(label+" "+uuid.New().String()[:8]))
	if err != nil {
		pool.Close()
		t.Fatalf("publish: %v", err)
	}
	return userID, res.OrganisationID, svc, pool.Close
}

func rfc3339In(d time.Duration) string { return time.Now().Add(d).UTC().Format(time.RFC3339) }

// TestAnnouncement_CreateReadAndNotify proves the announcement table is no
// longer orphaned and that the fan-out populates assoc_notifications, which had
// no writer of its own either.
func TestAnnouncement_CreateReadAndNotify(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "announce")
	defer done()

	id, err := svc.CreateAnnouncement(ctx, founder, orgID, association.AnnouncementRequest{
		Title: "AGM this Saturday", Urgent: true, RequiresAck: true, Notify: true,
	})
	if err != nil {
		t.Fatalf("create announcement: %v", err)
	}

	// The member-facing read must now return it (it always returned [] before).
	list, err := svc.GetAnnouncements(ctx, founder)
	if err != nil {
		t.Fatalf("get announcements: %v", err)
	}
	var found bool
	for _, a := range list {
		if a.ID == id {
			found = true
		}
	}
	if !found {
		t.Fatalf("created announcement %s not returned by GetAnnouncements (%d rows)", id, len(list))
	}

	// Fan-out reached the founder's own membership.
	notes, err := svc.GetNotifications(ctx, founder)
	if err != nil {
		t.Fatalf("get notifications: %v", err)
	}
	if len(notes) == 0 {
		t.Fatal("notify=true produced no notifications — assoc_notifications still has no writer")
	}

	if err := svc.DeleteAnnouncement(ctx, founder, id); err != nil {
		t.Fatalf("delete announcement: %v", err)
	}
}

// TestMeetingAndDocumentAndEvent_BecomeVisible covers the remaining orphan
// content tables in one pass: each read endpoint returned [] unconditionally.
func TestMeetingAndDocumentAndEvent_BecomeVisible(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "content")
	defer done()

	meetingID, err := svc.CreateMeeting(ctx, founder, orgID, association.MeetingRequest{
		Title: "Exco meeting", Mode: "VIRTUAL", StartsAt: rfc3339In(48 * time.Hour),
		Agenda: []string{"Apologies", "Treasurer's report"}, GenerateAttendanceCode: true,
	})
	if err != nil {
		t.Fatalf("create meeting: %v", err)
	}
	meetings, err := svc.GetMeetings(ctx, founder)
	if err != nil {
		t.Fatalf("get meetings: %v", err)
	}
	if len(meetings) == 0 {
		t.Fatal("GetMeetings still empty after creating a meeting")
	}

	docID, err := svc.CreateDocument(ctx, founder, orgID, association.DocumentRequest{
		Title: "Constitution", Category: "Governance", Kind: "pdf", RequiresAck: true,
	})
	if err != nil {
		t.Fatalf("create document: %v", err)
	}
	docs, err := svc.GetDocuments(ctx, founder)
	if err != nil {
		t.Fatalf("get documents: %v", err)
	}
	if len(docs) == 0 {
		t.Fatal("GetDocuments still empty after creating a document")
	}

	eventID, err := svc.CreateEvent(ctx, founder, orgID, association.EventRequest{
		Title: "Annual dinner", StartsAt: rfc3339In(72 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create event: %v", err)
	}
	events, err := svc.GetEvents(ctx, founder)
	if err != nil {
		t.Fatalf("get events: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("GetEvents still empty after creating an event")
	}

	// A free event still issues a ticket immediately.
	reg, err := svc.RegisterEvent(ctx, founder, eventID)
	if err != nil {
		t.Fatalf("register free event: %v", err)
	}
	if !reg.Registered || reg.TicketCode == nil {
		t.Fatalf("free event registration = %+v; want an immediate ticket", reg)
	}

	// Publishing minutes was unreachable: nothing could set minutes_published.
	if err := svc.PublishMinutes(ctx, founder, meetingID, true); err != nil {
		t.Fatalf("publish minutes: %v", err)
	}
	_ = docID
}

// TestCreateEvent_RejectsIncoherentPricing pins the guard against an event that
// is marked paid with no fee (which used to hand out free tickets silently).
func TestCreateEvent_RejectsIncoherentPricing(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "pricing")
	defer done()

	if _, err := svc.CreateEvent(ctx, founder, orgID, association.EventRequest{
		Title: "Paid but free", StartsAt: rfc3339In(time.Hour), Paid: true, FeeKobo: 0,
	}); err == nil {
		t.Fatal("a paid event with a zero fee was accepted")
	}
	if _, err := svc.CreateEvent(ctx, founder, orgID, association.EventRequest{
		Title: "Free but priced", StartsAt: rfc3339In(time.Hour), Paid: false, FeeKobo: 500000,
	}); err == nil {
		t.Fatal("a free event carrying a fee was accepted")
	}
}

// TestRegisterEvent_PaidEventRaisesInvoiceInsteadOfFreeTicket pins the money
// bug: assoc_events.paid/fee_kobo were rendered by three query paths but
// nothing ever charged them, so every paid event issued tickets for free.
func TestRegisterEvent_PaidEventRaisesInvoiceInsteadOfFreeTicket(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "paidevent")
	defer done()

	const feeKobo int64 = 750000 // ₦7,500.00
	eventID, err := svc.CreateEvent(ctx, founder, orgID, association.EventRequest{
		Title: "Gala", StartsAt: rfc3339In(96 * time.Hour), Paid: true, FeeKobo: feeKobo,
	})
	if err != nil {
		t.Fatalf("create paid event: %v", err)
	}

	reg, err := svc.RegisterEvent(ctx, founder, eventID)
	if err != nil {
		t.Fatalf("register paid event: %v", err)
	}
	if reg.Registered || reg.TicketCode != nil {
		t.Fatalf("paid event issued a ticket without payment: %+v", reg)
	}
	if !reg.PaymentRequired || reg.InvoiceID == nil {
		t.Fatalf("paid event did not raise an invoice: %+v", reg)
	}
	if reg.AmountKobo != feeKobo {
		t.Fatalf("invoice amount = %d kobo; want %d", reg.AmountKobo, feeKobo)
	}

	// Registering again must reuse the same invoice, not raise a second one.
	again, err := svc.RegisterEvent(ctx, founder, eventID)
	if err != nil {
		t.Fatalf("re-register: %v", err)
	}
	if again.InvoiceID == nil || *again.InvoiceID != *reg.InvoiceID {
		t.Fatalf("re-registering raised a second invoice: %v vs %v", again.InvoiceID, reg.InvoiceID)
	}
}

// TestRunDues_RaisesInvoicesAndIsReplaySafe is the money-path test that matters
// most here: a retried dues run must never re-bill an organisation's roster.
func TestRunDues_RaisesInvoicesAndIsReplaySafe(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	founder := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		founder, founder+"@dues.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	res, err := svc.PublishOrganisation(ctx, founder, newTestDraft("Dues Run "+uuid.New().String()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	orgID := res.OrganisationID

	// The draft's single category is ₦2,000.00 = 200000 kobo, and the founder is
	// its only ACTIVE member, so one invoice at exactly that amount is expected.
	key := newIdemKey(t, "duesrun")
	run, err := svc.RunDues(ctx, founder, orgID, association.DuesRunRequest{
		Title: "2026 annual dues", Scope: "NATIONAL", IdempotencyKey: key, Notify: true,
	})
	if err != nil {
		t.Fatalf("dues run: %v", err)
	}
	if run.Invoiced != 1 {
		t.Fatalf("invoiced = %d; want 1", run.Invoiced)
	}
	if run.TotalKobo != 200000 {
		t.Fatalf("totalKobo = %d; want 200000 (integer kobo from the category)", run.TotalKobo)
	}

	// Replay: same key must raise nothing and report the original run.
	replay, err := svc.RunDues(ctx, founder, orgID, association.DuesRunRequest{
		Title: "2026 annual dues", Scope: "NATIONAL", IdempotencyKey: key,
	})
	if err != nil {
		t.Fatalf("replayed dues run: %v", err)
	}
	if !replay.AlreadyRaised || replay.RunID != run.RunID {
		t.Fatalf("replay = %+v; want the original run %s reported as already raised", replay, run.RunID)
	}

	var invoices int
	var total int64
	if err := pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(SUM(i.amount_kobo),0)
		  FROM assoc_dues_invoices i
		  JOIN assoc_memberships m ON m.id = i.membership_id
		 WHERE m.organisation_id = $1`, orgID).Scan(&invoices, &total); err != nil {
		t.Fatalf("count invoices: %v", err)
	}
	if invoices != 1 || total != 200000 {
		t.Fatalf("after replay: %d invoices totalling %d kobo; want exactly 1 / 200000 — the roster was re-billed", invoices, total)
	}

	// Missing key must fail closed (iron rule).
	if _, err := svc.RunDues(ctx, founder, orgID, association.DuesRunRequest{Title: "No key"}); err == nil {
		t.Fatal("a dues run without an Idempotency-Key was accepted")
	}

	// And the member-facing dues screen must now show it — GetDues had nothing
	// to return before because no invoice could exist.
	dues, err := svc.GetDues(ctx, founder)
	if err != nil {
		t.Fatalf("get dues: %v", err)
	}
	if dues == nil {
		t.Fatal("GetDues returned nil after a dues run")
	}
}

// TestCreateTask_RejectsCrossOrgAssignee pins the org-scoping on task
// references: an assignee, committee or meeting from another organisation would
// be a cross-org write.
func TestCreateTask_RejectsCrossOrgAssignee(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	founder := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		founder, founder+"@task.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	mine, err := svc.PublishOrganisation(ctx, founder, newTestDraft("Task Org "+uuid.New().String()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	other := seedOrganisation(t, ctx, pool, "Other Org "+uuid.New().String()[:8])
	_, foreignMembership := seedActiveMembership(t, ctx, pool, other)

	if _, err := svc.CreateTask(ctx, founder, mine.OrganisationID, association.TaskRequest{
		Title: "Cross-org task", AssigneeID: &foreignMembership,
	}); err == nil {
		t.Fatal("a task was assigned to a member of another organisation")
	}
}

// TestRegisterDevice_MakesTheDeviceListUsable pins the device writer:
// assoc_devices had none, so /me/devices was always empty and revoke always
// failed on zero rows affected.
func TestRegisterDevice_MakesTheDeviceListUsable(t *testing.T) {
	ctx := context.Background()
	founder, _, svc, done := seedFounder(t, ctx, "device")
	defer done()

	id, err := svc.RegisterDevice(ctx, founder, association.DeviceRequest{
		Name: "Pixel 8", Platform: "android",
	})
	if err != nil {
		t.Fatalf("register device: %v", err)
	}
	// Idempotent: relaunching the app must refresh, not accumulate.
	again, err := svc.RegisterDevice(ctx, founder, association.DeviceRequest{
		Name: "Pixel 8", Platform: "android",
	})
	if err != nil {
		t.Fatalf("re-register device: %v", err)
	}
	if again != id {
		t.Fatalf("re-registering created a second device row: %s vs %s", again, id)
	}

	devices, err := svc.GetDevices(ctx, founder)
	if err != nil {
		t.Fatalf("get devices: %v", err)
	}
	if len(devices) == 0 {
		t.Fatal("GetDevices still empty after registering a device")
	}
	if err := svc.RevokeDevice(ctx, founder, id); err != nil {
		t.Fatalf("revoke device: %v", err)
	}
}

// TestFullDuesLifecycle_RunThenPayPostsBalancedLedger is the end-to-end proof
// that the money path is reachable at all.
//
// PayInvoice was already correct — idempotent, balanced, ledger-first — but it
// takes an invoice id, and NOTHING in the repo could create an invoice. The
// entire dues rail was therefore dead code. This drives the real sequence:
// publish an organisation → raise dues from the members' own categories → pay
// one → assert the double-entry landed and the invoice settled.
func TestFullDuesLifecycle_RunThenPayPostsBalancedLedger(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	founder := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		founder, founder+"@lifecycle.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	org, err := svc.PublishOrganisation(ctx, founder, newTestDraft("Lifecycle "+uuid.New().String()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	const duesKobo int64 = 200000 // the draft's single category, in kobo
	run, err := svc.RunDues(ctx, founder, org.OrganisationID, association.DuesRunRequest{
		Title:          "Lifecycle dues",
		IdempotencyKey: newIdemKey(t, "lifecycle"),
	})
	if err != nil {
		t.Fatalf("dues run: %v", err)
	}
	if run.Invoiced != 1 {
		t.Fatalf("invoiced = %d; want 1", run.Invoiced)
	}

	var invoiceID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM assoc_dues_invoices WHERE run_id=$1`, run.RunID).Scan(&invoiceID); err != nil {
		t.Fatalf("find invoice: %v", err)
	}

	// Fund the payer, then settle through the real money path.
	seedWallet(t, ctx, led, founder, duesKobo+100000)
	before, err := led.GetBalance(ctx, founder)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	res, err := svc.PayInvoice(ctx, founder, invoiceID, association.PayInvoiceRequest{
		Method:         "WALLET",
		IdempotencyKey: newIdemKey(t, "lifecycle-pay"),
	})
	if err != nil {
		t.Fatalf("pay invoice: %v", err)
	}
	if res.Status != "SUCCESS" {
		t.Fatalf("payment status = %s; want SUCCESS", res.Status)
	}

	after, err := led.GetBalance(ctx, founder)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if before-after != duesKobo {
		t.Fatalf("wallet moved by %d kobo; want exactly %d (balanced double-entry)", before-after, duesKobo)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&status); err != nil {
		t.Fatalf("read invoice: %v", err)
	}
	if status != "PAID" {
		t.Fatalf("invoice status = %s; want PAID", status)
	}

	// The revenue split must have been recorded for this payment.
	var splitLines int
	var splitTotal int64
	if err := pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(SUM(rs.amount_kobo),0)
		  FROM assoc_revenue_splits rs
		  JOIN assoc_payments p ON p.id = rs.payment_id
		 WHERE p.invoice_id = $1`, invoiceID).Scan(&splitLines, &splitTotal); err != nil {
		t.Fatalf("read split: %v", err)
	}
	if splitLines == 0 {
		t.Fatal("no revenue split rows recorded for a settled dues payment")
	}
	if splitTotal != duesKobo {
		t.Fatalf("revenue split sums to %d kobo; want exactly the dues amount %d", splitTotal, duesKobo)
	}
}

// TestAdminContentListings_AreReachableAndOrgScoped pins the routing gap: the
// six admin listing handlers and services existed but were never registered in
// routes.go, so every one of them 404'd and the console could not see the
// content it had just authored.
func TestAdminContentListings_AreReachableAndOrgScoped(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "listings")
	defer done()

	if _, err := svc.CreateAnnouncement(ctx, founder, orgID, association.AnnouncementRequest{Title: "Listing check"}); err != nil {
		t.Fatalf("create announcement: %v", err)
	}
	if _, err := svc.CreateMeeting(ctx, founder, orgID, association.MeetingRequest{
		Title: "Listing meeting", StartsAt: rfc3339In(24 * time.Hour),
	}); err != nil {
		t.Fatalf("create meeting: %v", err)
	}

	anns, err := svc.ListAdminAnnouncements(ctx, founder, orgID, 0, 0)
	if err != nil {
		t.Fatalf("list announcements: %v", err)
	}
	if len(anns) != 1 || anns[0].Title != "Listing check" {
		t.Fatalf("announcements = %+v; want exactly the one just created", anns)
	}
	if anns[0].Meta == nil {
		t.Fatal("announcement row has nil meta")
	}

	meetings, err := svc.ListAdminMeetings(ctx, founder, orgID, 0, 0)
	if err != nil {
		t.Fatalf("list meetings: %v", err)
	}
	if len(meetings) != 1 {
		t.Fatalf("meetings = %d; want 1", len(meetings))
	}

	// Each listing must exist and be callable; empty is fine, an error is not.
	for name, fn := range map[string]func() ([]association.AdminContentRow, error){
		"documents": func() ([]association.AdminContentRow, error) {
			return svc.ListAdminDocuments(ctx, founder, orgID, 0, 0)
		},
		"events": func() ([]association.AdminContentRow, error) {
			return svc.ListAdminEvents(ctx, founder, orgID, 0, 0)
		},
		"tasks": func() ([]association.AdminContentRow, error) {
			return svc.ListAdminTasks(ctx, founder, orgID, 0, 0)
		},
		"duesRuns": func() ([]association.AdminContentRow, error) {
			return svc.ListAdminDuesRuns(ctx, founder, orgID, 0, 0)
		},
	} {
		if _, err := fn(); err != nil {
			t.Fatalf("list %s: %v", name, err)
		}
	}

	// And they must be org-scoped: a stranger gets ErrForbidden, not rows.
	stranger := uuid.New().String()
	if _, err := svc.ListAdminAnnouncements(ctx, stranger, orgID, 0, 0); err == nil {
		t.Fatal("a stranger could list another organisation's announcements")
	}
}

// TestValidationErrors_Map400NotServerError pins the status mapping: these were
// plain fmt.Errorf values, so statusFor's default branch turned a user's typo
// into a 500.
func TestValidationErrors_Map400NotServerError(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "validation")
	defer done()

	cases := map[string]error{}
	_, cases["paid event with no fee"] = svc.CreateEvent(ctx, founder, orgID, association.EventRequest{
		Title: "x", StartsAt: rfc3339In(time.Hour), Paid: true, FeeKobo: 0,
	})
	_, cases["free event with a fee"] = svc.CreateEvent(ctx, founder, orgID, association.EventRequest{
		Title: "x", StartsAt: rfc3339In(time.Hour), Paid: false, FeeKobo: 100,
	})
	_, cases["bad meeting mode"] = svc.CreateMeeting(ctx, founder, orgID, association.MeetingRequest{
		Title: "x", Mode: "TELEPATHY", StartsAt: rfc3339In(time.Hour),
	})
	_, cases["malformed timestamp"] = svc.CreateMeeting(ctx, founder, orgID, association.MeetingRequest{
		Title: "x", StartsAt: "not-a-time",
	})

	for label, err := range cases {
		if err == nil {
			t.Fatalf("%s: expected rejection, got none", label)
		}
		if !errors.Is(err, association.ErrInvalidInput) {
			t.Fatalf("%s: %v does not wrap ErrInvalidInput, so it maps to 500 instead of 400", label, err)
		}
	}
}

// TestGetAdminAccess_RecognisesPlatformSuperAdmin pins the gap between what the
// server authorizes and what this endpoint reported: every guard checks
// isPlatformSuperAdmin first, but GetAdminAccess read only assoc_member_roles,
// so a platform super-admin was told isAdmin:false and the UI hid everything
// they could actually do.
func TestGetAdminAccess_RecognisesPlatformSuperAdmin(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	// The seeded platform admin holds the 'super-admin' slug and no association
	// membership — exactly the shape that reported as a plain member.
	var adminID string
	if err := pool.QueryRow(ctx, `
		SELECT u.id::text FROM auth.users u
		JOIN public.user_roles ur ON ur.user_id = u.id
		JOIN public.roles r ON r.id = ur.role_id
		WHERE r.slug = 'super-admin'
		  AND NOT EXISTS (SELECT 1 FROM assoc_memberships m WHERE m.user_id = u.id)
		LIMIT 1`).Scan(&adminID); err != nil {
		t.Skipf("no membership-less platform super-admin seeded: %v", err)
	}

	access, err := svc.GetAdminAccess(ctx, adminID)
	if err != nil {
		t.Fatalf("admin access: %v", err)
	}
	if !access.IsAdmin {
		t.Fatal("platform super-admin reported as isAdmin:false while every server guard authorizes them")
	}
	if !access.Can.ManageMembers || !access.Can.ManageFinance {
		t.Fatalf("capabilities = %+v; want full", access.Can)
	}
}

// TestDirectoryAndProfile_SurviveNullFullName pins a crash that took out the
// whole member directory: full_name is nullable, FullName is not a pointer, and
// 339 rows in the local database have no name — so GetDirectory returned
// "cannot scan NULL into *string" for any organisation containing one, killing
// the admin Members page and every assignee picker built on it.
func TestDirectoryAndProfile_SurviveNullFullName(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID := seedOrganisation(t, ctx, pool, "Null Name Org "+uuid.New().String()[:8])
	userID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	// A profile row with NO name — exactly the shape that crashed.
	if _, err := pool.Exec(ctx,
		`INSERT INTO assoc_member_profiles (membership_id, full_name) VALUES ($1, NULL)
		 ON CONFLICT (membership_id) DO UPDATE SET full_name = NULL`, membershipID); err != nil {
		t.Fatalf("seed null-name profile: %v", err)
	}

	rows, err := svc.GetDirectory(ctx, userID, association.MemberDirectoryQuery{})
	if err != nil {
		t.Fatalf("GetDirectory crashed on a NULL full_name: %v", err)
	}
	var found bool
	for _, r := range rows {
		if r.ID == membershipID {
			found = true
			if r.FullName == "" {
				t.Fatal("nameless member rendered with an empty name; expected the member code as a fallback")
			}
		}
	}
	if !found {
		t.Fatalf("the nameless member is missing from the directory (%d rows)", len(rows))
	}

	if _, err := svc.GetProfile(ctx, userID); err != nil {
		t.Fatalf("GetProfile crashed on a NULL full_name: %v", err)
	}
}

// TestCommitteeCrud_UsesTheRealColumn pins a bug hidden by a swallowed error:
// assoc_committees has `purpose`, not `description`. The SELECT's error was
// discarded by `if err == nil`, so every organisation reported committees: []
// while committeeCount showed the true number, and create/update failed
// outright.
func TestCommitteeCrud_UsesTheRealColumn(t *testing.T) {
	ctx := context.Background()
	founder, orgID, svc, done := seedFounder(t, ctx, "committee")
	defer done()

	purpose := "Oversees the annual audit"
	id, err := svc.CreateCommittee(ctx, founder, orgID, association.CommitteeRequest{
		Name: "Finance Committee", Description: &purpose,
	})
	if err != nil {
		t.Fatalf("create committee: %v", err)
	}

	detail, err := svc.GetAdminOrganisation(ctx, founder, orgID)
	if err != nil {
		t.Fatalf("org detail: %v", err)
	}
	// The draft seeds one committee and we just added another.
	if detail.CommitteeCount != len(detail.Committees) {
		t.Fatalf("committeeCount=%d but committees[] has %d — the sub-list is silently empty",
			detail.CommitteeCount, len(detail.Committees))
	}
	var seen bool
	for _, c := range detail.Committees {
		if c.ID == id {
			seen = true
			if c.Description == nil || *c.Description != purpose {
				t.Fatalf("committee purpose = %v; want %q", c.Description, purpose)
			}
		}
	}
	if !seen {
		t.Fatalf("created committee %s missing from the org detail", id)
	}

	newPurpose := "Oversees audit and procurement"
	if err := svc.UpdateCommittee(ctx, founder, id, association.CommitteeRequest{
		Name: "Finance & Procurement", Description: &newPurpose,
	}); err != nil {
		t.Fatalf("update committee: %v", err)
	}
	if err := svc.DeleteCommittee(ctx, founder, id); err != nil {
		t.Fatalf("delete committee: %v", err)
	}
}
