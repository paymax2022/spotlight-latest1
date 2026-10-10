package care

import (
	"context"
	"errors"
	"testing"
	"time"

	triage "spotlight/backend/internal/health/triage"
)

type fakeSession struct {
	userID string
	level  int
}

type fakeRepo struct {
	referrals   map[string]*CareReferral
	escalations map[string]*Escalation
	sessions    map[string]fakeSession
	seq         int
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{referrals: map[string]*CareReferral{}, escalations: map[string]*Escalation{}, sessions: map[string]fakeSession{}}
}

// seedSession records a triage session's stored disposition — Refer now reads
// the level from here (owner-fused), never from the caller.
func (f *fakeRepo) seedSession(sessionID, userID string, level int) {
	f.sessions[sessionID] = fakeSession{userID: userID, level: level}
}

func (f *fakeRepo) GetSessionDisposition(_ context.Context, sessionID, userID string) (*int, error) {
	s, ok := f.sessions[sessionID]
	if !ok || s.userID != userID {
		return nil, ErrNotFound
	}
	lvl := s.level
	return &lvl, nil
}

func (f *fakeRepo) GetReferralByIdemAny(_ context.Context, idem string) (*CareReferral, error) {
	for _, r := range f.referrals {
		if r.IdempotencyKey != nil && *r.IdempotencyKey == idem {
			cp := *r
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (f *fakeRepo) PinReferralIdem(_ context.Context, id, idemKey string) error {
	r, ok := f.referrals[id]
	if !ok || r.State != triage.RefRouted || r.IdempotencyKey != nil {
		return ErrIllegalTransition
	}
	for _, o := range f.referrals {
		if o.ID != id && o.IdempotencyKey != nil && *o.IdempotencyKey == idemKey {
			return ErrIllegalTransition // stands in for the UNIQUE index
		}
	}
	k := idemKey
	r.IdempotencyKey = &k
	return nil
}

func (f *fakeRepo) GetOpenEscalationBySession(_ context.Context, sessionID string) (*Escalation, error) {
	for _, e := range f.escalations {
		if e.SessionID == sessionID && e.State != triage.EscResolved {
			cp := *e
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (f *fakeRepo) CreateReferral(_ context.Context, r *CareReferral) error {
	cp := *r
	f.referrals[r.ID] = &cp
	return nil
}
func (f *fakeRepo) GetReferral(_ context.Context, id string) (*CareReferral, error) {
	r, ok := f.referrals[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *r
	return &cp, nil
}
func (f *fakeRepo) GetReferralByIdem(_ context.Context, userID, idem string) (*CareReferral, error) {
	for _, r := range f.referrals {
		if r.UserID == userID && r.IdempotencyKey != nil && *r.IdempotencyKey == idem {
			cp := *r
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}
func (f *fakeRepo) ListReferralsByUser(_ context.Context, userID string) ([]CareReferral, error) {
	var out []CareReferral
	for _, r := range f.referrals {
		if r.UserID == userID {
			out = append(out, *r)
		}
	}
	return out, nil
}
func (f *fakeRepo) UpdateReferralState(_ context.Context, id string, from, to triage.ReferralState, set ReferralPatch) error {
	r, ok := f.referrals[id]
	if !ok {
		return ErrNotFound
	}
	if r.State != from { // guarded compare-and-set
		return ErrIllegalTransition
	}
	r.State = to
	if set.TargetRef != nil {
		r.TargetRef = set.TargetRef
	}
	if set.AmountMinor != nil {
		r.AmountMinor = *set.AmountMinor
	}
	if set.PaymentRef != nil {
		r.PaymentRef = set.PaymentRef
	}
	if set.IdempotencyKey != nil {
		r.IdempotencyKey = set.IdempotencyKey
	}
	r.UpdatedAt = time.Now()
	return nil
}
func (f *fakeRepo) CreateEscalation(_ context.Context, e *Escalation) error {
	cp := *e
	f.escalations[e.ID] = &cp
	return nil
}
func (f *fakeRepo) GetEscalation(_ context.Context, id string) (*Escalation, error) {
	e, ok := f.escalations[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *e
	return &cp, nil
}
func (f *fakeRepo) ListEscalations(_ context.Context, state string) ([]Escalation, error) {
	var out []Escalation
	for _, e := range f.escalations {
		if state == "" || string(e.State) == state {
			out = append(out, *e)
		}
	}
	return out, nil
}
func (f *fakeRepo) UpdateEscalationState(_ context.Context, id string, from, to triage.EscalationState, clinicianID *string, stamp *time.Time) error {
	e, ok := f.escalations[id]
	if !ok {
		return ErrNotFound
	}
	if e.State != from {
		return ErrIllegalTransition
	}
	e.State = to
	if clinicianID != nil {
		e.ClinicianID = clinicianID
	}
	if to == triage.EscAcknowledged && stamp != nil {
		e.AckAt = stamp
	}
	if to == triage.EscResolved && stamp != nil {
		e.ResolvedAt = stamp
	}
	return nil
}

// fakePayment records every charge so we can assert idempotency.
type fakePayment struct {
	charges map[string]string // idemKey → ref
	calls   int
}

func newFakePayment() *fakePayment { return &fakePayment{charges: map[string]string{}} }

func (p *fakePayment) Charge(_ context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	if ref, ok := p.charges[idemKey]; ok {
		return ref, nil // idempotent replay — no new charge
	}
	p.calls++
	ref := "pay-" + idemKey
	p.charges[idemKey] = ref
	return ref, nil
}

func (p *fakePayment) Reverse(_ context.Context, userID, reference, idemKey string, amountMinor int64) error {
	if _, ok := p.charges[idemKey]; ok {
		return nil // replay — reversal already posted
	}
	p.charges[idemKey] = "rev-" + idemKey
	return nil
}

type fakeLocator struct{ called bool }

func (l *fakeLocator) NearestER(_ context.Context, lat, lng float64) (string, string, float64, error) {
	l.called = true
	return "St. Nicholas ER", "57 Campbell St, Lagos", 1200, nil
}

type fakeNotifier struct {
	sent []string
	err  error
}

func (n *fakeNotifier) Notify(_ context.Context, userID, template string, _ map[string]any) error {
	if n.err != nil {
		return n.err
	}
	n.sent = append(n.sent, template+":"+userID)
	return nil
}

type fakeBooker struct{ amount int64 }

func (b *fakeBooker) Book(_ context.Context, userID, route, ref string) (string, int64, error) {
	return "booking-" + route, b.amount, nil
}

func TestRouteMappingByLevel(t *testing.T) {
	cases := map[int]string{
		triage.LevelEmergencyAmbulance: "emergency",
		triage.LevelEmergencyUrgent:    "emergency",
		triage.LevelConsult24h:         "telemed",
		triage.LevelConsult:            "telemed",
		triage.LevelSelfCare:           "self_care",
	}
	for level, want := range cases {
		if got := triage.RouteForLevel(level); got != want {
			t.Fatalf("level %d: route = %q, want %q", level, got, want)
		}
	}
}

func TestReferralStateMachine(t *testing.T) {
	// Legal happy path.
	legal := [][2]triage.ReferralState{
		{triage.RefCreated, triage.RefRouted},
		{triage.RefRouted, triage.RefPaid},
		{triage.RefPaid, triage.RefFulfilled},
		{triage.RefFulfilled, triage.RefFollowUp},
		{triage.RefFollowUp, triage.RefClosed},
	}
	for _, e := range legal {
		if !triage.CanReferral(e[0], e[1]) {
			t.Fatalf("expected legal referral transition %s -> %s", e[0], e[1])
		}
	}
	// Illegal: cannot skip routed→fulfilled is actually legal (emergency); but
	// created→paid and paid→routed must be rejected.
	illegal := [][2]triage.ReferralState{
		{triage.RefCreated, triage.RefPaid},
		{triage.RefPaid, triage.RefRouted},
		{triage.RefClosed, triage.RefPaid},
	}
	for _, e := range illegal {
		if triage.CanReferral(e[0], e[1]) {
			t.Fatalf("expected ILLEGAL referral transition %s -> %s", e[0], e[1])
		}
	}
}

func TestEscalationStateMachine(t *testing.T) {
	legal := [][2]triage.EscalationState{
		{triage.EscRaised, triage.EscNotified},
		{triage.EscNotified, triage.EscAcknowledged},
		{triage.EscAcknowledged, triage.EscResolved},
	}
	for _, e := range legal {
		if !triage.CanEscalation(e[0], e[1]) {
			t.Fatalf("expected legal escalation transition %s -> %s", e[0], e[1])
		}
	}
	illegal := [][2]triage.EscalationState{
		{triage.EscRaised, triage.EscAcknowledged}, // cannot skip notified
		{triage.EscRaised, triage.EscResolved},
		{triage.EscResolved, triage.EscRaised},
	}
	for _, e := range illegal {
		if triage.CanEscalation(e[0], e[1]) {
			t.Fatalf("expected ILLEGAL escalation transition %s -> %s", e[0], e[1])
		}
	}
}

func TestReferEmergencyRaisesEscalationNoCharge(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	loc := &fakeLocator{}
	notify := &fakeNotifier{}
	svc := NewCareService(repo, pay, loc, notify, &fakeBooker{amount: 500000}, nil)
	repo.seedSession("sess-1", "user-1", triage.LevelEmergencyAmbulance)

	res, err := svc.Refer(context.Background(), "user-1", "sess-1")
	if err != nil {
		t.Fatalf("Refer emergency: %v", err)
	}
	if res.Referral.Route != "emergency" {
		t.Fatalf("route = %q, want emergency", res.Referral.Route)
	}
	if res.Referral.State != triage.RefRouted {
		t.Fatalf("referral state = %s, want routed", res.Referral.State)
	}
	if res.Referral.AmountMinor != 0 {
		t.Fatalf("emergency must have zero amount, got %d", res.Referral.AmountMinor)
	}
	if pay.calls != 0 {
		t.Fatalf("emergency must NOT charge, got %d charges", pay.calls)
	}
	if res.Escalation == nil {
		t.Fatalf("emergency must raise an escalation (SC-5)")
	}
	if res.Escalation.State != triage.EscNotified {
		t.Fatalf("escalation state = %s, want notified (raised+notified)", res.Escalation.State)
	}
	if res.Emergency == nil || res.Emergency.AmbulanceNumber == "" {
		t.Fatalf("emergency payload must carry ambulance number (SC-8)")
	}
	if res.Emergency.FacilityName == "" {
		t.Fatalf("expected nearest ER from locator")
	}
	if len(notify.sent) == 0 {
		t.Fatalf("expected patient+clinician hand-off notifications (SC-5)")
	}
}

func TestPayReferralIdempotency(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 500000}, nil)
	repo.seedSession("sess-1", "user-1", triage.LevelConsult)

	res, err := svc.Refer(context.Background(), "user-1", "sess-1")
	if err != nil {
		t.Fatalf("Refer telemed: %v", err)
	}
	ref := res.Referral
	if ref.State != triage.RefRouted {
		t.Fatalf("referral state = %s, want routed", ref.State)
	}
	if ref.AmountMinor != 500000 {
		t.Fatalf("amount = %d, want 500000 (kobo)", ref.AmountMinor)
	}

	// First pay → charges once, advances to fulfilled.
	out1, err := svc.PayReferral(context.Background(), "user-1", ref.ID, "idem-abc")
	if err != nil {
		t.Fatalf("PayReferral #1: %v", err)
	}
	if out1.State != triage.RefFulfilled {
		t.Fatalf("after pay state = %s, want fulfilled", out1.State)
	}
	// Second pay with same idem key → no second charge, idempotent no-op.
	out2, err := svc.PayReferral(context.Background(), "user-1", ref.ID, "idem-abc")
	if err != nil {
		t.Fatalf("PayReferral #2: %v", err)
	}
	if out2.State != triage.RefFulfilled {
		t.Fatalf("replay state = %s, want fulfilled", out2.State)
	}
	if pay.calls != 1 {
		t.Fatalf("double pay must charge exactly once, got %d charges", pay.calls)
	}
}

func TestReferSelfCareNoCharge(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 1}, nil)
	repo.seedSession("sess-1", "user-1", triage.LevelSelfCare)

	res, err := svc.Refer(context.Background(), "user-1", "sess-1")
	if err != nil {
		t.Fatalf("Refer self_care: %v", err)
	}
	if res.Referral.Route != "self_care" || res.Referral.State != triage.RefRouted {
		t.Fatalf("self_care: route=%q state=%s", res.Referral.Route, res.Referral.State)
	}
	// Paying self_care is a no-op (no charge).
	if _, err := svc.PayReferral(context.Background(), "user-1", res.Referral.ID, "k"); err != nil {
		t.Fatalf("PayReferral self_care: %v", err)
	}
	if pay.calls != 0 {
		t.Fatalf("self_care must not charge, got %d", pay.calls)
	}
}

func TestEscalationLifecycle(t *testing.T) {
	repo := newFakeRepo()
	notify := &fakeNotifier{}
	svc := NewCareService(repo, nil, nil, notify, nil, nil)
	ctx := context.Background()

	e, err := svc.Raise(ctx, "sess-1", "user-1", "high-risk")
	if err != nil {
		t.Fatalf("Raise: %v", err)
	}
	if e.State != triage.EscRaised {
		t.Fatalf("state = %s, want raised", e.State)
	}
	if _, err := svc.Notify(ctx, e.ID); err != nil {
		t.Fatalf("Notify: %v", err)
	}
	// Acknowledge before notify is illegal — but we are notified now, so ack is legal.
	acked, err := svc.Acknowledge(ctx, e.ID, "clin-9")
	if err != nil {
		t.Fatalf("Acknowledge: %v", err)
	}
	if acked.State != triage.EscAcknowledged || acked.ClinicianID == nil || *acked.ClinicianID != "clin-9" {
		t.Fatalf("ack state/clinician wrong: %+v", acked)
	}
	resolved, err := svc.Resolve(ctx, e.ID, "clin-9")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resolved.State != triage.EscResolved || resolved.ResolvedAt == nil {
		t.Fatalf("resolve wrong: %+v", resolved)
	}
	// Resolving again is illegal (resolved is terminal).
	if _, err := svc.Resolve(ctx, e.ID, "clin-9"); err == nil {
		t.Fatalf("expected illegal transition resolving a resolved case")
	}
}

// A failed hand-off must NOT advance to notified — that would be the silent
// flag SC-5 exists to prevent. The case stays raised and Notify retries cleanly.
func TestNotifyFailureLeavesEscalationRaised(t *testing.T) {
	repo := newFakeRepo()
	notify := &fakeNotifier{err: errors.New("queue unreachable")}
	svc := NewCareService(repo, nil, nil, notify, nil, nil)
	ctx := context.Background()

	e, err := svc.Raise(ctx, "sess-1", "user-1", "high-risk")
	if err != nil {
		t.Fatalf("Raise: %v", err)
	}
	if _, err := svc.Notify(ctx, e.ID); err == nil {
		t.Fatalf("expected the delivery failure to propagate")
	}
	stored, err := repo.GetEscalation(ctx, e.ID)
	if err != nil {
		t.Fatalf("GetEscalation: %v", err)
	}
	if stored.State != triage.EscRaised {
		t.Fatalf("failed hand-off must leave the case raised, got %s", stored.State)
	}
	notify.err = nil
	got, err := svc.Notify(ctx, e.ID)
	if err != nil {
		t.Fatalf("retry after recovery: %v", err)
	}
	if got.State != triage.EscNotified {
		t.Fatalf("retry state = %s, want notified", got.State)
	}
}

func TestAcknowledgeBeforeNotifyIllegal(t *testing.T) {
	repo := newFakeRepo()
	svc := NewCareService(repo, nil, nil, nil, nil, nil)
	ctx := context.Background()
	e, _ := svc.Raise(ctx, "sess-1", "user-1", "x")
	if _, err := svc.Acknowledge(ctx, e.ID, "clin-1"); err == nil {
		t.Fatalf("expected illegal transition acknowledging a raised (not notified) case")
	}
}

func TestNearestEmergencyAlwaysAvailable(t *testing.T) {
	svc := NewCareService(newFakeRepo(), nil, nil, nil, nil, nil) // nil locator
	info, err := svc.NearestEmergency(context.Background(), 6.45, 3.39)
	if err != nil {
		t.Fatalf("NearestEmergency: %v", err)
	}
	if info.AmbulanceNumber == "" || info.FirstAid == "" {
		t.Fatalf("SC-8 payload must never be empty: %+v", info)
	}
}

// Foreign and missing referrals must be INDISTINGUISHABLE — the owner gate runs
// before any state check so a stranger cannot probe referral ids (or learn
// their payment state).
func TestPayReferralForeignFoldsToNotFound(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 500000}, nil)
	repo.seedSession("sess-1", "user-1", triage.LevelConsult)
	res, err := svc.Refer(context.Background(), "user-1", "sess-1")
	if err != nil {
		t.Fatalf("Refer: %v", err)
	}
	if _, err := svc.PayReferral(context.Background(), "stranger", res.Referral.ID, "idem-x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign pay: err = %v, want ErrNotFound", err)
	}
	if _, err := svc.PayReferral(context.Background(), "stranger", "no-such-referral", "idem-x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing pay: err = %v, want ErrNotFound", err)
	}
	if pay.calls != 0 {
		t.Fatalf("foreign/missing pay must never charge, got %d charges", pay.calls)
	}
	// Same fold on the other member-side mutation paths.
	if _, err := svc.MarkFulfilled(context.Background(), "stranger", res.Referral.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign MarkFulfilled: err = %v, want ErrNotFound", err)
	}
	if _, err := svc.FollowUp(context.Background(), "stranger", res.Referral.ID, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign FollowUp: err = %v, want ErrNotFound", err)
	}
	if _, err := svc.Close(context.Background(), "stranger", res.Referral.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign Close: err = %v, want ErrNotFound", err)
	}
}

// Money mutations fail closed without an idempotency key.
func TestPayReferralRequiresIdempotencyKey(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 500000}, nil)
	repo.seedSession("sess-1", "user-1", triage.LevelConsult)
	res, err := svc.Refer(context.Background(), "user-1", "sess-1")
	if err != nil {
		t.Fatalf("Refer: %v", err)
	}
	if _, err := svc.PayReferral(context.Background(), "user-1", res.Referral.ID, ""); !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("pay without idem key: err = %v, want ErrIdempotencyRequired", err)
	}
	if pay.calls != 0 {
		t.Fatalf("missing idem key must never charge, got %d charges", pay.calls)
	}
}

