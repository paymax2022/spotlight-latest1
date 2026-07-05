package tutor

import (
	"context"
	"testing"
)

// These tests are PURE — no DB, no pgx. They exercise the guarded payout state machine,
// the KYC verification gate, payout idempotency (double request = one rail call) and
// insufficient-balance rejection, and the DERIVED earnings-balance summation. The Service
// is driven through a small in-memory fake store + fake KYCChecker + counting PayoutRail.

// ── Payout SM: allowed + illegal ──────────────────────────────────────────────────

func TestCanPayout_Allowed(t *testing.T) {
	if !canPayout(PayoutRequested, PayoutPaid) {
		t.Error("requested→paid must be allowed")
	}
	if !canPayout(PayoutRequested, PayoutFailed) {
		t.Error("requested→failed must be allowed")
	}
}

func TestCanPayout_Illegal(t *testing.T) {
	illegal := [][2]PayoutState{
		{PayoutRequested, PayoutRequested}, // self-loop (replay is idem, not SM)
		{PayoutPaid, PayoutFailed},         // terminal
		{PayoutPaid, PayoutPaid},           // terminal self-loop
		{PayoutFailed, PayoutPaid},         // terminal
		{PayoutFailed, PayoutRequested},    // backwards from terminal
		{PayoutPaid, PayoutRequested},      // backwards from terminal
		{PayoutState("bogus"), PayoutPaid}, // unknown source
	}
	for _, tr := range illegal {
		if canPayout(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be ILLEGAL", tr[0], tr[1])
		}
	}
}

// ── In-memory fakes ────────────────────────────────────────────────────────────────

type fakeKYC struct {
	tier int
	err  error
}

func (f fakeKYC) Tier(context.Context, string) (int, error) { return f.tier, f.err }

type fakePayoutRail struct {
	calls map[string]int // idemKey → invocation count
	ref   string
	err   error
}

func newFakeRail() *fakePayoutRail {
	return &fakePayoutRail{calls: map[string]int{}, ref: "rail-ref"}
}

func (f *fakePayoutRail) Payout(_ context.Context, _, _, idemKey string, _ int64) (string, error) {
	f.calls[idemKey]++
	if f.err != nil {
		return "", f.err
	}
	return f.ref, nil
}

// fakeStore is a minimal in-memory tutorStore. It models only the behaviours the unit
// tests assert: tutor lookup, status flips, append-only earnings + derived SUM(pending),
// and the idempotent payout insert + guarded settle (covered earnings flip to paid).
type fakeStore struct {
	tutors     map[string]*Tutor   // by tutor id
	byUser     map[string]string   // user id → tutor id
	earnings   []Earning           // append-only
	payouts    map[string]*Payout  // by payout id
	byIdem     map[string]*Payout  // by idempotency key
	insertCnt  int
	settleCnt  int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		tutors:  map[string]*Tutor{},
		byUser:  map[string]string{},
		payouts: map[string]*Payout{},
		byIdem:  map[string]*Payout{},
	}
}

func (f *fakeStore) seedTutor(id, userID string, status TutorStatus) *Tutor {
	t := &Tutor{ID: id, UserID: userID, Status: status, Subjects: []string{}}
	f.tutors[id] = t
	f.byUser[userID] = id
	return t
}

func (f *fakeStore) seedPending(tutorID string, amount int64) {
	f.earnings = append(f.earnings, Earning{
		ID: "e-" + tutorID, TutorID: tutorID, Source: SourceClass, AmountMinor: amount, State: EarningPending,
	})
}

func (f *fakeStore) InsertTutor(_ context.Context, userID, bio string, subjects []string) (*Tutor, error) {
	if id, ok := f.byUser[userID]; ok {
		return f.tutors[id], nil
	}
	if subjects == nil {
		subjects = []string{}
	}
	t := &Tutor{ID: "t-" + userID, UserID: userID, Subjects: subjects, Status: TutorPending}
	if bio != "" {
		t.Bio = &bio
	}
	f.tutors[t.ID] = t
	f.byUser[userID] = t.ID
	return t, nil
}

