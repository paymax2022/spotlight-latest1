package top5events

// DB-free tests for the events-commerce layer (migration 20271400000000):
//   - the flag matrix: with commerce off every query keeps its pre-migration
//     column list, and the two flags compose independently;
//   - the select and the scan cannot drift: column count == destination count;
//   - policy defaults, ranges and the platform-owned moderation fields;
//   - the booking/ticket projection a receipt and a door list depend on.
//
// A Service built without a pool panics the moment it reaches the database, so a
// pass on the CreateEvent/UpdateEvent cases also proves the checks run first.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// commerceMigrationPath is the file these tests pin against the code.
const commerceMigrationPath = "../../../supabase/migrations/20271400000000_events_commerce.sql"

// commerceCols and socialCols are the extension column lists, for the "must not
// appear" assertions below.
var (
	commerceColNames = []string{"city", "venue_address", "refund_policy", "refund_cutoff_hours",
		"checkin_opens_minutes", "checkin_closes_minutes", "submitted_at", "moderation_status",
		"moderation_note", "moderation_decided_at"}
	socialColNames = []string{"banner_url", "venue_lat", "venue_lng", "venue_place_id", "like_count", "event_likes"}
)

// selectColumnCount counts the top-level items of a "SELECT <cols> FROM ..." list,
// ignoring commas inside function calls. It lets a test compare a query's shape
// against a scan's destination count, which is how the two drift apart in practice.
func selectColumnCount(q string) int {
	i := strings.Index(q, "SELECT ")
	if i < 0 {
		return -1
	}
	list := q[i+len("SELECT "):]
	depth, n := 0, 1
	for j := 0; j < len(list); j++ {
		switch list[j] {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				n++
			}
		case ' ', '\n', '\t':
			if depth == 0 && (strings.HasPrefix(strings.ToUpper(list[j:]), " FROM ") || strings.HasPrefix(list[j:], " FROM ")) {
				return n
			}
		}
	}
	return n
}

func TestCommerceReadsDefaultOff(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	if svc.commerceReads {
		t.Fatal("a new Service must read with the commerce flag off")
	}
	if !svc.EnableCommerceReads().commerceReads {
		t.Fatal("EnableCommerceReads did not turn the commerce read path on")
	}
}

func TestEventRowSelect_FlagMatrix(t *testing.T) {
	off := (&Service{}).eventRowSelect()
	if off != originalGetEventQuery {
		t.Fatalf("both off =\n%s\nwant the original select\n%s", off, originalGetEventQuery)
	}
	for _, col := range append(append([]string{}, commerceColNames...), socialColNames...) {
		if strings.Contains(off, col) {
			t.Errorf("flag-off query reads %q; it must not touch pre-migration columns", col)
		}
	}

	commerce := (&Service{commerceReads: true}).eventRowSelect()
	for _, col := range commerceColNames {
		if !strings.Contains(commerce, "e."+col) {
			t.Errorf("commerce-only select is missing %q", col)
		}
	}
	for _, col := range socialColNames {
		if strings.Contains(commerce, col) {
			t.Errorf("commerce-only select reads social column %q", col)
		}
	}
	if args := (&Service{commerceReads: true}).eventRowArgs("e1", "u1"); len(args) != 1 {
		t.Errorf("commerce-only args = %v, want only the event id (no like join)", args)
	}

	social := (&Service{socialReads: true}).eventRowSelect()
	if !strings.Contains(social, "LEFT JOIN event_likes") {
		t.Error("social-only select lost the like join")
	}
	for _, col := range commerceColNames {
		if strings.Contains(social, col) {
			t.Errorf("social-only select reads commerce column %q", col)
		}
	}

	both := (&Service{socialReads: true, commerceReads: true}).eventRowSelect()
	for _, col := range append(append([]string{}, commerceColNames...), socialColNames...) {
		if !strings.Contains(both, col) {
			t.Errorf("both-on select is missing %q", col)
		}
	}
	if args := (&Service{socialReads: true, commerceReads: true}).eventRowArgs("e1", "u1"); len(args) != 2 {
		t.Errorf("both-on args = %v, want the event id and the like caller", args)
	}
}

