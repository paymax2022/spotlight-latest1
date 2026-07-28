package connectjobs

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// ── FSM guards (deny-by-default; illegal transitions rejected) ──────────────

func TestJobApplicationFSM(t *testing.T) {
	legal := map[AppState][]AppState{
		AppDraft:       {AppSubmitted, AppWithdrawn},
		AppSubmitted:   {AppUnderReview, AppWithdrawn},
		AppUnderReview: {AppNeedsInfo, AppShortlisted, AppRejected, AppWithdrawn},
		AppNeedsInfo:   {AppUnderReview, AppWithdrawn},
		AppShortlisted: {AppInterview, AppRejected, AppWithdrawn},
		AppInterview:   {AppOffered, AppRejected, AppWithdrawn},
		AppOffered:     {AppHired, AppRejected, AppWithdrawn},
	}
	all := []AppState{AppDraft, AppSubmitted, AppUnderReview, AppNeedsInfo, AppShortlisted,
		AppInterview, AppOffered, AppHired, AppRejected, AppWithdrawn}
	assertFSM(t, "application", all, legal, func(a, b AppState) bool { return validAppTransition(a, b) })

	// Terminal states allow nothing.
	for _, term := range []AppState{AppHired, AppRejected, AppWithdrawn} {
		for _, to := range all {
			if validAppTransition(term, to) {
				t.Errorf("terminal %s must not transition to %s", term, to)
			}
		}
	}
	// A submitted application cannot be re-submitted (supports one-active-application:
	// no legal path resurrects a used/terminal application into a second active one).
	if validAppTransition(AppSubmitted, AppSubmitted) {
		t.Error("submitted must not transition to submitted")
	}
	if validAppTransition(AppWithdrawn, AppSubmitted) {
		t.Error("withdrawn must not resurrect to submitted")
	}
}

func TestClaimFSM(t *testing.T) {
	legal := map[ClaimState][]ClaimState{
		ClaimSubmitted:     {ClaimUnderReview},
		ClaimUnderReview:   {ClaimNeedsMoreInfo, ClaimVerified, ClaimRejected},
		ClaimNeedsMoreInfo: {ClaimUnderReview},
	}
	all := []ClaimState{ClaimSubmitted, ClaimUnderReview, ClaimNeedsMoreInfo, ClaimVerified, ClaimRejected}
	assertFSM(t, "claim", all, legal, func(a, b ClaimState) bool { return validClaimTransition(a, b) })
	// verified/rejected terminal.
	for _, to := range all {
		if validClaimTransition(ClaimVerified, to) || validClaimTransition(ClaimRejected, to) {
			t.Error("verified/rejected claim states must be terminal")
		}
	}
}

func TestBountyFSM(t *testing.T) {
	legal := map[BountyState][]BountyState{
		BountyReferred:      {BountyAppLinked, BountyExpired},
		BountyAppLinked:     {BountyHireConfirmed, BountyExpired},
		BountyHireConfirmed: {BountyPayable},
		BountyPayable:       {BountyPaid},
	}
	all := []BountyState{BountyReferred, BountyAppLinked, BountyHireConfirmed, BountyPayable, BountyPaid, BountyExpired}
	assertFSM(t, "bounty", all, legal, func(a, b BountyState) bool { return validBountyTransition(a, b) })

	// Once a hire is confirmed, the bounty can NEVER expire (only pre-hire states can).
	if validBountyTransition(BountyHireConfirmed, BountyExpired) {
		t.Error("hire_confirmed must not be able to expire")
	}
	if validBountyTransition(BountyPayable, BountyExpired) {
		t.Error("bounty_payable must not be able to expire")
	}
	// paid/expired terminal.
	for _, to := range all {
		if validBountyTransition(BountyPaid, to) || validBountyTransition(BountyExpired, to) {
			t.Error("paid/expired must be terminal")
		}
	}
}

func TestJobFSM(t *testing.T) {
	legal := map[JobStatus][]JobStatus{
		JobDraft:         {JobPendingReview, JobActive, JobRejected},
		JobPendingReview: {JobActive, JobRejected},
		JobActive:        {JobClosed, JobRejected},
	}
	all := []JobStatus{JobDraft, JobPendingReview, JobActive, JobClosed, JobRejected}
	assertFSM(t, "job", all, legal, func(a, b JobStatus) bool { return validJobTransition(a, b) })
}

