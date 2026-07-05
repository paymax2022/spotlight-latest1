package schools

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// These tests are PURE — no DB, no pgx. They exercise:
//   - the guarded licence state machine (allowed + illegal transitions),
//   - the seat-capped, idempotent bulk-enrolment service logic (stops at the cap,
//     reports how many succeeded; a replayed batch never double-seats),
//   - the billing-charge-once invariant (rail invoked once; second call is a no-op).
//
// The DB-bound store is replaced by an in-memory fake that faithfully models the seat
// accounting (used_seats ≤ seats, atomic per learner) and the enrolment unique
// constraint; the rail is a counting fake.

// ── Licence state machine: allowed + illegal transitions ─────────────────────────

func TestCanLicence_AllowedTransitions(t *testing.T) {
	allowed := [][2]LicenceState{
		{LicenceActive, LicenceSuspended},
		{LicenceSuspended, LicenceActive}, // reactivate
		{LicenceActive, LicenceExpired},
		{LicenceSuspended, LicenceExpired},
	}
	for _, tr := range allowed {
		if !canLicence(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be allowed", tr[0], tr[1])
		}
	}
}

func TestCanLicence_IllegalTransitions(t *testing.T) {
	illegal := [][2]LicenceState{
		{LicenceExpired, LicenceActive},    // terminal
		{LicenceExpired, LicenceSuspended}, // terminal
		{LicenceExpired, LicenceExpired},   // terminal self-loop
		{LicenceActive, LicenceActive},     // no-op not a transition
		{LicenceSuspended, LicenceSuspended},
		{"bogus", LicenceActive}, // unknown source
	}
	for _, tr := range illegal {
		if canLicence(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be ILLEGAL", tr[0], tr[1])
		}
	}
}

// ── Fake store (in-memory seat accounting) ───────────────────────────────────────

type fakeStore struct {
	insts     map[string]*Institution
	licences  map[string]*Licence // by institution id (single active licence per inst for tests)
	enrolled  map[string]string   // "instID|learner" → state
	billings  map[string]*Billing
	auditCnt  int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		insts:    map[string]*Institution{},
		licences: map[string]*Licence{},
		enrolled: map[string]string{},
		billings: map[string]*Billing{},
	}
}

func ekey(inst, learner string) string { return inst + "|" + learner }

func (f *fakeStore) InsertInstitution(_ context.Context, name, typ, adminUserID string, _ json.RawMessage, vaRef string) (*Institution, error) {
	id := "inst-" + name
	var va *string
	if vaRef != "" {
		va = &vaRef
	}
	i := &Institution{ID: id, Name: name, Type: typ, Status: "active", VirtualAccountRef: va, CreatedAt: time.Now()}
	if adminUserID != "" {
		i.AdminUserID = &adminUserID
	}
	f.insts[id] = i
	return i, nil
}