// TestScan_DestinationsMatchColumns is the drift guard: a scan that takes fewer
// destinations than the select returns fails at runtime on the first read, and the
// only way to catch it without a database is to count both sides.
func TestScan_DestinationsMatchColumns(t *testing.T) {
	cases := []struct {
		name     string
		svc      *Service
		wantCols int
	}{
		{"off", &Service{}, 11},
		{"social", &Service{socialReads: true}, 17},
		{"commerce", &Service{commerceReads: true}, 21},
		{"both", &Service{socialReads: true, commerceReads: true}, 27},
	}
	for _, tc := range cases {
		if got := selectColumnCount(tc.svc.eventRowSelect()); got != tc.wantCols {
			t.Errorf("%s: select has %d columns, want %d", tc.name, got, tc.wantCols)
		}
		row := &countingRow{}
		if _, err := tc.svc.scanEventRow(row); err != nil {
			t.Fatalf("%s: scanEventRow: %v", tc.name, err)
		}
		if row.n != tc.wantCols {
			t.Errorf("%s: scanEventRow took %d destinations, want %d (the select's column count)", tc.name, row.n, tc.wantCols)
		}
	}

	for _, tc := range []struct {
		svc  *Service
		want int
	}{
		{&Service{}, 9},
		{&Service{commerceReads: true}, 14},
	} {
		q := tc.svc.ticketRowSQL("id = $1")
		if got := selectColumnCount(q); got != tc.want {
			t.Errorf("ticket select has %d columns, want %d:\n%s", got, tc.want, q)
		}
		row := &countingRow{}
		if _, err := scanTicketRow(row, tc.svc.commerceReads); err != nil {
			t.Fatalf("scanTicketRow: %v", err)
		}
		if row.n != tc.want {
			t.Errorf("scanTicketRow took %d destinations, want %d", row.n, tc.want)
		}
	}

	// scanLegacyEvent and scanEvent keep their pinned shapes (social_flag_test.go).
	if n := selectColumnCount(legacyEventByIDQuery); n != 11 {
		t.Errorf("legacy select has %d columns, want 11", n)
	}
	if n := selectColumnCount("SELECT " + eventSelectCols + " FROM events e"); n != 17 {
		t.Errorf("social select has %d columns, want 17", n)
	}
}

func TestTicketRowSQL_FlagGated(t *testing.T) {
	off := (&Service{}).ticketRowSQL("id = $1")
	for _, col := range []string{"attendee_name", "checked_in_at", "checkin_method", "checked_in_by", "checked_in_gate"} {
		if strings.Contains(off, col) {
			t.Errorf("commerce-off ticket select reads %q", col)
		}
	}
	on := (&Service{commerceReads: true}).ticketRowSQL("id = $1")
	for _, col := range []string{"attendee_name", "checked_in_at", "checkin_method", "checked_in_by", "checked_in_gate"} {
		if !strings.Contains(on, col) {
			t.Errorf("commerce-on ticket select is missing %q", col)
		}
	}
}

func TestBookingRefFromIdem(t *testing.T) {
	for idem, want := range map[string]string{
		"":               "",
		"base":           "base",
		"base:3":         "base",
		"base:0":         "base",
		"base:12":        "base",
		"a:12:3":         "a:12",
		"base:a":         "base:a", // not a seat index
		"base:":          "base:",  // trailing colon is not a seat
		":3":             ":3",     // nothing before the colon
		"evt:2027-01-01": "evt:2027-01-01",
	} {
		if got := bookingRefFromIdem(idem); got != want {
			t.Errorf("bookingRefFromIdem(%q) = %q, want %q", idem, got, want)
		}
	}
}