// Paying pins the key on the referral; replaying the same key against a
// DIFFERENT referral of the same user fails closed (owner-scoped replay check).
func TestPayReferralIdemKeyBoundToReferral(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 500000}, nil)
	ctx := context.Background()

	repo.seedSession("sess-1", "user-1", triage.LevelConsult)
	repo.seedSession("sess-2", "user-1", triage.LevelConsult)
	r1, err := svc.Refer(ctx, "user-1", "sess-1")
	if err != nil {
		t.Fatalf("Refer 1: %v", err)
	}
	r2, err := svc.Refer(ctx, "user-1", "sess-2")
	if err != nil {
		t.Fatalf("Refer 2: %v", err)
	}
	out, err := svc.PayReferral(ctx, "user-1", r1.Referral.ID, "idem-shared")
	if err != nil {
		t.Fatalf("PayReferral r1: %v", err)
	}
	if out.IdempotencyKey == nil || *out.IdempotencyKey != "idem-shared" {
		t.Fatalf("paid referral must pin idempotency_key, got %+v", out.IdempotencyKey)
	}
	// Same key, different referral → conflict, no charge.
	if _, err := svc.PayReferral(ctx, "user-1", r2.Referral.ID, "idem-shared"); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("reused key on another referral: err = %v, want ErrIllegalTransition", err)
	}
	if pay.calls != 1 {
		t.Fatalf("reused key must not charge twice, got %d charges", pay.calls)
	}
	// A DIFFERENT user reusing the key is unaffected by the first user's pin —
	// the replay lookup is owner-scoped (their own referral still charges once
	// for them under their own key binding).
	if _, err := svc.PayReferral(ctx, "user-2", r2.Referral.ID, "idem-shared"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("user-2 paying user-1's referral: err = %v, want ErrNotFound", err)
	}
}