func (f *fakeStore) GetInstitution(_ context.Context, id string) (*Institution, error) {
	if i, ok := f.insts[id]; ok {
		return i, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) ListInstitutions(context.Context) ([]Institution, error) { return nil, nil }

func (f *fakeStore) ListInstitutionsByAdmin(_ context.Context, adminUserID string) ([]Institution, error) {
	out := []Institution{}
	for _, i := range f.insts {
		if i.AdminUserID != nil && *i.AdminUserID == adminUserID {
			out = append(out, *i)
		}
	}
	return out, nil
}

func (f *fakeStore) InsertLicence(_ context.Context, institutionID, tier string, seats int, priceMinor int64, _, _ *time.Time) (*Licence, error) {
	l := &Licence{ID: "lic-" + institutionID, InstitutionID: institutionID, Tier: tier, Seats: seats,
		PriceMinor: priceMinor, State: LicenceActive, CreatedAt: time.Now()}
	f.licences[institutionID] = l
	return l, nil
}

func (f *fakeStore) GetLicence(_ context.Context, id string) (*Licence, error) {
	for _, l := range f.licences {
		if l.ID == id {
			return l, nil
		}
	}
	return nil, ErrNotFound
}

func (f *fakeStore) ListLicences(_ context.Context, institutionID string) ([]Licence, error) {
	if l, ok := f.licences[institutionID]; ok {
		return []Licence{*l}, nil
	}
	return []Licence{}, nil
}

func (f *fakeStore) ActiveLicence(_ context.Context, institutionID string) (*Licence, error) {
	if l, ok := f.licences[institutionID]; ok && l.State == LicenceActive {
		return l, nil
	}
	return nil, ErrNoActiveLicence
}

func (f *fakeStore) SetLicenceState(_ context.Context, licenceID string, from, to LicenceState) (*Licence, error) {
	for _, l := range f.licences {
		if l.ID == licenceID {
			if l.State != from {
				return nil, ErrIllegalTransition
			}
			l.State = to
			return l, nil
		}
	}
	return nil, ErrLicenceNotFound
}

func (f *fakeStore) InsertClassGroup(_ context.Context, institutionID, name, classCode, teacherUserID string) (*ClassGroup, error) {
	return &ClassGroup{ID: "cg-" + name, InstitutionID: institutionID, Name: name}, nil
}

func (f *fakeStore) ListClassGroups(context.Context, string) ([]ClassGroup, error) { return nil, nil }

// EnrollSeated models the atomic, seat-capped, idempotent insert + seat increment.
func (f *fakeStore) EnrollSeated(_ context.Context, institutionID, classGroupID, learnerUserID, _ string) (seated, replay bool, used, seats int, err error) {
	l, ok := f.licences[institutionID]
	if !ok || l.State != LicenceActive {
		return false, false, 0, 0, ErrNoActiveLicence
	}
	used, seats = l.UsedSeats, l.Seats
	k := ekey(institutionID, learnerUserID)
	if st, exists := f.enrolled[k]; exists && st != EnrollRemoved {
		return false, true, used, seats, nil // replay — no new seat
	}
	if l.UsedSeats >= l.Seats {
		return false, false, used, seats, ErrSeatLimitExceeded
	}
	f.enrolled[k] = EnrollActive
	l.UsedSeats++
	return true, false, l.UsedSeats, l.Seats, nil
}

func (f *fakeStore) RemoveEnrollment(_ context.Context, institutionID, learnerUserID string) (bool, error) {
	l, ok := f.licences[institutionID]
	if !ok {
		return false, ErrNoActiveLicence
	}
	k := ekey(institutionID, learnerUserID)
	if f.enrolled[k] != EnrollActive {
		return false, nil
	}
	f.enrolled[k] = EnrollRemoved
	if l.UsedSeats > 0 {
		l.UsedSeats--
	}
	return true, nil
}

func (f *fakeStore) CountEnrollmentsByState(_ context.Context, institutionID string) (map[string]int, error) {
	out := map[string]int{}
	for k, st := range f.enrolled {
		if len(k) >= len(institutionID) && k[:len(institutionID)] == institutionID {
			out[st]++
		}
	}
	return out, nil
}

func (f *fakeStore) InsertBilling(_ context.Context, institutionID, period string, amountMinor int64) (*Billing, error) {
	b := &Billing{ID: "bill-" + period, InstitutionID: institutionID, Period: period, AmountMinor: amountMinor, State: BillingOpen}
	f.billings[b.ID] = b
	return b, nil
}

func (f *fakeStore) GetBilling(_ context.Context, id string) (*Billing, error) {
	if b, ok := f.billings[id]; ok {
		return b, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) SetBillingPaid(_ context.Context, billingID, paymentRef string) (*Billing, error) {
	b, ok := f.billings[billingID]
	if !ok {
		return nil, ErrNotFound
	}
	if b.State != BillingOpen {
		return nil, ErrBillingNotOpen
	}
	b.State = BillingPaid
	pr := paymentRef
	b.PaymentRef = &pr
	return b, nil
}

func (f *fakeStore) WriteAudit(context.Context, string, string, string, string, any) error {
	f.auditCnt++
	return nil
}

// ── Counting billing rail ─────────────────────────────────────────────────────────

type fakeBillingRail struct {
	calls map[string]int // idemKey → invocation count
}

func newFakeBillingRail() *fakeBillingRail { return &fakeBillingRail{calls: map[string]int{}} }

func (f *fakeBillingRail) Charge(_ context.Context, _, _, idemKey string, _ int64) (string, error) {
	f.calls[idemKey]++
	return "bill-ref-" + idemKey, nil
}

// ── Bulk enrolment: seat cap (stops at limit, reports count) ──────────────────────

func TestBulkEnroll_SeatCapped(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inst, _ := store.InsertInstitution(ctx, "Acme", "school", "admin-1", nil, "va-1")
	store.InsertLicence(ctx, inst.ID, "pro", 3, 100000, nil, nil)
	svc := newServiceWithStore(store, newFakeBillingRail())

	// 5 learners, only 3 seats → first 3 seated, then seat_limit_exceeded.
	res, err := svc.BulkEnroll(ctx, "admin-1", BulkEnrollRequest{
		InstitutionID: inst.ID,
		LearnerIDs:    []string{"l1", "l2", "l3", "l4", "l5"},
	}, "batch-1")
	if err != ErrSeatLimitExceeded {
		t.Fatalf("expected seat_limit_exceeded, got %v", err)
	}
	if res.Succeeded != 3 {
		t.Errorf("expected 3 succeeded, got %d", res.Succeeded)
	}
	if !res.SeatLimitHit {
		t.Error("expected SeatLimitHit=true")
	}
	if res.UsedSeats != 3 || res.Seats != 3 {
		t.Errorf("expected 3/3 seats used, got %d/%d", res.UsedSeats, res.Seats)
	}
	if store.licences[inst.ID].UsedSeats != 3 {
		t.Errorf("licence used_seats must be capped at 3, got %d", store.licences[inst.ID].UsedSeats)
	}
}

// ── Bulk enrolment: idempotency (replay = no double-seat) ─────────────────────────

func TestBulkEnroll_IdempotentReplay(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inst, _ := store.InsertInstitution(ctx, "Beta", "school", "admin-1", nil, "")
	store.InsertLicence(ctx, inst.ID, "pro", 10, 0, nil, nil)
	svc := newServiceWithStore(store, newFakeBillingRail())

	learners := []string{"l1", "l2", "l3"}
	first, err := svc.BulkEnroll(ctx, "admin-1", BulkEnrollRequest{InstitutionID: inst.ID, LearnerIDs: learners}, "batch-1")
	if err != nil {
		t.Fatalf("first enroll: %v", err)
	}
	if first.Succeeded != 3 {
		t.Fatalf("first run should seat 3, got %d", first.Succeeded)
	}

	// Replay the SAME batch: nobody is newly seated, all reported as alreadyEnrolled.
	second, err := svc.BulkEnroll(ctx, "admin-1", BulkEnrollRequest{InstitutionID: inst.ID, LearnerIDs: learners}, "batch-1")
	if err != nil {
		t.Fatalf("replay enroll: %v", err)
	}
	if second.Succeeded != 0 {
		t.Errorf("replay must seat 0 new learners, got %d", second.Succeeded)
	}
	if len(second.AlreadyEnrolled) != 3 {
		t.Errorf("replay should report 3 alreadyEnrolled, got %d", len(second.AlreadyEnrolled))
	}
	if store.licences[inst.ID].UsedSeats != 3 {
		t.Errorf("replay must NOT double-seat: used_seats=%d want 3", store.licences[inst.ID].UsedSeats)
	}
}

// RemoveEnrollment frees a seat so a new learner can take it.
func TestRemoveEnrollment_FreesSeat(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inst, _ := store.InsertInstitution(ctx, "Gamma", "school", "admin-1", nil, "")
	store.InsertLicence(ctx, inst.ID, "pro", 1, 0, nil, nil)
	svc := newServiceWithStore(store, newFakeBillingRail())

	if _, err := svc.BulkEnroll(ctx, "admin-1", BulkEnrollRequest{InstitutionID: inst.ID, LearnerIDs: []string{"l1"}}, "b"); err != nil {
		t.Fatalf("enroll l1: %v", err)
	}
	// Cap full: l2 rejected.
	if _, err := svc.BulkEnroll(ctx, "admin-1", BulkEnrollRequest{InstitutionID: inst.ID, LearnerIDs: []string{"l2"}}, "b2"); err != ErrSeatLimitExceeded {
		t.Fatalf("expected seat cap for l2, got %v", err)
	}
	// Free l1's seat, then l2 fits.
	if err := svc.RemoveEnrollment(ctx, "admin-1", inst.ID, "l1"); err != nil {
		t.Fatalf("remove l1: %v", err)
	}
	if store.licences[inst.ID].UsedSeats != 0 {
		t.Fatalf("seat not freed: used_seats=%d", store.licences[inst.ID].UsedSeats)
	}
	if res, err := svc.BulkEnroll(ctx, "admin-1", BulkEnrollRequest{InstitutionID: inst.ID, LearnerIDs: []string{"l2"}}, "b3"); err != nil || res.Succeeded != 1 {
		t.Fatalf("l2 should fit after free: succeeded=%d err=%v", res.Succeeded, err)
	}
}

// ── Licence SM service path (suspend → reactivate → expire) ───────────────────────

func TestLicenceLifecycle_Service(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inst, _ := store.InsertInstitution(ctx, "Delta", "school", "admin-1", nil, "")
	lic, _ := store.InsertLicence(ctx, inst.ID, "pro", 5, 0, nil, nil)

	svc := newServiceWithStore(store, newFakeBillingRail())

	if _, err := svc.SuspendLicence(ctx, "admin-1", lic.ID); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	// Suspend again is illegal (suspended→suspended).
	if _, err := svc.SuspendLicence(ctx, "admin-1", lic.ID); err != ErrIllegalTransition {
		t.Errorf("double-suspend should be illegal, got %v", err)
	}
	if _, err := svc.ReactivateLicence(ctx, "admin-1", lic.ID); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	if _, err := svc.ExpireLicence(ctx, "admin-1", lic.ID); err != nil {
		t.Fatalf("expire: %v", err)
	}
	// Expired is terminal.
	if _, err := svc.ReactivateLicence(ctx, "admin-1", lic.ID); err != ErrIllegalTransition {
		t.Errorf("reactivate after expire should be illegal, got %v", err)
	}
}

// ── Billing: charge once (rail invoked exactly once across replays) ───────────────

func TestChargeBilling_Once(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inst, _ := store.InsertInstitution(ctx, "Epsilon", "school", "admin-1", nil, "va-9")
	svc := newServiceWithStore(store, nil)
	rail := newFakeBillingRail()
	svc.billing = rail

	b, err := svc.GenerateBilling(ctx, "admin-1", GenerateBillingRequest{InstitutionID: inst.ID, Period: "2026-06", AmountMinor: 250000})
	if err != nil {
		t.Fatalf("generate billing: %v", err)
	}
	if b.State != BillingOpen {
		t.Fatalf("new billing must be open, got %s", b.State)
	}

	paid, err := svc.ChargeBilling(ctx, "admin-1", b.ID, "idem-1")
	if err != nil {
		t.Fatalf("charge: %v", err)
	}
	if paid.State != BillingPaid {
		t.Errorf("expected paid, got %s", paid.State)
	}

	// Replay: already paid → no second rail charge.
	again, err := svc.ChargeBilling(ctx, "admin-1", b.ID, "idem-1")
	if err != nil {
		t.Fatalf("charge replay: %v", err)
	}
	if again.State != BillingPaid {
		t.Errorf("replay expected paid, got %s", again.State)
	}
	if rail.calls["idem-1"] != 1 {
		t.Errorf("billing rail must be charged exactly once, got %d", rail.calls["idem-1"])
	}
}

// ChargeBilling requires an idempotency key (money path).
func TestChargeBilling_RequiresIdemKey(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inst, _ := store.InsertInstitution(ctx, "Zeta", "school", "admin-1", nil, "")
	svc := newServiceWithStore(store, newFakeBillingRail())
	b, _ := svc.GenerateBilling(ctx, "admin-1", GenerateBillingRequest{InstitutionID: inst.ID, Period: "2026-07", AmountMinor: 1000})
	if _, err := svc.ChargeBilling(ctx, "admin-1", b.ID, ""); err != ErrIdempotencyRequired {
		t.Errorf("expected idempotency_key_required, got %v", err)
	}
}

// StubBillingRail must be deterministic + idempotent (same idemKey → same ref).
func TestStubBillingRail_IdempotentRef(t *testing.T) {
	r := StubBillingRail{}
	ctx := context.Background()
	a, _ := r.Charge(ctx, "inst-va", "bill-1", "idem-x", 5000)
	b, _ := r.Charge(ctx, "inst-va", "bill-1", "idem-x", 5000)
	if a != b {
		t.Errorf("same idemKey must yield same ref: %q != %q", a, b)
	}
}