func TestCheckinWindow(t *testing.T) {
	start := time.Date(2027, 3, 1, 19, 0, 0, 0, time.UTC)

	// Zeroed policy columns fall back to the defaults (6h before, 2h after).
	ev := &Event{StartsAt: start, EndsAt: start.Add(time.Hour)}
	from, to := checkinWindow(ev)
	if want := start.Add(-defaultCheckinOpensMinutes * time.Minute); !from.Equal(want) {
		t.Errorf("default open = %s, want %s", from, want)
	}
	// ends_at (20:00) is earlier than start+2h (21:00), so it clamps the close.
	if !to.Equal(ev.EndsAt) {
		t.Errorf("short event close = %s, want ends_at %s", to, ev.EndsAt)
	}

	// A close window past ends_at is clamped; one before it is honoured.
	ev = &Event{StartsAt: start, EndsAt: start.Add(5 * time.Hour), CheckinOpensMinutes: 30, CheckinClosesMinutes: 60}
	from, to = checkinWindow(ev)
	if want := start.Add(-30 * time.Minute); !from.Equal(want) {
		t.Errorf("opens = %s, want %s", from, want)
	}
	if want := start.Add(time.Hour); !to.Equal(want) {
		t.Errorf("closes = %s, want %s", to, want)
	}

	ev = &Event{StartsAt: start, EndsAt: start.Add(90 * time.Minute), CheckinOpensMinutes: 30, CheckinClosesMinutes: 180}
	if _, to = checkinWindow(ev); !to.Equal(ev.EndsAt) {
		t.Errorf("clamped close = %s, want ends_at %s", to, ev.EndsAt)
	}
}

func TestCredentialValidFrom(t *testing.T) {
	start := time.Date(2027, 3, 1, 19, 0, 0, 0, time.UTC)
	ev := &Event{StartsAt: start, EndsAt: start.Add(8 * time.Hour), CheckinOpensMinutes: 30}

	// Commerce off: the pre-commerce six-hour lead, because the window columns
	// do not exist yet.
	if got, want := credentialValidFrom(ev, false), start.Add(-6*time.Hour); !got.Equal(want) {
		t.Errorf("commerce-off valid_from = %s, want %s", got, want)
	}
	// Commerce on: the organiser's own window start.
	if got, want := credentialValidFrom(ev, true), start.Add(-30*time.Minute); !got.Equal(want) {
		t.Errorf("commerce-on valid_from = %s, want %s", got, want)
	}
}

func TestApplyEventPolicy_DefaultsAndRanges(t *testing.T) {
	e := &Event{City: "  Lagos  ", RefundPolicy: strings.Repeat("x", maxRefundPolicyLen+500)}
	if err := applyEventPolicy(e); err != nil {
		t.Fatalf("defaults: %v", err)
	}
	if e.City != "Lagos" {
		t.Errorf("city = %q, want trimmed", e.City)
	}
	if len(e.RefundPolicy) != maxRefundPolicyLen {
		t.Errorf("refund policy length = %d, want the cap %d", len(e.RefundPolicy), maxRefundPolicyLen)
	}
	if e.RefundCutoffHours != defaultRefundCutoffHours ||
		e.CheckinOpensMinutes != defaultCheckinOpensMinutes ||
		e.CheckinClosesMinutes != defaultCheckinClosesMin {
		t.Errorf("defaults not filled: %+v", e)
	}

	// An explicitly set value is kept, not overwritten by the default.
	kept := &Event{RefundCutoffHours: 48, CheckinOpensMinutes: 15, CheckinClosesMinutes: 0}
	if err := applyEventPolicy(kept); err != nil {
		t.Fatalf("explicit: %v", err)
	}
	if kept.RefundCutoffHours != 48 || kept.CheckinOpensMinutes != 15 {
		t.Errorf("explicit values overwritten: %+v", kept)
	}

	for name, e := range map[string]*Event{
		"cutoff too long": {RefundCutoffHours: maxRefundCutoffHours + 1},
		"cutoff negative": {RefundCutoffHours: -1},
		"opens too long":  {CheckinOpensMinutes: maxCheckinWindowMinutes + 1},
		"opens negative":  {CheckinOpensMinutes: -5},
		"closes too long": {CheckinClosesMinutes: maxCheckinWindowMinutes + 1},
		"closes negative": {CheckinClosesMinutes: -1},
	} {
		if err := applyEventPolicy(e); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: err = %v, want ErrValidation", name, err)
		}
	}

	// The boundaries themselves are legal, and a zero still means "use the default".
	if err := applyEventPolicy(&Event{RefundCutoffHours: maxRefundCutoffHours, CheckinOpensMinutes: maxCheckinWindowMinutes}); err != nil {
		t.Errorf("boundary values rejected: %v", err)
	}
}

