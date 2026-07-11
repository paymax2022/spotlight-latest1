package connectnetprofile

import (
	"strings"
	"testing"
)

// TestValidTransition locks the PN-4 recommendation FSM:
//
//	DRAFTED → SENT → ACCEPTED_VISIBLE | DECLINED_HIDDEN
//
// Every other edge is denied — in particular there is NO edge that reaches
// accepted_visible except from sent (i.e. the subject's explicit accept), so a
// recommendation can never auto-publish.
func TestValidTransition(t *testing.T) {
	cases := []struct {
		from, to RecoState
		want     bool
	}{
		{RecoDrafted, RecoSent, true},
		{RecoSent, RecoAcceptedVisible, true},
		{RecoSent, RecoDeclinedHidden, true},

		// Never auto-publish: drafted cannot jump straight to visible.
		{RecoDrafted, RecoAcceptedVisible, false},
		{RecoDrafted, RecoDeclinedHidden, false},
		// No-ops and backwards edges are denied.
		{RecoDrafted, RecoDrafted, false},
		{RecoSent, RecoSent, false},
		{RecoSent, RecoDrafted, false},
		// Terminal states cannot flip.
		{RecoAcceptedVisible, RecoDeclinedHidden, false},
		{RecoAcceptedVisible, RecoSent, false},
		{RecoDeclinedHidden, RecoAcceptedVisible, false},
		{RecoDeclinedHidden, RecoSent, false},
	}
	for _, c := range cases {
		if got := validTransition(c.from, c.to); got != c.want {
			t.Errorf("validTransition(%s->%s)=%v want %v", c.from, c.to, got, c.want)
		}
	}
}

// TestPubliclyVisible is the PN-4 visibility invariant at the predicate level: a
// recommendation is publicly visible ONLY in accepted_visible. drafted/sent/
// declined are never visible to the public read path.
func TestPubliclyVisible(t *testing.T) {
	visible := map[RecoState]bool{
		RecoDrafted:         false,
		RecoSent:            false,
		RecoDeclinedHidden:  false,
		RecoAcceptedVisible: true,
	}
	for state, want := range visible {
		if got := PubliclyVisible(state); got != want {
			t.Errorf("PubliclyVisible(%s)=%v want %v", state, got, want)
		}
	}
}

// TestPublicQueryFiltersAcceptedOnly asserts the PUBLIC read SQL (RC-03) hard-codes
// the accepted_visible filter and never references the pending/hidden states — the
// query-level half of the PN-4 enforcement pair (the RLS reader policy is the other).
func TestPublicQueryFiltersAcceptedOnly(t *testing.T) {
	if !strings.Contains(qListAcceptedForSubject, "state='accepted_visible'") {
		t.Fatalf("public recommendation query must filter state='accepted_visible'; got:\n%s", qListAcceptedForSubject)
	}
	for _, forbidden := range []string{"'drafted'", "'sent'", "'declined_hidden'"} {
		if strings.Contains(qListAcceptedForSubject, forbidden) {
			t.Errorf("public recommendation query must not reference %s (PN-4 leak)", forbidden)
		}
	}
}

// TestCheckRespond_SubjectOnly encodes PN-4 authz: ONLY the subject may accept or
// decline a sent recommendation. The author (or any third party) is rejected with
// ErrNotSubject even when the FSM edge would otherwise be legal.
func TestCheckRespond_SubjectOnly(t *testing.T) {
	const subject, author, stranger = "u-subject", "u-author", "u-stranger"

	// Subject accepting a sent recommendation: allowed.
	if err := checkRespond(subject, subject, RecoSent, RecoAcceptedVisible); err != nil {
		t.Errorf("subject accept: unexpected error %v", err)
	}
	// Subject declining a sent recommendation: allowed.
	if err := checkRespond(subject, subject, RecoSent, RecoDeclinedHidden); err != nil {
		t.Errorf("subject decline: unexpected error %v", err)
	}
	// Author trying to accept (self-publish): denied — this is the core PN-4 guard.
	if err := checkRespond(author, subject, RecoSent, RecoAcceptedVisible); err != ErrNotSubject {
		t.Errorf("author accept: want ErrNotSubject, got %v", err)
	}
	// Stranger trying to accept: denied.
	if err := checkRespond(stranger, subject, RecoSent, RecoAcceptedVisible); err != ErrNotSubject {
		t.Errorf("stranger accept: want ErrNotSubject, got %v", err)
	}
	// Subject accepting a DRAFTED (not yet sent) recommendation: denied by FSM.
	if err := checkRespond(subject, subject, RecoDrafted, RecoAcceptedVisible); err != ErrBadTransition {
		t.Errorf("accept from drafted: want ErrBadTransition, got %v", err)
	}
	// Subject re-accepting an already-accepted recommendation: denied (terminal).
	if err := checkRespond(subject, subject, RecoAcceptedVisible, RecoAcceptedVisible); err != ErrBadTransition {
		t.Errorf("re-accept: want ErrBadTransition, got %v", err)
	}
}

// TestCheckSend_AuthorOnly: only the author may send DRAFTED → SENT.
func TestCheckSend_AuthorOnly(t *testing.T) {
	const author, subject = "u-author", "u-subject"
	if err := checkSend(author, author, RecoDrafted); err != nil {
		t.Errorf("author send: unexpected error %v", err)
	}
	if err := checkSend(subject, author, RecoDrafted); err != ErrNotAuthor {
		t.Errorf("subject send: want ErrNotAuthor, got %v", err)
	}
	if err := checkSend(author, author, RecoSent); err != ErrBadTransition {
		t.Errorf("send already-sent: want ErrBadTransition, got %v", err)
	}
}
