package feesfeeschedule

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// PURE tests — no DB. The pgx Repository is replaced by an in-memory fakeStore so the
// SF-1 immutability guard is exercised WITHOUT a live DB (mirrors edupay_test.go). The
// SF-1 tests ACTIVELY attempt to mutate a locked / referenced schedule and assert the
// mutation is refused — a test that never attempts the violation proves nothing.

type fakeStore struct {
	items    map[string]*FeeSchedule
	refCount map[string]int64 // feeScheduleID → referencing invoice count
	seq      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{items: map[string]*FeeSchedule{}, refCount: map[string]int64{}}
}

// Insert implements Store.Insert (signature matches the real Repository exactly).
func (f *fakeStore) Insert(_ context.Context, fs FeeSchedule, dueDate *time.Time) (*FeeSchedule, error) {
	return f.insert(fs, dueDate), nil
}

func (f *fakeStore) insert(fs FeeSchedule, dueDate *time.Time) *FeeSchedule {
	f.seq++
	fs.ID = "fee-" + itoa(f.seq)
	fs.Status = "active"
	fs.DueDate = dueDate
	if fs.Currency == "" {
		fs.Currency = "NGN"
	}
	if fs.FeeItems == nil {
		fs.FeeItems = json.RawMessage("[]")
	}
	if fs.InstallmentPolicy == nil {
		fs.InstallmentPolicy = json.RawMessage("{}")
	}
	cp := fs
	f.items[fs.ID] = &cp
	return &cp
}