func TestPrepareCommerceEvent_ClearsPlatformOwnedFields(t *testing.T) {
	now := time.Now()
	e := &Event{
		ModerationStatus: ModerationApproved, ModerationNote: "self-approved",
		SubmittedAt: &now, ModerationDecidedAt: &now,
	}
	if err := prepareCommerceEvent(e); err != nil {
		t.Fatalf("prepareCommerceEvent: %v", err)
	}
	if e.ModerationStatus != ModerationNone || e.ModerationNote != "" || e.SubmittedAt != nil || e.ModerationDecidedAt != nil {
		t.Errorf("moderation fields not cleared: %+v", e)
	}
}

func TestValidatePatchPolicy(t *testing.T) {
	i := func(v int) *int { return &v }
	// Absent fields are never validated: an organiser patching only the title of an
	// event must not be rejected for a policy column they did not send.
	if err := validatePatchPolicy(EventPatch{Title: sp("T")}); err != nil {
		t.Errorf("absent policy fields: err = %v, want nil", err)
	}
	for name, p := range map[string]EventPatch{
		"cutoff high": {RefundCutoffHours: i(maxRefundCutoffHours + 1)},
		"cutoff low":  {RefundCutoffHours: i(-1)},
		"opens high":  {CheckinOpensMinutes: i(maxCheckinWindowMinutes + 1)},
		"closes low":  {CheckinClosesMinutes: i(-1)},
	} {
		if err := validatePatchPolicy(p); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: err = %v, want ErrValidation", name, err)
		}
	}
	if err := validatePatchPolicy(EventPatch{RefundCutoffHours: i(0), CheckinClosesMinutes: i(maxCheckinWindowMinutes)}); err != nil {
		t.Errorf("boundary patch rejected: %v", err)
	}
}

func TestClampTrim(t *testing.T) {
	if got := clampTrim("  a  ", 10); got != "a" {
		t.Errorf("clampTrim = %q, want %q", got, "a")
	}
	if got := clampTrim(strings.Repeat("b", 70), maxCityLen); len(got) != maxCityLen {
		t.Errorf("clampTrim length = %d, want the cap %d", len(got), maxCityLen)
	}
	if got := clampTrim("", 5); got != "" {
		t.Errorf("clampTrim(\"\") = %q, want empty", got)
	}
}

// TestCreateEvent_RejectsBadPolicyBeforeDB also proves the ordering: a nil pool
// would panic on the organiser-gate read or the event_fee_settings read, so an
// ErrValidation answer means the policy check runs first and no write was
// attempted.
func TestCreateEvent_RejectsBadPolicyBeforeDB(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil).EnableCommerceReads()
	start := time.Now().Add(time.Hour)
	_, err := svc.CreateEvent(context.Background(), uuid.New().String(), Event{
		Title: "Show", StartsAt: start, EndsAt: start.Add(time.Hour),
		RefundCutoffHours: maxRefundCutoffHours + 1,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("err = %v, want ErrValidation", err)
	}
}

