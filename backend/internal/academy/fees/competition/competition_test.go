package feescompetition

import (
	"context"
	"errors"
	"testing"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// ── In-memory fakes (no live DB) ────────────────────────────────────────────────

// fakeStore is an in-memory Store.
type fakeStore struct {
	comps map[string]*Competition
	regs  map[string][]CompetitionRegistration
	seq   int
}

func newFakeStore() *fakeStore {
	return &fakeStore{comps: map[string]*Competition{}, regs: map[string][]CompetitionRegistration{}}
}

func (f *fakeStore) CreateCompetition(_ context.Context, c *Competition) (*Competition, error) {
	f.seq++
	c.ID = "comp-" + itoa(f.seq)
	cp := *c
	f.comps[c.ID] = &cp
	out := cp
	return &out, nil
}
func (f *fakeStore) GetCompetition(_ context.Context, id string) (*Competition, error) {
	c, ok := f.comps[id]
	if !ok {
		return nil, errors.New("not_found")
	}
	out := *c
	return &out, nil
}
func (f *fakeStore) UpdateCompetitionStatus(_ context.Context, id string, status feesstatemachine.CompetitionState) error {
	c, ok := f.comps[id]
	if !ok {
		return errors.New("not_found")
	}
	c.Status = status
	return nil
}
func (f *fakeStore) RegisterSchool(_ context.Context, competitionID, schoolID string) (*CompetitionRegistration, error) {
	for _, r := range f.regs[competitionID] {
		if r.SchoolID == schoolID {
			return &r, nil // idempotent
		}
	}
	f.seq++
	reg := CompetitionRegistration{ID: "reg-" + itoa(f.seq), CompetitionID: competitionID, SchoolID: schoolID}
	f.regs[competitionID] = append(f.regs[competitionID], reg)
	return &reg, nil
}
func (f *fakeStore) ListRegistrations(_ context.Context, competitionID string) ([]CompetitionRegistration, error) {
	return f.regs[competitionID], nil
}

// fakeLadder is an in-memory GamificationLadder (mimics the shared gamification
// service through its public interface — proving reuse without a real table).
type fakeLadder struct {
	scores map[string]int64 // key: lbID|user|period
	rows   []LadderRow
}

func newFakeLadder() *fakeLadder { return &fakeLadder{scores: map[string]int64{}} }

func (l *fakeLadder) EnsureLeaderboard(_ context.Context, scope, scopeRef, subject string) (string, error) {
	return "lb:" + scope + ":" + scopeRef + ":" + subject, nil
}
func (l *fakeLadder) RecordScore(_ context.Context, lbID, userID, periodKey string, score int64) error {
	l.scores[lbID+"|"+userID+"|"+periodKey] += score
	l.rows = append(l.rows, LadderRow{UserID: userID, PeriodKey: periodKey, Score: score, Rank: len(l.rows) + 1})
	return nil
}
func (l *fakeLadder) RankedUserScores(_ context.Context, lbID, periodKey string, limit int) ([]LadderRow, error) {
	return l.rows, nil
}

// fakeIdentity is an in-memory IdentityResolver.
type fakeIdentity struct {
	byUser map[string]StudentIdentity
}

func (i *fakeIdentity) ResolveStudent(_ context.Context, userID string) (StudentIdentity, error) {
	id, ok := i.byUser[userID]
	if !ok {
		return StudentIdentity{}, errors.New("not_found")
	}
	return id, nil
}

// fakeConsent is an in-memory ConsentChecker. granted[user|scope] = true.
type fakeConsent struct {
	granted map[string]bool
	err     error
}

func (c *fakeConsent) HasActiveConsent(_ context.Context, minorUserID, scopeKey string) (bool, error) {
	if c.err != nil {
		return false, c.err
	}
	return c.granted[minorUserID+"|"+scopeKey], nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func newService() (*Service, *fakeStore, *fakeLadder, *fakeIdentity) {
	store := newFakeStore()
	ladder := newFakeLadder()
	ident := &fakeIdentity{byUser: map[string]StudentIdentity{}}
	svc := NewService(store, NewLeaderboardManager(ladder, ident))
	return svc, store, ladder, ident
}

func strptr(s string) *string { return &s }

// ═══════════════════════════════════════════════════════════════════════════════
// SF-7 (RELEASE BLOCKER) — minor-safe serializer
// ═══════════════════════════════════════════════════════════════════════════════

func minorEntry() LeaderboardEntry {
	return LeaderboardEntry{
		StudentID:     "stu-1",
		StudentUserID: "user-minor",
		FirstName:     "Ada",
		LastName:      "Okonkwo",
		PhotoURL:      "https://cdn/ada.jpg",
		MinorFlag:     true,
		SchoolID:      "sch-1",
		SchoolName:    "Bright Stars Academy",
		Scope:         ScopeNational,
		Subject:       strptr("Mathematics"),
		Rank:          1,
		Score:         980,
	}
}

// SF-7: a minor WITHOUT consent must be stripped to first-name + school only.
func TestSF7_MinorWithoutConsent_IsStripped(t *testing.T) {
	ser := NewSerializer(&fakeConsent{granted: map[string]bool{}})
	got := ser.SerializeEntry(context.Background(), minorEntry())

	if got.FirstName != "Ada" {
		t.Fatalf("first name should be present, got %q", got.FirstName)
	}
	if got.SchoolName != "Bright Stars Academy" {
		t.Fatalf("school should be present, got %q", got.SchoolName)
	}
	if got.LastName != "" {
		t.Errorf("SF-7 VIOLATION: surname leaked without consent: %q", got.LastName)
	}
	if got.PhotoURL != "" {
		t.Errorf("SF-7 VIOLATION: photo leaked without consent: %q", got.PhotoURL)
	}
	if got.FullIdentity {
		t.Errorf("SF-7 VIOLATION: FullIdentity=true without consent")
	}
	// rank/score are non-PII engagement signals and are allowed.
	if got.Score != 980 || got.Rank != 1 {
		t.Errorf("rank/score should survive stripping: score=%d rank=%d", got.Score, got.Rank)
	}
}

// SF-7: with recorded consent, full identity is allowed.
func TestSF7_MinorWithConsent_FullIdentity(t *testing.T) {
	ser := NewSerializer(&fakeConsent{granted: map[string]bool{
		"user-minor|" + LeaderboardConsentScope: true,
	}})
	got := ser.SerializeEntry(context.Background(), minorEntry())

	if !got.FullIdentity {
		t.Fatalf("consented minor should get FullIdentity=true")
	}
	if got.LastName != "Okonkwo" {
		t.Errorf("consented minor should include surname, got %q", got.LastName)
	}
	if got.PhotoURL == "" {
		t.Errorf("consented minor should include photo")
	}
}

// SF-7: nil consent checker fails CLOSED (stripped), never open.
func TestSF7_NilChecker_FailsClosed(t *testing.T) {
	ser := NewSerializer(nil)
	got := ser.SerializeEntry(context.Background(), minorEntry())
	if got.FullIdentity || got.LastName != "" || got.PhotoURL != "" {
		t.Fatalf("SF-7 VIOLATION: nil checker must fail-closed, got %+v", got)
	}
}

// SF-7: a consent-lookup ERROR fails CLOSED (stripped), never open.
func TestSF7_ConsentError_FailsClosed(t *testing.T) {
	ser := NewSerializer(&fakeConsent{err: errors.New("db down")})
	got := ser.SerializeEntry(context.Background(), minorEntry())
	if got.FullIdentity || got.LastName != "" || got.PhotoURL != "" {
		t.Fatalf("SF-7 VIOLATION: consent error must fail-closed, got %+v", got)
	}
}

// SF-7: non-minor is always full identity.
func TestSF7_Adult_FullIdentity(t *testing.T) {
	e := minorEntry()
	e.MinorFlag = false
	ser := NewSerializer(&fakeConsent{granted: map[string]bool{}})
	got := ser.SerializeEntry(context.Background(), e)
	if !got.FullIdentity || got.LastName == "" {
		t.Fatalf("adult should get full identity, got %+v", got)
	}
}

// SF-7 (DoD): an EXPLICIT attempt to fetch a minor's full identity WITHOUT consent
// must be REJECTED (not silently returned with empty fields).
func TestSF7_ExplicitFullIdentityWithoutConsent_Rejected(t *testing.T) {
	ser := NewSerializer(&fakeConsent{granted: map[string]bool{}})
	_, err := ser.SerializeFullIdentity(context.Background(), minorEntry())
	if !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("SF-7 VIOLATION: explicit full-identity fetch without consent must reject, got err=%v", err)
	}
}

// SF-7 (DoD): explicit full-identity fetch WITH consent succeeds.
func TestSF7_ExplicitFullIdentityWithConsent_Allowed(t *testing.T) {
	ser := NewSerializer(&fakeConsent{granted: map[string]bool{
		"user-minor|" + LeaderboardConsentScope: true,
	}})
	got, err := ser.SerializeFullIdentity(context.Background(), minorEntry())
	if err != nil {
		t.Fatalf("consented explicit fetch should succeed, got err=%v", err)
	}
	if !got.FullIdentity || got.LastName != "Okonkwo" {
		t.Fatalf("consented explicit fetch should return full identity, got %+v", got)
	}
}

// SF-7: full-list serialization strips minors and shows adults independently, and
// one row's outcome never leaks another's PII.
func TestSF7_List_MixedMinorAdult(t *testing.T) {
	minor := minorEntry()
	adult := minorEntry()
	adult.StudentUserID = "user-adult"
	adult.FirstName = "Bola"
	adult.LastName = "Adeyemi"
	adult.MinorFlag = false
	adult.Rank = 2

	ser := NewSerializer(&fakeConsent{granted: map[string]bool{}})
	out := ser.SerializeList(context.Background(), []LeaderboardEntry{minor, adult})
	if len(out) != 2 {
		t.Fatalf("want 2 rows, got %d", len(out))
	}
	if out[0].LastName != "" || out[0].PhotoURL != "" || out[0].FullIdentity {
		t.Errorf("SF-7 VIOLATION: minor row not stripped in list: %+v", out[0])
	}
	if !out[1].FullIdentity || out[1].LastName != "Adeyemi" {
		t.Errorf("adult row should be full in list: %+v", out[1])
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Competition state machine (§3.4)
// ═══════════════════════════════════════════════════════════════════════════════

// Legal linear path succeeds end-to-end.
func TestCompetition_LegalPath(t *testing.T) {
	svc, _, _, _ := newService()
	ctx := context.Background()
	c, err := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Status != feesstatemachine.CompetitionDraft {
		t.Fatalf("new competition should be draft, got %s", c.Status)
	}
	path := []struct {
		event string
		want  feesstatemachine.CompetitionState
	}{
		{"open_registration", feesstatemachine.CompetitionOpenRegistration},
		{"close_registration", feesstatemachine.CompetitionRegistrationClosed},
		{"start", feesstatemachine.CompetitionInProgress},
		{"pend_results", feesstatemachine.CompetitionResultsPending},
		{"complete", feesstatemachine.CompetitionCompleted},
		{"archive", feesstatemachine.CompetitionArchived},
	}
	for _, step := range path {
		got, err := svc.Transition(ctx, c.ID, step.event)
		if err != nil {
			t.Fatalf("event %q: unexpected err %v", step.event, err)
		}
		if got.Status != step.want {
			t.Fatalf("after %q want %s got %s", step.event, step.want, got.Status)
		}
	}
}

// Illegal skip (draft -> start) is rejected.
func TestCompetition_IllegalSkip_Rejected(t *testing.T) {
	svc, _, _, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	if _, err := svc.Transition(ctx, c.ID, "start"); err == nil {
		t.Fatal("draft->start skip must be rejected")
	} else if !errors.Is(err, feesstatemachine.ErrIllegalTransition) {
		t.Fatalf("want illegal_transition, got %v", err)
	}
}

// Backward move is rejected.
func TestCompetition_Backward_Rejected(t *testing.T) {
	svc, _, _, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	if _, err := svc.Transition(ctx, c.ID, "open_registration"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Transition(ctx, c.ID, "close_registration"); err != nil {
		t.Fatal(err)
	}
	// now registration_closed; firing open_registration again would be a backward
	// target (open_registration is behind registration_closed) → illegal.
	if _, err := svc.Transition(ctx, c.ID, "open_registration"); err == nil {
		t.Fatal("backward move must be rejected")
	} else if !errors.Is(err, feesstatemachine.ErrIllegalTransition) {
		t.Fatalf("want illegal_transition, got %v", err)
	}
}

// Registration is allowed only while open_registration; rejected after close.
func TestCompetition_RegistrationAfterClose_Rejected(t *testing.T) {
	svc, _, _, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})

	// Cannot register in draft.
	if _, err := svc.Register(ctx, c.ID, "sch-1"); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("register in draft should be rejected, got %v", err)
	}

	// Open registration → allowed.
	if _, err := svc.Transition(ctx, c.ID, "open_registration"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Register(ctx, c.ID, "sch-1"); err != nil {
		t.Fatalf("register while open should succeed, got %v", err)
	}
	// Idempotent repeat.
	if _, err := svc.Register(ctx, c.ID, "sch-1"); err != nil {
		t.Fatalf("repeat register should be idempotent, got %v", err)
	}

	// Close registration → now rejected.
	if _, err := svc.Transition(ctx, c.ID, "close_registration"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Register(ctx, c.ID, "sch-2"); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("register after registration_closed must be rejected, got %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scoring lock (§3.4) — no leaderboard entry once results_pending or later
// ═══════════════════════════════════════════════════════════════════════════════

func advanceTo(t *testing.T, svc *Service, ctx context.Context, id string, events ...string) {
	t.Helper()
	for _, ev := range events {
		if _, err := svc.Transition(ctx, id, ev); err != nil {
			t.Fatalf("advance %q: %v", ev, err)
		}
	}
}

// Scores may be recorded up to (and including) in_progress.
func TestScoringLock_AllowedBeforeResultsPending(t *testing.T) {
	svc, _, ladder, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	advanceTo(t, svc, ctx, c.ID, "open_registration", "close_registration", "start") // in_progress

	err := svc.RecordScore(ctx, c.ID, RecordScoreRequest{
		StudentID: "stu-1", StudentUserID: "user-minor", SchoolID: "sch-1",
		Scope: "national", PeriodKey: "2026", Score: 100,
	})
	if err != nil {
		t.Fatalf("score before results_pending should succeed, got %v", err)
	}
	if len(ladder.rows) != 1 {
		t.Fatalf("score should have been written to the shared ladder, rows=%d", len(ladder.rows))
	}
}

// Scores are LOCKED once results_pending.
func TestScoringLock_RejectedAtResultsPending(t *testing.T) {
	svc, _, ladder, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	advanceTo(t, svc, ctx, c.ID, "open_registration", "close_registration", "start", "pend_results")

	err := svc.RecordScore(ctx, c.ID, RecordScoreRequest{
		StudentID: "stu-1", StudentUserID: "user-minor", SchoolID: "sch-1",
		Scope: "national", PeriodKey: "2026", Score: 100,
	})
	if !errors.Is(err, ErrScoringLocked) {
		t.Fatalf("score at results_pending must be rejected with scoring_locked, got %v", err)
	}
	if len(ladder.rows) != 0 {
		t.Fatalf("no row should be written once locked, rows=%d", len(ladder.rows))
	}
}

// Scores stay locked at completed and archived (later states).
func TestScoringLock_RejectedAtCompletedAndArchived(t *testing.T) {
	svc, _, _, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	advanceTo(t, svc, ctx, c.ID, "open_registration", "close_registration", "start", "pend_results", "complete")

	req := RecordScoreRequest{StudentID: "stu-1", StudentUserID: "u", SchoolID: "sch-1", Scope: "national", PeriodKey: "2026", Score: 5}
	if err := svc.RecordScore(ctx, c.ID, req); !errors.Is(err, ErrScoringLocked) {
		t.Fatalf("completed must be locked, got %v", err)
	}
	advanceTo(t, svc, ctx, c.ID, "archive")
	if err := svc.RecordScore(ctx, c.ID, req); !errors.Is(err, ErrScoringLocked) {
		t.Fatalf("archived must be locked, got %v", err)
	}
}

// Sanity: the scoring-lock boundary the leaderboard uses is exactly the state
// machine's ScoringLocked predicate (no drift).
func TestScoringLock_MatchesStateMachineBoundary(t *testing.T) {
	locked := map[feesstatemachine.CompetitionState]bool{
		feesstatemachine.CompetitionDraft:              false,
		feesstatemachine.CompetitionOpenRegistration:   false,
		feesstatemachine.CompetitionRegistrationClosed: false,
		feesstatemachine.CompetitionInProgress:         false,
		feesstatemachine.CompetitionResultsPending:     true,
		feesstatemachine.CompetitionCompleted:          true,
		feesstatemachine.CompetitionArchived:           true,
	}
	for st, want := range locked {
		if got := feesstatemachine.ScoringLocked(st); got != want {
			t.Errorf("ScoringLocked(%s)=%v want %v", st, got, want)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Leaderboard reuse — read path enriches shared ladder rows and applies SF-7
// ═══════════════════════════════════════════════════════════════════════════════

// End-to-end: write a score via the shared ladder, read it back enriched, then
// serialize — proving the extension reuses gamification and SF-7 still applies.
func TestLeaderboard_ReuseAndSerialize(t *testing.T) {
	svc, _, _, ident := newService()
	ident.byUser["user-minor"] = StudentIdentity{
		StudentID: "stu-1", FirstName: "", LastName: "", MinorFlag: true,
		SchoolID: "sch-1", SchoolName: "Bright Stars Academy",
	}
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national", Subject: strptr("Mathematics")})
	advanceTo(t, svc, ctx, c.ID, "open_registration", "close_registration", "start")
	if err := svc.RecordScore(ctx, c.ID, RecordScoreRequest{
		StudentID: "stu-1", StudentUserID: "user-minor", SchoolID: "sch-1",
		Scope: "national", Subject: strptr("Mathematics"), PeriodKey: "2026", Score: 42,
	}); err != nil {
		t.Fatal(err)
	}

	raw, err := svc.ReadLeaderboard(ctx, c.ID, "sch-1", "Mathematics", "2026", ScopeNational, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != 1 || raw[0].Score != 42 || raw[0].SchoolName != "Bright Stars Academy" {
		t.Fatalf("read-back enrichment wrong: %+v", raw)
	}
	// SF-7 still governs the public projection of the reused ladder row.
	ser := NewSerializer(&fakeConsent{granted: map[string]bool{}})
	safe := ser.SerializeList(ctx, raw)
	if safe[0].FullIdentity {
		t.Fatal("SF-7 VIOLATION: reused ladder minor row not stripped")
	}
}

// Invalid scope is rejected at both write and read.
func TestLeaderboard_InvalidScope_Rejected(t *testing.T) {
	svc, _, _, _ := newService()
	ctx := context.Background()
	c, _ := svc.Create(ctx, CreateCompetitionRequest{Name: "Cup", Scope: "national"})
	advanceTo(t, svc, ctx, c.ID, "open_registration", "close_registration", "start")
	if err := svc.RecordScore(ctx, c.ID, RecordScoreRequest{
		StudentUserID: "u", SchoolID: "s", Scope: "planet", PeriodKey: "2026",
	}); !errors.Is(err, ErrScopeInvalid) {
		t.Fatalf("invalid scope write should reject, got %v", err)
	}
	if _, err := svc.ReadLeaderboard(ctx, c.ID, "s", "", "2026", Scope("planet"), 10); !errors.Is(err, ErrScopeInvalid) {
		t.Fatalf("invalid scope read should reject, got %v", err)
	}
}
