package care

import (
	"context"
	"testing"
	"time"

	triage "spotlight/backend/internal/health/triage"
)

// ─── fakes (no DB) ───────────────────────────────────────────────────────────

type fakeRepo struct {
	referrals   map[string]*CareReferral
	escalations map[string]*Escalation
	seq         int
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{referrals: map[string]*CareReferral{}, escalations: map[string]*Escalation{}}
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
func (f *fakeRepo) GetReferralByIdem(_ context.Context, idem string) (*CareReferral, error) {
	for _, r := range f.referrals {
		if r.IdempotencyKey != nil && *r.IdempotencyKey == idem {
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

type fakeLocator struct{ called bool }

func (l *fakeLocator) NearestER(_ context.Context, lat, lng float64) (string, string, float64, error) {
	l.called = true
	return "St. Nicholas ER", "57 Campbell St, Lagos", 1200, nil
}

type fakeNotifier struct{ sent []string }

func (n *fakeNotifier) Notify(_ context.Context, userID, template string, _ map[string]any) error {
	n.sent = append(n.sent, template+":"+userID)
	return nil
}

type fakeBooker struct{ amount int64 }

func (b *fakeBooker) Book(_ context.Context, userID, route, ref string) (string, int64, error) {
	return "booking-" + route, b.amount, nil
}

// ─── route mapping by level ──────────────────────────────────────────────────

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

// ─── referral SM: allowed + illegal ──────────────────────────────────────────

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

// ─── escalation SM ───────────────────────────────────────────────────────────

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

// ─── emergency path: raises escalation + no charge ───────────────────────────

func TestReferEmergencyRaisesEscalationNoCharge(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	loc := &fakeLocator{}
	notify := &fakeNotifier{}
	svc := NewCareService(repo, pay, loc, notify, &fakeBooker{amount: 500000}, nil)

	res, err := svc.Refer(context.Background(), "user-1", "sess-1", triage.LevelEmergencyAmbulance)
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

// ─── PayReferral idempotency (double = one charge) ───────────────────────────

func TestPayReferralIdempotency(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 500000}, nil)

	res, err := svc.Refer(context.Background(), "user-1", "sess-1", triage.LevelConsult)
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

// ─── self_care: routed, no charge ────────────────────────────────────────────

func TestReferSelfCareNoCharge(t *testing.T) {
	repo := newFakeRepo()
	pay := newFakePayment()
	svc := NewCareService(repo, pay, nil, nil, &fakeBooker{amount: 1}, nil)

	res, err := svc.Refer(context.Background(), "user-1", "sess-1", triage.LevelSelfCare)
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

// ─── escalation lifecycle through the service (raise→notify→ack→resolve) ──────

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

// ─── illegal: acknowledging a freshly-raised (not notified) case ─────────────

func TestAcknowledgeBeforeNotifyIllegal(t *testing.T) {
	repo := newFakeRepo()
	svc := NewCareService(repo, nil, nil, nil, nil, nil)
	ctx := context.Background()
	e, _ := svc.Raise(ctx, "sess-1", "user-1", "x")
	if _, err := svc.Acknowledge(ctx, e.ID, "clin-1"); err == nil {
		t.Fatalf("expected illegal transition acknowledging a raised (not notified) case")
	}
}

// ─── nearest emergency is always available (SC-8) even with nil locator ───────

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
