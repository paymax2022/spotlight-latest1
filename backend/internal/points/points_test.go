package points

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// fakeAuditor captures the single most recent LogAction call so tests can assert
// that Service.log forwards fixed audit fields (module / resourceType / severity)
// exactly as the ledger contract requires.
type fakeAuditor struct {
	calls int
	last  struct {
		actor, target, action, module, resourceType, resourceID string
		oldValues, newValues                                     map[string]any
		ip, ua, severity                                         string
	}
}

func (f *fakeAuditor) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) {
	f.calls++
	f.last.actor = actorUserID
	f.last.target = targetUserID
	f.last.action = action
	f.last.module = module
	f.last.resourceType = resourceType
	f.last.resourceID = resourceID
	f.last.oldValues = oldValues
	f.last.newValues = newValues
	f.last.ip = ipAddress
	f.last.ua = userAgent
	f.last.severity = severity
}

// --- Earn input validation (reached before any DB access) ---

// Earn rejects an empty userID / ruleKey before touching the (nil here) pool, so
// the guard is exercised purely. A regression that reorders the DB call ahead of
// the guard would panic on the nil pool instead of returning this error.
func TestEarn_RejectsEmptyIdentifiers(t *testing.T) {
	s := NewService(nil, nil) // nil pool: any DB access would panic, proving no DB is hit
	ctx := context.Background()

	cases := []struct {
		name, userID, ruleKey string
	}{
		{"empty user", "", "payments.bill_paid"},
		{"empty rule", "user-1", ""},
		{"both empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entry, created, err := s.Earn(ctx, tc.userID, tc.ruleKey, EarnContext{})
			if err == nil {
				t.Fatalf("expected validation error, got nil")
			}
			if entry != nil {
				t.Fatalf("expected nil entry on validation failure, got %+v", entry)
			}
			if created {
				t.Fatalf("expected created=false on validation failure")
			}
			if !strings.Contains(err.Error(), "user and rule_key required") {
				t.Fatalf("unexpected error text: %v", err)
			}
		})
	}
}

// --- Audit forwarding (Service.log) ---

// log must forward the caller's identifiers and stamp the fixed points-module audit
// fields: actor=userID, target="", module="points", resourceType="points_ledger",
// oldValues=nil, severity="info". This is the shape every points mutation audits under.
func TestServiceLog_ForwardsFixedAuditFields(t *testing.T) {
	fa := &fakeAuditor{}
	s := NewService(nil, fa)

	meta := map[string]any{"rule": "payments.bill_paid", "points": int64(50)}
	s.log("user-42", "points.earn", "entry-abc", meta)

	if fa.calls != 1 {
		t.Fatalf("expected exactly 1 audit call, got %d", fa.calls)
	}
	l := fa.last
	if l.actor != "user-42" {
		t.Errorf("actor: got %q want %q", l.actor, "user-42")
	}
	if l.target != "" {
		t.Errorf("target: got %q want empty", l.target)
	}
	if l.action != "points.earn" {
		t.Errorf("action: got %q want %q", l.action, "points.earn")
	}
	if l.module != "points" {
		t.Errorf("module: got %q want %q", l.module, "points")
	}
	if l.resourceType != "points_ledger" {
		t.Errorf("resourceType: got %q want %q", l.resourceType, "points_ledger")
	}
	if l.resourceID != "entry-abc" {
		t.Errorf("resourceID: got %q want %q", l.resourceID, "entry-abc")
	}
	if l.oldValues != nil {
		t.Errorf("oldValues: got %v want nil", l.oldValues)
	}
	if l.newValues["rule"] != "payments.bill_paid" {
		t.Errorf("newValues not forwarded: got %v", l.newValues)
	}
	if l.severity != "info" {
		t.Errorf("severity: got %q want %q", l.severity, "info")
	}
}

// A nil auditor is an explicitly supported configuration (NL-12: audit is nil-safe);
// log must be a no-op that does not panic.
func TestServiceLog_NilAuditorIsNoOp(t *testing.T) {
	s := NewService(nil, nil)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("log with nil auditor panicked: %v", r)
		}
	}()
	s.log("user-1", "points.earn", "entry-1", map[string]any{"x": 1})
}

// --- Sentinel errors ---