// assertFSM checks a validTransition func against an explicit legal map: every legal
// pair is accepted, every other pair rejected (deny-by-default).
func assertFSM[S ~string](t *testing.T, name string, all []S, legal map[S][]S, fn func(S, S) bool) {
	t.Helper()
	legalSet := map[[2]S]bool{}
	for from, tos := range legal {
		for _, to := range tos {
			legalSet[[2]S{from, to}] = true
		}
	}
	for _, from := range all {
		for _, to := range all {
			want := legalSet[[2]S{from, to}]
			if got := fn(from, to); got != want {
				t.Errorf("%s: transition %v→%v: got %v want %v", name, from, to, got, want)
			}
		}
	}
}

// ── PN-2: single-level referral is structurally guaranteed ──────────────────

func TestPN2_NoSecondLevelBountyRepresentable(t *testing.T) {
	rt := reflect.TypeOf(ReferralBounty{})
	for i := 0; i < rt.NumField(); i++ {
		name := strings.ToLower(rt.Field(i).Name)
		// No field may reference a parent bounty / referrer chain / upline — a
		// referral-of-referral must be impossible to represent (PN-2).
		for _, banned := range []string{"parent", "chain", "upline", "referredby", "sourcebounty", "level"} {
			if strings.Contains(name, banned) {
				t.Fatalf("PN-2 violation: ReferralBounty must not have a %q-like field, found %q", banned, rt.Field(i).Name)
			}
		}
	}
	// The referral is tied to exactly one application id and one referrer — no
	// collection of child referrals.
	if _, ok := rt.FieldByName("JobApplicationID"); !ok {
		t.Fatal("ReferralBounty must tie to a single job application")
	}
}

// ── Test doubles for the money/loyalty ports ────────────────────────────────

type fakeWallet struct {
	calls  int
	amount int64
}

func (f *fakeWallet) Debit(_ context.Context, _, _, _, _ string, amountKobo int64) error {
	f.calls++
	f.amount = amountKobo
	return nil
}

type creditCall struct {
	userID, ref, idemKey, acc string
	amount                    int64
}
type fakeLedger struct{ calls []creditCall }

func (f *fakeLedger) Credit(_ context.Context, userID, ref, idemKey, debitAccountID string, amountKobo int64) error {
	f.calls = append(f.calls, creditCall{userID, ref, idemKey, debitAccountID, amountKobo})
	return nil
}

type fakeAccounts struct{}

func (fakeAccounts) RevenueAccountID(context.Context) (string, error)         { return "acct-revenue", nil }
func (fakeAccounts) ReferralExpenseAccountID(context.Context) (string, error) { return "acct-ref-exp", nil }

type awardCall struct{ userID, module, trigger, ref string }
type fakeLoyalty struct{ awards []awardCall }

func (f *fakeLoyalty) AwardFor(_ context.Context, userID, module, trigger, ref string) error {
	f.awards = append(f.awards, awardCall{userID, module, trigger, ref})
	return nil
}

type fakeAudit struct{ count int }

func (f *fakeAudit) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	f.count++
	return nil
}

// newTestService builds a service whose DB-backed seams are overridden, so money/state
// logic runs without a live database.
func newTestService(w WalletDebiter, l LedgerCrediter, loy LoyaltyAwarder) *Service {
	return NewService(&Repository{}, w, l, fakeAccounts{}, loy, &fakeAudit{})
}

// ── PN-6: unverified company page blocked from paid posting ─────────────────

func TestPN6_UnverifiedCompanyBlockedFromPaidPosting(t *testing.T) {
	w := &fakeWallet{}
	s := newTestService(w, &fakeLedger{}, &fakeLoyalty{})
	s.hasGrantFn = func(context.Context, string, string, ...string) (bool, error) { return true, nil }
	s.getJobFn = func(context.Context, string) (*Job, error) {
		return &Job{ID: "job1", CompanyPageID: "cp1", Status: string(JobDraft), FeeKobo: 500000}, nil
	}
	s.claimStateFn = func(context.Context, string) (ClaimState, error) { return ClaimUnderReview, nil }

	_, err := s.ActivateJob(context.Background(), "recruiter1", "cp1", "job1", "idem-1")
	if !errors.Is(err, ErrCompanyNotVerified) {
		t.Fatalf("expected ErrCompanyNotVerified, got %v", err)
	}
	if w.calls != 0 {
		t.Fatalf("wallet must NOT be debited when company unverified, got %d debits", w.calls)
	}

	// Even verified, a paid posting still requires the Idempotency-Key (money path).
	s.claimStateFn = func(context.Context, string) (ClaimState, error) { return ClaimVerified, nil }
	_, err = s.ActivateJob(context.Background(), "recruiter1", "cp1", "job1", "")
	if !errors.Is(err, ErrMissingIdem) {
		t.Fatalf("expected ErrMissingIdem for paid posting without key, got %v", err)
	}
	if w.calls != 0 {
		t.Fatalf("wallet must not be debited without idem key, got %d", w.calls)
	}
}

