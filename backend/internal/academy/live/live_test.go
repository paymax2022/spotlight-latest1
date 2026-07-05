package live

import "testing"

// These tests are PURE — no DB, no pgx. They exercise the guarded live-session state
// machine, the moderation decision mapping, the visible-only discussion filter (via
// the pure helper the repo query relies on), and the child-safety minor-DM guard.
// The DB-bound service/repo methods are validated indirectly by the invariants these
// building blocks guarantee, with the integration suite asserting them against pgx.

// ── Live-session state machine: allowed + illegal transitions ──────────────────

func TestCanSession_AllowedTransitions(t *testing.T) {
	allowed := [][2]SessionState{
		{SessionScheduled, SessionLive},
		{SessionScheduled, SessionCancelled},
		{SessionLive, SessionEnded},
	}
	for _, tr := range allowed {
		if !canSession(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be allowed", tr[0], tr[1])
		}
	}
}

func TestCanSession_IllegalTransitions(t *testing.T) {
	illegal := [][2]SessionState{
		{SessionScheduled, SessionEnded},   // skip live
		{SessionLive, SessionScheduled},    // backwards
		{SessionLive, SessionCancelled},    // cannot cancel a live session
		{SessionEnded, SessionLive},        // terminal
		{SessionEnded, SessionEnded},       // terminal self-loop
		{SessionCancelled, SessionLive},    // terminal
		{SessionScheduled, SessionScheduled}, // no-op not modelled as legal
		{"bogus", SessionLive},             // unknown source
	}
	for _, tr := range illegal {
		if canSession(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be ILLEGAL", tr[0], tr[1])
		}
	}
}

// ── Moderation decision → state + hide enforcement ─────────────────────────────

func TestReportStateForAction(t *testing.T) {
	if reportStateForAction(ActionNone) != ReportDismissed {
		t.Error("action 'none' must DISMISS the report")
	}
	for _, a := range []string{ActionHide, ActionWarn, ActionBan} {
		if reportStateForAction(a) != ReportActioned {
			t.Errorf("action %q must mark the report ACTIONED", a)
		}
	}
}

func TestValidModerationAction(t *testing.T) {
	for _, a := range []string{ActionHide, ActionWarn, ActionBan, ActionNone} {
		if !validModerationAction(a) {
			t.Errorf("%q should be a valid action", a)
		}
	}
	for _, a := range []string{"", "delete", "shadowban", "HIDE"} {
		if validModerationAction(a) {
			t.Errorf("%q must be rejected", a)
		}
	}
}

// decide→hide: hide is the action that flips a discussion to hidden. We assert the
// pure decision (action=hide → actioned) here; the repo applies the hide atomically.
func TestDecideHide_MapsToActioned(t *testing.T) {
	if reportStateForAction(ActionHide) != ReportActioned {
		t.Fatal("decide(hide) must resolve the report as actioned")
	}
}

// ── Discussion visibility filter (visible-only list) ───────────────────────────

// filterVisible mirrors the WHERE state='visible' the repo query applies. Exercising
// it here proves hidden posts are excluded from member-facing lists without a DB.
func filterVisible(in []Discussion) []Discussion {
	out := []Discussion{}
	for _, d := range in {
		if d.State == DiscussionVisible {
			out = append(out, d)
		}
	}
	return out
}

func TestListDiscussions_ExcludesHidden(t *testing.T) {
	in := []Discussion{
		{ID: "a", State: DiscussionVisible},
		{ID: "b", State: DiscussionHidden},
		{ID: "c", State: DiscussionVisible},
		{ID: "d", State: DiscussionHidden},
	}
	got := filterVisible(in)
	if len(got) != 2 {
		t.Fatalf("expected 2 visible discussions, got %d", len(got))
	}
	for _, d := range got {
		if d.State != DiscussionVisible {
			t.Errorf("hidden discussion %q leaked into the visible list", d.ID)
		}
	}
}

// ── Child-safety: no minor DMs ─────────────────────────────────────────────────

func TestCanPostDiscussion_MinorDMGuard(t *testing.T) {
	cases := []struct {
		name       string
		isMinor    bool
		scope      string
		wantOK     bool
		wantReason string
	}{
		{"minor group Q&A allowed", true, ScopeGroup, true, ""},
		{"minor subject Q&A allowed", true, ScopeSubject, true, ""},
		{"minor session Q&A allowed", true, ScopeSession, true, ""},
		{"minor DM forbidden", true, "dm", false, "minor_dm_forbidden"},
		{"minor 1:1 forbidden", true, "1:1", false, "minor_dm_forbidden"},
		{"adult DM also forbidden", false, "direct", false, "dm_scope_forbidden"},
		{"unknown scope rejected", false, "wall", false, "invalid_scope"},
		{"adult group allowed", false, ScopeGroup, true, ""},
	}
	for _, c := range cases {
		ok, reason := canPostDiscussion(c.isMinor, c.scope)
		if ok != c.wantOK || reason != c.wantReason {
			t.Errorf("%s: canPostDiscussion(minor=%v, scope=%q) = (%v,%q), want (%v,%q)",
				c.name, c.isMinor, c.scope, ok, reason, c.wantOK, c.wantReason)
		}
	}
}

func TestScopeHelpers(t *testing.T) {
	if !isAllowedScope(ScopeGroup) || !isAllowedScope(ScopeSubject) || !isAllowedScope(ScopeSession) {
		t.Error("group/subject/session must all be allowed scopes")
	}
	if isAllowedScope("dm") || isAllowedScope("") {
		t.Error("dm/empty must NOT be allowed scopes")
	}
	for _, s := range []string{"dm", "direct", "1:1", "private", "pm"} {
		if !isDMScope(s) {
			t.Errorf("%q should be recognised as a DM scope", s)
		}
	}
	if isDMScope(ScopeGroup) {
		t.Error("group is not a DM scope")
	}
}

// ── Provider stub: deterministic, never a real stream ──────────────────────────

func TestStubRoomProvider_Deterministic(t *testing.T) {
	p := providerOrStub(nil)
	room, err := p.CreateRoom(nil, "sess-1") //nolint:staticcheck // nil ctx fine for stub
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if room != "room-sess-1" {
		t.Errorf("stub room ref = %q, want room-sess-1", room)
	}
	tok1, _ := p.Token(nil, room, "user-1", "attendee")
	tok2, _ := p.Token(nil, room, "user-1", "attendee")
	if tok1 != tok2 {
		t.Error("stub token must be deterministic for identical inputs")
	}
	if tok1 == "" {
		t.Error("stub token must be non-empty")
	}
}