func (f *fakeStore) GetTutor(_ context.Context, id string) (*Tutor, error) {
	if t, ok := f.tutors[id]; ok {
		return t, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) GetTutorByUser(_ context.Context, userID string) (*Tutor, error) {
	if id, ok := f.byUser[userID]; ok {
		return f.tutors[id], nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) ListTutors(_ context.Context, subject string) ([]Tutor, error) {
	out := []Tutor{}
	for _, t := range f.tutors {
		if t.Status != TutorVerified {
			continue
		}
		out = append(out, *t)
	}
	return out, nil
}

func (f *fakeStore) SetTutorStatus(_ context.Context, _, tutorID string, to TutorStatus, kycState string, _ map[string]any) (*Tutor, error) {
	t, ok := f.tutors[tutorID]
	if !ok {
		return nil, ErrNotFound
	}
	t.Status = to
	if kycState != "" {
		t.KYCState = kycState
	}
	return t, nil
}

func (f *fakeStore) InsertAssignment(_ context.Context, _ string, a Assignment) (*Assignment, error) {
	a.ID = "a-1"
	return &a, nil
}

func (f *fakeStore) ListAssignmentsByTutor(context.Context, string) ([]Assignment, error) {
	return nil, nil
}

func (f *fakeStore) GradeAssignment(_ context.Context, _, assignmentID, learnerID string, score *float64, feedback string, tutorID string, earnMinor int64) (*Grade, *Earning, error) {
	g := &Grade{ID: "g-1", AssignmentID: assignmentID, LearnerID: learnerID, Score: score, State: GradeGraded}
	var e *Earning
	if earnMinor > 0 && tutorID != "" {
		e = &Earning{ID: "e-grade", TutorID: tutorID, Source: SourceAssignment, AmountMinor: earnMinor, State: EarningPending}
		f.earnings = append(f.earnings, *e)
	}
	return g, e, nil
}

func (f *fakeStore) AppendEarning(_ context.Context, _, tutorID, source, refID string, amountMinor int64) (*Earning, error) {
	e := Earning{ID: "e-app", TutorID: tutorID, Source: source, AmountMinor: amountMinor, State: EarningPending}
	if refID != "" {
		e.RefID = &refID
	}
	f.earnings = append(f.earnings, e)
	return &e, nil
}

func (f *fakeStore) SumPending(_ context.Context, tutorID string) (int64, error) {
	var sum int64
	for _, e := range f.earnings {
		if e.TutorID == tutorID && e.State == EarningPending {
			sum += e.AmountMinor
		}
	}
	return sum, nil
}

func (f *fakeStore) ListEarnings(_ context.Context, tutorID string) ([]Earning, error) {
	out := []Earning{}
	for _, e := range f.earnings {
		if e.TutorID == tutorID {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeStore) FindPayoutByIdem(_ context.Context, idemKey string) (*Payout, error) {
	if p, ok := f.byIdem[idemKey]; ok {
		return p, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) InsertPayoutRequested(_ context.Context, _, tutorID, idemKey string, amountMinor int64) (*Payout, bool, error) {
	if p, ok := f.byIdem[idemKey]; ok {
		return p, false, nil // lost the idem race
	}
	f.insertCnt++
	p := &Payout{ID: "po-1", TutorID: tutorID, AmountMinor: amountMinor, State: PayoutRequested}
	if idemKey != "" {
		k := idemKey
		p.IdempotencyKey = &k
		f.byIdem[idemKey] = p
	}
	f.payouts[p.ID] = p
	return p, true, nil
}

func (f *fakeStore) SettlePayout(_ context.Context, _, payoutID string, to PayoutState, payoutRef string, amountMinor int64, tutorID string) (*Payout, error) {
	p, ok := f.payouts[payoutID]
	if !ok {
		return nil, ErrNotFound
	}
	if !canPayout(p.State, to) {
		return nil, ErrIllegalTransition
	}
	f.settleCnt++
	p.State = to
	if payoutRef != "" {
		p.PayoutRef = &payoutRef
	}
	// Mark covered pending earnings as paid (FIFO up to amount) — preserves derived balance.
	if to == PayoutPaid {
		var covered int64
		for i := range f.earnings {
			if covered >= amountMinor {
				break
			}
			if f.earnings[i].TutorID == tutorID && f.earnings[i].State == EarningPending {
				f.earnings[i].State = EarningPaid
				covered += f.earnings[i].AmountMinor
			}
		}
	}
	return p, nil
}

func (f *fakeStore) ListPayouts(_ context.Context, tutorID string) ([]Payout, error) {
	out := []Payout{}
	for _, p := range f.payouts {
		if tutorID == "" || p.TutorID == tutorID {
			out = append(out, *p)
		}
	}
	return out, nil
}

func newTestService(store tutorStore, kyc KYCChecker, rail PayoutRail) *Service {
	if kyc == nil {
		kyc = stubKYCChecker{}
	}
	if rail == nil {
		rail = stubPayoutRail{}
	}
	return &Service{repo: store, kyc: kyc, payout: rail}
}

// ── KYC gate: tier 0 → rejected, tier 1 → verified ────────────────────────────────

func TestVerifyTutor_KYCGate(t *testing.T) {
	ctx := context.Background()

	// tier 0 → rejected (fail-closed), status NOT flipped to verified.
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorPending)
	s := newTestService(f, fakeKYC{tier: 0}, newFakeRail())
	if _, err := s.VerifyTutor(ctx, "admin", "t1"); err != ErrKYCNotMet {
		t.Fatalf("tier 0 must reject with ErrKYCNotMet, got %v", err)
	}
	if f.tutors["t1"].Status == TutorVerified {
		t.Error("tier 0 must NOT verify the tutor")
	}

	// tier 1 → verified.
	f2 := newFakeStore()
	f2.seedTutor("t2", "u2", TutorPending)
	s2 := newTestService(f2, fakeKYC{tier: 1}, newFakeRail())
	out, err := s2.VerifyTutor(ctx, "admin", "t2")
	if err != nil {
		t.Fatalf("tier 1 must verify, got %v", err)
	}
	if out.Status != TutorVerified {
		t.Errorf("tier 1 tutor must become verified, got %s", out.Status)
	}
}

// KYC read error must fail closed (treated as tier-not-met).
func TestVerifyTutor_KYCErrorFailsClosed(t *testing.T) {
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorPending)
	s := newTestService(f, fakeKYC{err: context.DeadlineExceeded}, newFakeRail())
	if _, err := s.VerifyTutor(context.Background(), "admin", "t1"); err != ErrKYCNotMet {
		t.Errorf("KYC read error must fail closed with ErrKYCNotMet, got %v", err)
	}
	if f.tutors["t1"].Status == TutorVerified {
		t.Error("KYC error must NOT verify the tutor")
	}
}

// ── RequestPayout idempotency: double request = one rail call ─────────────────────

func TestRequestPayout_Idempotent_SingleRailCall(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorVerified)
	f.seedPending("t1", 50_000) // ₦500 derived pending balance
	rail := newFakeRail()
	s := newTestService(f, fakeKYC{tier: 1}, rail)
	const idem = "idem-payout-1"

	r1, err := s.RequestPayout(ctx, "u1", 30_000, idem)
	if err != nil {
		t.Fatalf("first payout: %v", err)
	}
	if r1.Replayed {
		t.Error("first payout must not be a replay")
	}
	if r1.Payout.State != PayoutPaid {
		t.Errorf("first payout should be paid, got %s", r1.Payout.State)
	}

	r2, err := s.RequestPayout(ctx, "u1", 30_000, idem)
	if err != nil {
		t.Fatalf("replay payout: %v", err)
	}
	if !r2.Replayed {
		t.Error("replay must be flagged replayed")
	}

	if f.insertCnt != 1 {
		t.Errorf("expected exactly ONE payout insert, got %d", f.insertCnt)
	}
	if rail.calls[idem] != 1 {
		t.Errorf("expected exactly ONE rail call for the idemKey, got %d", rail.calls[idem])
	}
	if r1.Payout.ID != r2.Payout.ID {
		t.Errorf("replay must return the SAME payout: %q != %q", r1.Payout.ID, r2.Payout.ID)
	}
}

// ── RequestPayout insufficient balance → reject (no rail call) ────────────────────

func TestRequestPayout_InsufficientBalance(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorVerified)
	f.seedPending("t1", 10_000) // only ₦100 pending
	rail := newFakeRail()
	s := newTestService(f, fakeKYC{tier: 1}, rail)

	if _, err := s.RequestPayout(ctx, "u1", 30_000, "idem-x"); err != ErrInsufficientBalance {
		t.Fatalf("expected ErrInsufficientBalance, got %v", err)
	}
	if f.insertCnt != 0 {
		t.Error("under-funded payout must NOT insert a payout row")
	}
	if len(rail.calls) != 0 {
		t.Error("under-funded payout must NOT call the rail")
	}
}

// ── RequestPayout requires an Idempotency-Key + positive amount ───────────────────

func TestRequestPayout_Guards(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorVerified)
	f.seedPending("t1", 50_000)
	s := newTestService(f, fakeKYC{tier: 1}, newFakeRail())

	if _, err := s.RequestPayout(ctx, "u1", 30_000, ""); err != ErrIdempotencyRequired {
		t.Errorf("missing idem key must reject with ErrIdempotencyRequired, got %v", err)
	}
	if _, err := s.RequestPayout(ctx, "u1", 0, "k"); err != ErrInvalidAmount {
		t.Errorf("zero amount must reject with ErrInvalidAmount, got %v", err)
	}
	if _, err := s.RequestPayout(ctx, "u1", -5, "k"); err != ErrInvalidAmount {
		t.Errorf("negative amount must reject with ErrInvalidAmount, got %v", err)
	}
}