func TestUpdateEvent_RejectsBadPolicyBeforeDB(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil).EnableCommerceReads()
	bad := maxCheckinWindowMinutes + 1
	if _, err := svc.UpdateEvent(context.Background(), uuid.New().String(), uuid.New().String(),
		EventPatch{CheckinOpensMinutes: &bad}); !errors.Is(err, ErrValidation) {
		t.Fatalf("err = %v, want ErrValidation", err)
	}
}

func TestEventPatch_CommerceFieldsDecode(t *testing.T) {
	var p EventPatch
	if err := json.Unmarshal([]byte(`{"city":"Lagos","refund_cutoff_hours":48,"checkin_opens_minutes":30}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.City == nil || *p.City != "Lagos" || p.RefundCutoffHours == nil || *p.RefundCutoffHours != 48 ||
		p.CheckinOpensMinutes == nil || *p.CheckinOpensMinutes != 30 {
		t.Errorf("commerce fields lost: %+v", p)
	}
	if p.CheckinClosesMinutes != nil {
		t.Errorf("absent checkin_closes_minutes decoded as %v", *p.CheckinClosesMinutes)
	}
	for _, bad := range []string{`{"city":5}`, `{"refund_cutoff_hours":"48"}`} {
		var q EventPatch
		if err := json.Unmarshal([]byte(bad), &q); err == nil {
			t.Errorf("%s: want a decode error", bad)
		}
	}
}

// TestModerationColumns_AreInTheContract pins the JSON names the mobile detail
// screen and the admin queue read, so a rename is a deliberate act.
func TestModerationColumns_AreInTheContract(t *testing.T) {
	now := time.Now()
	b, err := json.Marshal(Event{
		ID: "e", State: EventDraft, City: "Lagos", RefundCutoffHours: 24,
		ModerationStatus: ModerationPending, SubmittedAt: &now,
	})
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"city", "refund_cutoff_hours", "moderation_status", "submitted_at"} {
		if _, ok := out[k]; !ok {
			t.Errorf("event JSON is missing %q: %s", k, b)
		}
	}
	for _, k := range []string{"venue_address", "refund_policy", "checkin_opens_minutes", "moderation_note"} {
		if _, ok := out[k]; ok {
			t.Errorf("unset %q must be omitted, not sent as zero: %s", k, b)
		}
	}
}

// sqlCode strips -- comments and collapses whitespace, so a structural assertion is
// never satisfied or tripped by prose (this migration explains in its header that it
// deliberately does NOT touch events_state_check).
func sqlCode(sql string) string {
	lines := strings.Split(sql, "\n")
	for i, l := range lines {
		if j := strings.Index(l, "--"); j >= 0 {
			lines[i] = l[:j]
		}
	}
	return strings.ToUpper(strings.Join(strings.Fields(strings.Join(lines, " ")), " "))
}

// TestMigrationEventsCommerce is the static half of the deploy gate: the file is
// additive, wraps itself in a transaction, and does not rewrite the lifecycle CHECK
// constraint or FORCE RLS (both of which would break the backend's owner pool or a
// legacy row).
func TestMigrationEventsCommerce(t *testing.T) {
	b, err := os.ReadFile(commerceMigrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(b)
	norm := sqlCode(sql)

	if !strings.HasPrefix(strings.TrimSpace(sql), "--") {
		t.Error("migration must open with a comment explaining what it does and why")
	}
	if !strings.Contains(norm, "BEGIN;") || !strings.Contains(norm, "COMMIT;") {
		t.Error("migration is not wrapped in BEGIN/COMMIT, so a partial apply would leave the schema half-migrated")
	}
	for _, forbidden := range []string{"DROP TABLE", "DROP COLUMN", "DROP INDEX", "ALTER COLUMN", "FORCE ROW LEVEL SECURITY"} {
		if strings.Contains(norm, forbidden) {
			t.Errorf("migration contains %q; it must be additive only", forbidden)
		}
	}
	if strings.Contains(norm, "EVENTS_STATE_CHECK") {
		t.Error("migration rewrites events_state_check; the lifecycle constraint belongs to 20271032000000")
	}

	tables := []string{"event_refunds", "event_moderation_decisions", "event_checkin_log",
		"event_fee_settings", "event_organiser_sanctions", "event_support_cases", "event_support_messages",
		"event_notifications"}
	for _, tbl := range tables {
		u := strings.ToUpper(tbl)
		if !strings.Contains(norm, "CREATE TABLE IF NOT EXISTS PUBLIC."+u+" (") {
			t.Errorf("missing CREATE TABLE IF NOT EXISTS for %s", tbl)
		}
		if !strings.Contains(norm, "ALTER TABLE PUBLIC."+u+" ENABLE ROW LEVEL SECURITY") {
			t.Errorf("%s has no RLS enabled", tbl)
		}
	}

	// Every new table: a service_role write policy, so the backend can write at all
	// and no client role can.
	if n := strings.Count(norm, "TO SERVICE_ROLE"); n < len(tables) {
		t.Errorf("only %d service_role policies for %d new tables; each needs one", n, len(tables))
	}

	// The defaults the Go policy layer mirrors, so a pre-migration row and a fresh
	// draft cannot disagree about what an unset field means.
	for _, want := range []string{
		"REFUND_CUTOFF_HOURS INT NOT NULL DEFAULT 24",
		"CHECKIN_OPENS_MINUTES INT NOT NULL DEFAULT 360",
		"CHECKIN_CLOSES_MINUTES INT NOT NULL DEFAULT 120",
		"MODERATION_STATUS TEXT NOT NULL DEFAULT 'NONE'",
	} {
		if !strings.Contains(norm, want) {
			t.Errorf("migration column default changed, the service mirrors it: missing %q", want)
		}
	}
	if defaultRefundCutoffHours != 24 || defaultCheckinOpensMinutes != 360 || defaultCheckinClosesMin != 120 ||
		ModerationNone != "NONE" {
		t.Errorf("service defaults drifted from the migration: %d/%d/%d/%q",
			defaultRefundCutoffHours, defaultCheckinOpensMinutes, defaultCheckinClosesMin, ModerationNone)
	}
	if defaultFeeBps != 1000 || !strings.Contains(norm, "INSERT INTO PUBLIC.EVENT_FEE_SETTINGS (ID, FEE_BPS) VALUES (1, 1000)") {
		t.Errorf("the seeded platform fee and defaultFeeBps (%d) must be the same number", defaultFeeBps)
	}

	// Platform-owned moderation: a client role must not self-approve through
	// PostgREST (a column REVOKE would not bite against the table-level grant).
	i := strings.Index(sql, "events_protect_moderation()")
	if i < 0 {
		t.Fatal("missing the events_protect_moderation trigger function")
	}
	trigger := sql[i:]
	if !strings.Contains(trigger, "current_user IN ('authenticated', 'anon')") {
		t.Error("the moderation trigger must key on the client roles only, so the backend's owner pool can still decide")
	}
	for _, col := range []string{"moderation_status", "moderation_note", "moderation_decided_by", "moderation_decided_at", "submitted_at"} {
		if !strings.Contains(trigger, "NEW."+col) || !strings.Contains(trigger, "OLD."+col) {
			t.Errorf("moderation trigger does not pin %s on both INSERT and UPDATE", col)
		}
	}

	// The refund state machine must not be able to double-refund one ticket.
	if !strings.Contains(norm, "UQ_EVENT_REFUNDS_TICKET_LIVE") {
		t.Error("missing the partial unique index that keeps at most one live refund per ticket")
	}

	for _, slug := range []string{"events.refund", "events.moderate", "events.fees", "events.support", "events.organisers"} {
		if !strings.Contains(sql, "'"+slug+"'") {
			t.Errorf("permission %s is not seeded", slug)
		}
	}
}
