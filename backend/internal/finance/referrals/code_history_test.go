package referrals

// The admin user record shows TWO codes: the one the account was issued and the
// one the admin customised it to. Only the second lives in a row anywhere — the
// write converges every copy onto the new value — so the original has to come
// from the append-only audit stream (referral.code.changed, emitted by
// SetLinkCode). These tests pin the read.
//
// It must stay SELECT-only: the console re-reads this on every page open, and a
// GET that minted or rewrote a code would be a mutation dressed as a report.

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestOriginalCode_ReadsTheOldestChange(t *testing.T) {
	q := &recordingQuerier{events: scriptedRow{vals: []any{"94JQ7"}}}
	got, err := newLookupSvc(q).OriginalCode(context.Background(), "u1")
	if err != nil {
		t.Fatalf("OriginalCode: %v", err)
	}
	if got != "94JQ7" {
		t.Fatalf("original code = %q, want the code the first change moved away from", got)
	}
	q.assertReadOnly(t)
}

// The audit lookup is scoped to THIS user and to the one event type that means
// "an admin renamed the code". Without both filters the console would report some
// other account's code as this one's original.
func TestOriginalCode_FiltersOnTheCodeChangeEventAndTheOwner(t *testing.T) {
	q := &recordingQuerier{events: noRow}
	if _, err := newLookupSvc(q).OriginalCode(context.Background(), "u1"); err != nil {
		t.Fatalf("OriginalCode: %v", err)
	}
	if len(q.stmts) != 1 {
		t.Fatalf("issued %d statements, want one", len(q.stmts))
	}
	sql := strings.ToLower(q.stmts[0])
	for _, want := range []string{"referral_engine_events", "referral.code.changed", "referrer_id", "coalesce"} {
		if !strings.Contains(sql, want) {
			t.Errorf("query %q does not mention %s", sql, want)
		}
	}
	if !strings.Contains(sql, "limit 1") {
		t.Errorf("query %q must stop after the row it needs", sql)
	}
}

// A user whose code was never customised has no history. That is not an error and
// it is not an empty code either — the console must show one row, not
// "original: (blank)". The empty-string row is what COALESCE returns when the
// payload was written without a `from`.
func TestOriginalCode_NoHistoryIsEmptyNotError(t *testing.T) {
	for name, q := range map[string]*recordingQuerier{
		"no rows":    {events: noRow},
		"blank from": {events: scriptedRow{vals: []any{""}}},
	} {
		got, err := newLookupSvc(q).OriginalCode(context.Background(), "u1")
		if err != nil {
			t.Errorf("%s: want nil error, got %v", name, err)
		}
		if got != "" {
			t.Errorf("%s: got %q, want empty", name, got)
		}
	}
}

// A database fault in the history read must surface, so the handler can degrade
// to "no original known" rather than report it as a missing code (AdminGetCode).
func TestOriginalCode_DatabaseErrorIsReturned(t *testing.T) {
	boom := errors.New("connection reset")
	q := &recordingQuerier{events: scriptedRow{err: boom}}
	_, err := newLookupSvc(q).OriginalCode(context.Background(), "u1")
	if !errors.Is(err, boom) {
		t.Fatalf("want the database error, got %v", err)
	}
	if errors.Is(err, ErrNoCode) {
		t.Fatal("a database fault must not read as \"this user has no code\"")
	}
}