// The two redemption sentinels must stay distinct (handler maps them to different
// HTTP statuses: 402 vs 403) and carry stable, non-empty messages.
func TestSentinelErrors_DistinctAndStable(t *testing.T) {
	if ErrInsufficientPoints == nil || ErrCashRedemptionForbidden == nil {
		t.Fatal("sentinel errors must be non-nil")
	}
	if ErrInsufficientPoints == ErrCashRedemptionForbidden {
		t.Fatal("sentinels must be distinct error values")
	}
	if !strings.Contains(ErrInsufficientPoints.Error(), "insufficient points") {
		t.Errorf("unexpected ErrInsufficientPoints text: %v", ErrInsufficientPoints)
	}
	if !strings.Contains(ErrCashRedemptionForbidden.Error(), "NL-4") {
		t.Errorf("cash-forbidden error should cite NL-4: %v", ErrCashRedemptionForbidden)
	}
}

// --- Constructors ---

func TestConstructors_ReturnWired(t *testing.T) {
	svc := NewService(nil, nil)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
	h := NewHandler(svc)
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.svc != svc {
		t.Fatal("NewHandler did not wire the service")
	}
}

// --- Model / EntryType constants ---

// The ledger direction constants are the wire values persisted in points_ledger.type
// and matched verbatim in the balance SQL (type='EARN' etc). Pin them so a rename
// can't silently desync the projection query.
func TestEntryTypeConstants(t *testing.T) {
	pairs := map[EntryType]string{
		EntryEarn:   "EARN",
		EntryRedeem: "REDEEM",
		EntryExpire: "EXPIRE",
		EntryAdjust: "ADJUST",
	}
	for got, want := range pairs {
		if string(got) != want {
			t.Errorf("EntryType %q != %q", string(got), want)
		}
	}
}

// Entry JSON: required fields always present; the optional pointer/omitempty fields
// (expires_at, rule_key, module) are dropped when zero-valued so the member-facing
// history payload stays lean.
func TestEntry_JSONOmitempty(t *testing.T) {
	e := Entry{
		ID:             "id-1",
		UserID:         "user-1",
		Type:           EntryEarn,
		Points:         100,
		Reference:      "ref-1",
		IdempotencyKey: "earn:x:v1:ref-1",
		CreatedAt:      time.Unix(0, 0).UTC(),
		// RuleKey, Module, ExpiresAt intentionally zero
	}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(b)

	for _, must := range []string{`"id":"id-1"`, `"user_id":"user-1"`, `"type":"EARN"`, `"points":100`, `"reference":"ref-1"`} {
		if !strings.Contains(s, must) {
			t.Errorf("expected %s in %s", must, s)
		}
	}
	for _, absent := range []string{"expires_at", "rule_key", "module"} {
		if strings.Contains(s, absent) {
			t.Errorf("expected %q omitted when zero, got %s", absent, s)
		}
	}
}

// When ExpiresAt is set it must serialise (expiry is what the balance query filters on).
func TestEntry_JSONIncludesExpiresWhenSet(t *testing.T) {
	exp := time.Unix(1000, 0).UTC()
	e := Entry{ID: "id", UserID: "u", Type: EntryEarn, Points: 1, Reference: "r", IdempotencyKey: "k", ExpiresAt: &exp, CreatedAt: exp}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), "expires_at") {
		t.Errorf("expires_at should be present when set: %s", b)
	}
}

// Entry round-trips through JSON without losing the typed EntryType (stored as a
// plain string on the wire, rehydrated into the typed field).
func TestEntry_JSONRoundTrip(t *testing.T) {
	orig := Entry{ID: "id-9", UserID: "u-9", Type: EntryRedeem, Points: 250, RuleKey: "redeem:sku", Module: "loyalty", Reference: "red-1", IdempotencyKey: "redeem:red-1", CreatedAt: time.Unix(5, 0).UTC()}
	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got Entry
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != EntryRedeem {
		t.Errorf("Type round-trip: got %q want %q", got.Type, EntryRedeem)
	}
	if got.Points != 250 || got.UserID != "u-9" {
		t.Errorf("round-trip mismatch: %+v", got)
	}
}

// CatalogItem drops the optional metadata map when nil.
func TestCatalogItem_JSONOmitemptyMetadata(t *testing.T) {
	it := CatalogItem{ID: "c1", SKU: "AIRTIME_500", Title: "N500 Airtime", Kind: "airtime", CostPoints: 500, ValueKobo: 50000, Active: true}
	b, err := json.Marshal(it)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), "metadata") {
		t.Errorf("metadata should be omitted when nil: %s", b)
	}
	if !strings.Contains(string(b), `"cost_points":500`) {
		t.Errorf("cost_points missing: %s", b)
	}
}