// ── RequestPayout on rail error → failed ──────────────────────────────────────────

func TestRequestPayout_RailError_MarksFailed(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorVerified)
	f.seedPending("t1", 50_000)
	rail := newFakeRail()
	rail.err = context.Canceled // rail rejects
	s := newTestService(f, fakeKYC{tier: 1}, rail)

	res, err := s.RequestPayout(ctx, "u1", 30_000, "idem-fail")
	if err == nil {
		t.Fatal("rail error must surface to the caller")
	}
	if res == nil || res.Payout.State != PayoutFailed {
		t.Errorf("rail error must drive the payout requested→failed, got %+v", res)
	}
	// Earnings must remain pending (no money moved) — derived balance unchanged.
	if bal, _ := f.SumPending(ctx, "t1"); bal != 50_000 {
		t.Errorf("failed payout must leave pending balance intact, got %d", bal)
	}
}

// ── Earnings balance is DERIVED via SUM(pending) ─────────────────────────────────

func TestEarningsBalance_DerivedFromPendingSum(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorVerified)

	// Append three pending earnings + one already-paid (must NOT count).
	_, _ = f.AppendEarning(ctx, "actor", "t1", SourceClass, "", 5_000)
	_, _ = f.AppendEarning(ctx, "actor", "t1", SourceConsult, "", 3_000)
	_, _ = f.AppendEarning(ctx, "actor", "t1", SourceAssignment, "", 2_000)
	f.earnings = append(f.earnings, Earning{TutorID: "t1", State: EarningPaid, AmountMinor: 9_999})

	bal, err := newTestService(f, fakeKYC{tier: 1}, newFakeRail()).EarningsBalance(ctx, "t1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 10_000 {
		t.Errorf("derived pending balance must be SUM(pending)=10000, got %d", bal)
	}
}