// ── PN-10: bounty payout is a ledger write, idempotent by bounty id ─────────

func TestPN10_BountyPayoutLedgerWriteAndIdempotent(t *testing.T) {
	w := &fakeWallet{}
	l := &fakeLedger{}
	loy := &fakeLoyalty{}
	s := newTestService(w, l, loy)

	const bountyID = "bounty-xyz"
	state := string(BountyHireConfirmed)
	var stampedRef string
	s.getBountyFn = func(_ context.Context, id string) (*ReferralBounty, error) {
		return &ReferralBounty{
			ID: bountyID, ReferrerUserID: "referrer1", JobApplicationID: "app1",
			AmountKobo: 250000, State: state, LedgerEntryRef: stampedRef,
		}, nil
	}
	s.markBountyPaid = func(_ context.Context, id, ledgerRef string) (bool, error) {
		if id != bountyID {
			t.Fatalf("markBountyPaid wrong id %q", id)
		}
		state = string(BountyPaid) // guarded projection transition
		stampedRef = ledgerRef
		return true, nil
	}

	// First payout — writes exactly one ledger credit keyed by the bounty id.
	b, err := s.PayReferralBounty(context.Background(), "actor1", bountyID)
	if err != nil {
		t.Fatalf("first payout: %v", err)
	}
	if len(l.calls) != 1 {
		t.Fatalf("expected exactly 1 ledger credit, got %d", len(l.calls))
	}
	if l.calls[0].idemKey != bountyID {
		t.Errorf("PN-10: ledger idempotency key must be the bounty id, got %q", l.calls[0].idemKey)
	}
	if l.calls[0].userID != "referrer1" || l.calls[0].amount != 250000 {
		t.Errorf("credit must pay the referrer the bounty amount, got %+v", l.calls[0])
	}
	if l.calls[0].acc != "acct-ref-exp" {
		t.Errorf("credit counterpart must be the referral expense account, got %q", l.calls[0].acc)
	}
	if b.State != string(BountyPaid) || b.LedgerEntryRef == "" {
		t.Errorf("bounty must be PAID with a ledger_entry_ref, got state=%s ref=%q", b.State, b.LedgerEntryRef)
	}
	if len(loy.awards) != 1 || loy.awards[0].trigger != "referral_bounty_paid" {
		t.Errorf("expected one referral_bounty_paid loyalty award, got %+v", loy.awards)
	}

	// Second payout — idempotent no-op: no second ledger credit, no second loyalty award.
	if _, err := s.PayReferralBounty(context.Background(), "actor1", bountyID); err != nil {
		t.Fatalf("second payout should be a no-op, got %v", err)
	}
	if len(l.calls) != 1 {
		t.Fatalf("PN-10: retry must NOT double-credit, got %d credits", len(l.calls))
	}
	if len(loy.awards) != 1 {
		t.Fatalf("retry must not re-award loyalty, got %d", len(loy.awards))
	}
}

// ── Referral creation rejects non-positive amounts (integer kobo) ───────────

func TestCreateReferralRejectsNonPositive(t *testing.T) {
	s := newTestService(&fakeWallet{}, &fakeLedger{}, &fakeLoyalty{})
	if _, err := s.CreateReferral(context.Background(), "referrer1", "app1", ReferInput{AmountKobo: 0}); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("expected ErrInvalidAmount for zero bounty, got %v", err)
	}
}

// ── PN-10 guard: paying a bounty not yet hire-confirmed is illegal ──────────

func TestPayBountyIllegalBeforeHireConfirmed(t *testing.T) {
	l := &fakeLedger{}
	s := newTestService(&fakeWallet{}, l, &fakeLoyalty{})
	s.getBountyFn = func(context.Context, string) (*ReferralBounty, error) {
		return &ReferralBounty{ID: "b1", ReferrerUserID: "r1", AmountKobo: 1000, State: string(BountyAppLinked)}, nil
	}
	if _, err := s.PayReferralBounty(context.Background(), "actor1", "b1"); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected ErrIllegalTransition paying a not-yet-confirmed bounty, got %v", err)
	}
	if len(l.calls) != 0 {
		t.Fatalf("no ledger credit may be posted for an illegal payout, got %d", len(l.calls))
	}
}