func (f *fakeStore) Get(_ context.Context, id string) (*FeeSchedule, error) {
	fs, ok := f.items[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *fs
	return &out, nil
}

func (f *fakeStore) List(_ context.Context, schoolID, sessionID, classID string) ([]FeeSchedule, error) {
	out := []FeeSchedule{}
	for _, fs := range f.items {
		if fs.SchoolID == schoolID {
			out = append(out, *fs)
		}
	}
	return out, nil
}

func (f *fakeStore) CountReferencingInvoices(_ context.Context, id string) (int64, error) {
	return f.refCount[id], nil
}

func (f *fakeStore) UpdateMutable(_ context.Context, id, name string, dueDate *time.Time, touchDueDate bool) (*FeeSchedule, error) {
	fs, ok := f.items[id]
	if !ok {
		return nil, ErrNotFound
	}
	if fs.Locked {
		return nil, ErrFeeScheduleImmutable
	}
	if name != "" {
		fs.Name = name
	}
	out := *fs
	return &out, nil
}

func (f *fakeStore) Lock(_ context.Context, id string) (*FeeSchedule, error) {
	fs, ok := f.items[id]
	if !ok {
		return nil, ErrNotFound
	}
	fs.Locked = true
	out := *fs
	return &out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, _, _, _, _ string, _ any) error { return nil }

// helper: seed a schedule directly into the fake and return its id.
func seed(f *fakeStore) string {
	fs := f.insert(FeeSchedule{SchoolID: "school-1", Name: "Term 1", AmountMinor: 5000000,
		FeeItems:          json.RawMessage(`[{"label":"tuition","amountMinor":5000000}]`),
		InstallmentPolicy: json.RawMessage(`{"installments":3}`)}, nil)
	return fs.ID
}

// ── SF-1: locked schedule refuses every mutation ─────────────────────────────────

func TestSF1_LockedScheduleRefusesUpdate(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithStore(f)
	ctx := context.Background()
	id := seed(f)

	// Pre-lock: an update succeeds.
	if _, err := svc.Update(ctx, "owner-1", id, UpdateFeeScheduleRequest{Name: "Term 1 (rev)"}); err != nil {
		t.Fatalf("pre-lock update should succeed, got %v", err)
	}

	// Lock the schedule (simulates the first invoice issuing).
	if _, err := svc.Lock(ctx, "owner-1", id); err != nil {
		t.Fatalf("lock: %v", err)
	}

	// ACTIVELY attempt to mutate the now-locked schedule — MUST be refused with SF-1.
	if _, err := svc.Update(ctx, "owner-1", id, UpdateFeeScheduleRequest{Name: "sneaky rename"}); !errors.Is(err, ErrFeeScheduleImmutable) {
		t.Fatalf("SF-1: locked schedule update must return ErrFeeScheduleImmutable, got %v", err)
	}
	// The name must NOT have changed to the sneaky value.
	cur, _ := svc.Get(ctx, id)
	if cur.Name == "sneaky rename" {
		t.Fatal("SF-1 VIOLATED: locked schedule was mutated")
	}
}

// ── SF-1: schedule referenced by an invoice (locked flag NOT set) is still immutable ─

func TestSF1_ReferencedScheduleRefusesUpdate(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithStore(f)
	ctx := context.Background()
	id := seed(f)

	// Mark the schedule as referenced by an invoice WITHOUT setting the locked flag —
	// the belt-and-braces reference check must still make it immutable (SF-1).
	f.refCount[id] = 1

	if _, err := svc.Update(ctx, "owner-1", id, UpdateFeeScheduleRequest{Name: "should fail"}); !errors.Is(err, ErrFeeScheduleImmutable) {
		t.Fatalf("SF-1: referenced schedule update must return ErrFeeScheduleImmutable, got %v", err)
	}
	cur, _ := svc.Get(ctx, id)
	if cur.Name == "should fail" {
		t.Fatal("SF-1 VIOLATED: invoice-referenced schedule was mutated")
	}
}

// ── SF-6: fee_items + installment_policy are set at creation only ────────────────
//
// There is deliberately no field on UpdateFeeScheduleRequest for fee_items or
// installment_policy, so they are STRUCTURALLY unmodifiable after creation. This test
// asserts they are persisted at creation and unchanged by an allowed (pre-lock) update.

func TestSF6_InstallmentTermsImmutable(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithStore(f)
	ctx := context.Background()
	fs, err := svc.Create(ctx, "owner-1", CreateFeeScheduleRequest{
		SchoolID:          "school-1",
		Name:              "Term 1",
		AmountMinor:       5000000,
		InstallmentPolicy: json.RawMessage(`{"installments":3}`),
		FeeItems:          json.RawMessage(`[{"label":"tuition"}]`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	before := string(fs.InstallmentPolicy)
	// A permitted update (name only) must not touch installment_policy / fee_items.
	upd, err := svc.Update(ctx, "owner-1", fs.ID, UpdateFeeScheduleRequest{Name: "Term 1b"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if string(upd.InstallmentPolicy) != before {
		t.Fatalf("SF-6: installment_policy must be immutable, changed %q → %q", before, string(upd.InstallmentPolicy))
	}
}

// ── Create validation ────────────────────────────────────────────────────────────

func TestCreate_Validation(t *testing.T) {
	svc := NewServiceWithStore(newFakeStore())
	ctx := context.Background()
	if _, err := svc.Create(ctx, "owner-1", CreateFeeScheduleRequest{SchoolID: "s", Name: "", AmountMinor: 100}); !errors.Is(err, ErrMissingName) {
		t.Fatalf("expected missing_name, got %v", err)
	}
	if _, err := svc.Create(ctx, "owner-1", CreateFeeScheduleRequest{SchoolID: "s", Name: "T", AmountMinor: 0}); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("expected invalid_amount for non-positive amount, got %v", err)
	}
	if _, err := svc.Create(ctx, "", CreateFeeScheduleRequest{SchoolID: "s", Name: "T", AmountMinor: 100}); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated, got %v", err)
	}
}

// ── Lock is idempotent ───────────────────────────────────────────────────────────

func TestLock_Idempotent(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithStore(f)
	ctx := context.Background()
	id := seed(f)
	if _, err := svc.Lock(ctx, "owner-1", id); err != nil {
		t.Fatalf("first lock: %v", err)
	}
	out, err := svc.Lock(ctx, "owner-1", id) // re-lock — no error
	if err != nil {
		t.Fatalf("second lock must be idempotent, got %v", err)
	}
	if !out.Locked {
		t.Fatal("schedule must remain locked")
	}
}