// ── Paying out flips covered pending earnings to paid (derived balance drops) ──────

func TestRequestPayout_FlipsCoveredEarnings(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	f.seedTutor("t1", "u1", TutorVerified)
	_, _ = f.AppendEarning(ctx, "actor", "t1", SourceClass, "", 20_000)
	_, _ = f.AppendEarning(ctx, "actor", "t1", SourceClass, "", 20_000)
	s := newTestService(f, fakeKYC{tier: 1}, newFakeRail())

	if _, err := s.RequestPayout(ctx, "u1", 20_000, "idem-1"); err != nil {
		t.Fatalf("payout: %v", err)
	}
	// One ₦200 earning covered ⇒ derived pending drops to ₦200.
	if bal, _ := f.SumPending(ctx, "t1"); bal != 20_000 {
		t.Errorf("after a 20000 payout, pending must be 20000, got %d", bal)
	}
}

// ── Onboard is idempotent on the user ─────────────────────────────────────────────

func TestOnboardTutor_IdempotentOnUser(t *testing.T) {
	ctx := context.Background()
	f := newFakeStore()
	s := newTestService(f, fakeKYC{tier: 1}, newFakeRail())

	t1, err := s.OnboardTutor(ctx, "u1", "bio", []string{"math"})
	if err != nil {
		t.Fatalf("onboard: %v", err)
	}
	t2, err := s.OnboardTutor(ctx, "u1", "bio2", []string{"physics"})
	if err != nil {
		t.Fatalf("re-onboard: %v", err)
	}
	if t1.ID != t2.ID {
		t.Errorf("re-onboard must return the SAME tutor, got %q != %q", t1.ID, t2.ID)
	}
}

// ── Stub rails are deterministic + idempotent (no vendor leak) ────────────────────

func TestStubRails(t *testing.T) {
	ctx := context.Background()
	tier, err := stubKYCChecker{}.Tier(ctx, "u")
	if err != nil || tier < MinVerifyTier {
		t.Errorf("stub KYC must report a verifiable tier, got tier=%d err=%v", tier, err)
	}
	a, _ := stubPayoutRail{}.Payout(ctx, "u", "ref", "idem-a", 100)
	b, _ := stubPayoutRail{}.Payout(ctx, "u", "ref", "idem-a", 100)
	if a != b {
		t.Errorf("stub payout must yield a stable ref per idemKey: %q != %q", a, b)
	}
	if pick("idem", "ref") != "idem" || pick("", "ref") != "ref" {
		t.Error("pick must prefer the idemKey then fall back to reference")
	}
}
