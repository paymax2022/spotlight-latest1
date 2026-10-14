package referrals

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// scriptedRow returns canned values (or an error) from Scan.
type scriptedRow struct {
	vals []any
	err  error
}

func (r scriptedRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i, d := range dest {
		switch p := d.(type) {
		case *string:
			*p = r.vals[i].(string)
		case *time.Time:
			*p = r.vals[i].(time.Time)
		}
	}
	return nil
}

// recordingQuerier records every statement and answers by table name.
type recordingQuerier struct {
	stmts   []string
	finance scriptedRow
	link    scriptedRow
	pu      scriptedRow
}

func (q *recordingQuerier) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	q.stmts = append(q.stmts, sql)
	switch {
	case strings.Contains(sql, "finance_referral_codes"):
		return q.finance
	case strings.Contains(sql, "referral_links"):
		return q.link
	case strings.Contains(sql, "platform_users"):
		return q.pu
	}
	return scriptedRow{err: errors.New("unexpected sql")}
}

func (q *recordingQuerier) assertReadOnly(t *testing.T) {
	t.Helper()
	if len(q.stmts) == 0 {
		t.Fatal("no statements recorded")
	}
	for _, s := range q.stmts {
		if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(s)), "SELECT") {
			t.Fatalf("non-SELECT statement issued: %s", s)
		}
	}
}

var noRow = scriptedRow{err: pgx.ErrNoRows}

func row(code string, at time.Time) scriptedRow { return scriptedRow{vals: []any{code, at}} }

func newLookupSvc(q *recordingQuerier) *Service { return &Service{reader: q} }

func TestLookupCode_FindsFinanceFirst(t *testing.T) {
	now := time.Now()
	q := &recordingQuerier{finance: row("SPOT-AAAAAA", now), link: noRow, pu: noRow}
	code, src, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if err != nil || code != "SPOT-AAAAAA" || src != "finance_referral_codes" {
		t.Fatalf("got %q %q %v", code, src, err)
	}
	q.assertReadOnly(t)
}

func TestLookupCode_FallsBackToReferralLinks(t *testing.T) {
	q := &recordingQuerier{finance: noRow, link: row("SPOT-LINK01", time.Now()), pu: noRow}
	code, src, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if err != nil || code != "SPOT-LINK01" || src != "referral_links" {
		t.Fatalf("got %q %q %v", code, src, err)
	}
	q.assertReadOnly(t)
}

func TestLookupCode_FallsBackToPlatformUsers(t *testing.T) {
	q := &recordingQuerier{finance: noRow, link: noRow, pu: scriptedRow{vals: []any{"PU-CODE"}}}
	code, src, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if err != nil || code != "PU-CODE" || src != "platform_users" {
		t.Fatalf("got %q %q %v", code, src, err)
	}
	q.assertReadOnly(t)
}

func TestLookupCode_ErrNoCodeAndNoWrites(t *testing.T) {
	q := &recordingQuerier{finance: noRow, link: noRow, pu: noRow}
	_, _, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if !errors.Is(err, ErrNoCode) {
		t.Fatalf("want ErrNoCode, got %v", err)
	}
	q.assertReadOnly(t)
}

func TestLookupCode_EmptyPlatformUserCodeIsNoCode(t *testing.T) {
	q := &recordingQuerier{finance: noRow, link: noRow, pu: scriptedRow{vals: []any{""}}}
	_, _, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if !errors.Is(err, ErrNoCode) {
		t.Fatalf("want ErrNoCode, got %v", err)
	}
}

func TestLookupCode_DivergentLinkOlderWins(t *testing.T) {
	now := time.Now()
	q := &recordingQuerier{finance: row("SPOT-NEWER1", now), link: row("SPOT-OLDER1", now.Add(-time.Hour)), pu: noRow}
	code, src, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if err != nil || code != "SPOT-OLDER1" || src != "referral_links" {
		t.Fatalf("got %q %q %v", code, src, err)
	}
	q.assertReadOnly(t)
}

func TestLookupCode_DivergentFinanceOlderWins(t *testing.T) {
	now := time.Now()
	q := &recordingQuerier{finance: row("SPOT-OLDER1", now.Add(-time.Hour)), link: row("SPOT-NEWER1", now), pu: noRow}
	code, src, _ := newLookupSvc(q).LookupCode(context.Background(), "u1")
	if code != "SPOT-OLDER1" || src != "finance_referral_codes" {
		t.Fatalf("got %q %q", code, src)
	}
}

func TestLookupCode_DBErrorReturned(t *testing.T) {
	boom := errors.New("connection reset")
	for name, q := range map[string]*recordingQuerier{
		"finance":  {finance: scriptedRow{err: boom}, link: noRow, pu: noRow},
		"link":     {finance: noRow, link: scriptedRow{err: boom}, pu: noRow},
		"platform": {finance: noRow, link: noRow, pu: scriptedRow{err: boom}},
	} {
		_, _, err := newLookupSvc(q).LookupCode(context.Background(), "u1")
		if !errors.Is(err, boom) || errors.Is(err, ErrNoCode) {
			t.Fatalf("%s: want boom, got %v", name, err)
		}
	}
}
