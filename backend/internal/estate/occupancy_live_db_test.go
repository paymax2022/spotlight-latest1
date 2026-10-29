package estate

// LIVE-DB tests for the unit occupancy registry (estate-a M03: EST-UAT-0043, 0044, 0045, 0046,
// 0048, 0051, 0052) plus the three authz defects fixed in the same slice.
//
// Reuses the harness in service_dues_live_db_test.go (estateDuesTestPool, seedDuesUser, seedEstate,
// seedResident, auditCount). The rules under test live in the database —
// 20271099000060_estate_occupancy_integrity.sql — so these are the only tests that can prove them: a
// unit test of the Go front door would still pass with the writers, triggers and partial uniques
// dropped. Where a refusal is supposed to survive a caller that never goes through Go, the test writes
// the row with a bare INSERT and says so.
//
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Occupancy -v

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// occupancyDate renders today+shiftDays the way a date input sends it, which is the only format
// parseOccupancyDate accepts.
func occupancyDate(t *testing.T, shiftDays int) string {
	t.Helper()
	return time.Now().UTC().AddDate(0, 0, shiftDays).Format("2006-01-02")
}

// mustUnit adds a unit through the service, so the capacity default and the duplicate-unit-key
// pre-check are part of the evidence rather than bypassed by a direct INSERT.
func mustUnit(t *testing.T, ctx context.Context, svc *Service, estateID, adminID, label string, capacity int) *EstateProperty {
	t.Helper()
	p, err := svc.AddProperty(ctx, estateID, adminID, AddPropertyRequest{
		UnitLabel: label, PropertyType: "apartment", Capacity: capacity,
	})
	if err != nil {
		t.Fatalf("add property %s: %v", label, err)
	}
	return p
}

// unitState reads the three facts a unit is supposed to agree about: the flag, and the two party
// columns. Reading them from the row (not from what the service returned) is the point.
func unitState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, propertyID string) (status, landlordID, tenantID string) {
	t.Helper()
	err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT occupancy_status, COALESCE(landlord_id::text,''), COALESCE(tenant_id::text,'')
		   FROM estate_properties WHERE id=$1`, propertyID).Scan(&status, &landlordID, &tenantID)
	if err != nil {
		t.Fatalf("read unit state: %v", err)
	}
	return status, landlordID, tenantID
}

func liveOccupantCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, propertyID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT COUNT(*) FROM estate_unit_occupants WHERE property_id=$1 AND ended_at IS NULL`, propertyID).
		Scan(&n); err != nil {
		t.Fatalf("count occupants: %v", err)
	}
	return n
}

func mustAdmit(t *testing.T, ctx context.Context, svc *Service, estateID, actorID, propertyID, userID, kind string) *OccupancyAdmission {
	t.Helper()
	a, err := svc.AdmitOccupant(ctx, estateID, actorID, propertyID, AdmitOccupantRequest{UserID: userID, OccupancyType: kind})
	if err != nil {
		t.Fatalf("admit %s as %s: %v", userID, kind, err)
	}
	return a
}

// TestLiveDB_Occupancy_AdmitRegisterAndRelease is EST-UAT-0043 (who is in this unit, and what was
// recorded when) and EST-UAT-0046 (a move-out that keeps its history).
func TestLiveDB_Occupancy_AdmitRegisterAndRelease(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	owner := seedDuesUser(t, ctx, pool)
	peer := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, peer, "resident")
	unit := mustUnit(t, ctx, svc, estateID, adminID, "A-101", 4)

	a, err := svc.AdmitOccupant(ctx, estateID, adminID, unit.ID, AdmitOccupantRequest{
		UserID: owner, OccupancyType: OccupancyHomeowner, Note: "deed on file",
	})
	if err != nil {
		t.Fatalf("admit owner: %v", err)
	}
	if a.OccupancyType != OccupancyHomeowner || a.Role != "resident" || a.OccupantID == "" || a.ResidentID == "" {
		t.Fatalf("admission = %+v, want homeowner over a new resident", a)
	}

	// One decision writes all three: registration, deed column, occupancy flag. A unit cannot read
	// 'occupied' with nobody admitted, which is the state the pre-Phase-2.4 UPDATEs produced.
	if status, landlordID, _ := unitState(t, ctx, pool, unit.ID); status != "occupied" || landlordID != owner {
		t.Fatalf("unit after admission: status=%q landlord=%q, want occupied/%s", status, landlordID, owner)
	}
	if n := liveOccupantCount(t, ctx, pool, unit.ID); n != 1 {
		t.Fatalf("live occupants = %d, want 1", n)
	}
	if n := auditCount(t, ctx, pool, estateID, unit.ID, "ESTATE_UNIT_OCCUPANT_ADMITTED"); n != 1 {
		t.Fatalf("admission audit rows = %d, want 1", n)
	}

	// EST-UAT-0043's read side.
	register, err := svc.ListOccupancies(ctx, estateID, adminID, unit.ID, false)
	if err != nil {
		t.Fatalf("admin reads the unit register: %v", err)
	}
	if len(register) != 1 || register[0].UserID != owner || !register[0].InEffect || register[0].Note != "deed on file" {
		t.Fatalf("register = %+v", register)
	}
	mine, err := svc.ListOccupancies(ctx, estateID, owner, "", false)
	if err != nil {
		t.Fatalf("occupant reads their own units: %v", err)
	}
	if len(mine) != 1 || mine[0].PropertyID != unit.ID {
		t.Fatalf("own units = %+v, want this unit only", mine)
	}
	// A member is scoped to their own rows however the unit is named — the register is personal data.
	scoped, err := svc.ListOccupancies(ctx, estateID, peer, unit.ID, false)
	if err != nil {
		t.Fatalf("member reads the unit register: %v", err)
	}
	if len(scoped) != 0 {
		t.Fatalf("another member saw the occupancy: %+v", scoped)
	}

	// EST-UAT-0046: releasing ends the registration and recomputes the unit; the row is kept.
	rel, err := svc.ReleaseOccupant(ctx, estateID, adminID, unit.ID, owner, "moved out")
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if rel.OccupantID == "" || rel.OccupancyStatus != "vacant" {
		t.Fatalf("release = %+v, want vacant", rel)
	}
	if status, landlordID, _ := unitState(t, ctx, pool, unit.ID); status != "vacant" || landlordID != "" {
		t.Fatalf("unit after release: status=%q landlord=%q, want vacant/empty", status, landlordID)
	}
	history, err := svc.ListOccupancies(ctx, estateID, adminID, unit.ID, true)
	if err != nil {
		t.Fatalf("admin reads released history: %v", err)
	}
	if len(history) != 1 || history[0].EndedAt == nil || history[0].InEffect {
		t.Fatalf("history = %+v, want one ended, out-of-effect row", history)
	}
	if live, err := svc.ListOccupancies(ctx, estateID, adminID, unit.ID, false); err != nil || len(live) != 0 {
		t.Fatalf("live register = %+v / %v, want empty", live, err)
	}
	if n := auditCount(t, ctx, pool, estateID, unit.ID, "ESTATE_UNIT_OCCUPANT_RELEASED"); n != 1 {
		t.Fatalf("release audit rows = %d, want 1", n)
	}
	// Ending it twice is not a second move-out.
	if _, err := svc.ReleaseOccupant(ctx, estateID, adminID, unit.ID, owner, "again"); !errors.Is(err, ErrNoLiveOccupancy) {
		t.Fatalf("second release = %v, want ErrNoLiveOccupancy", err)
	}
}

// TestLiveDB_Occupancy_CapacityAndOverlap is EST-UAT-0044 (P0): "overlap beyond capacity not validated
// on approve". Before this slice an approval wrote a UUID column and nothing else, so a unit could
// carry any number of occupants and any number of owners.
func TestLiveDB_Occupancy_CapacityAndOverlap(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	first := seedDuesUser(t, ctx, pool)
	second := seedDuesUser(t, ctx, pool)
	third := seedDuesUser(t, ctx, pool)

	small := mustUnit(t, ctx, svc, estateID, adminID, "B-201", 2)
	mustAdmit(t, ctx, svc, estateID, adminID, small.ID, first, OccupancyResident)
	mustAdmit(t, ctx, svc, estateID, adminID, small.ID, second, OccupancyResident)

	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, small.ID,
		AdmitOccupantRequest{UserID: third, OccupancyType: OccupancyResident}); !errors.Is(err, ErrUnitCapacityExceeded) {
		t.Fatalf("third occupant in a capacity-2 unit = %v, want ErrUnitCapacityExceeded", err)
	}
	if n := liveOccupantCount(t, ctx, pool, small.ID); n != 2 {
		t.Fatalf("live occupants after refusal = %d, want the unit unchanged at 2", n)
	}

	// Capacity is a setting, but only downwards as far as the people already there allow.
	if _, err := svc.SetUnitCapacity(ctx, estateID, adminID, small.ID, 1); !errors.Is(err, ErrCapacityBelowOccupants) {
		t.Fatalf("lowering below who lives there = %v, want ErrCapacityBelowOccupants", err)
	}
	p, err := svc.SetUnitCapacity(ctx, estateID, adminID, small.ID, 3)
	if err != nil || p.Capacity != 3 {
		t.Fatalf("raising capacity = %+v / %v, want 3", p, err)
	}
	// The default is what the column says it is.
	if plain := mustUnit(t, ctx, svc, estateID, adminID, "B-204", 0); plain.Capacity != DefaultUnitCapacity {
		t.Fatalf("default capacity = %d, want %d", plain.Capacity, DefaultUnitCapacity)
	}

	// One current owner per unit. A second owner needs the explicit displacement flag, which is what a
	// reviewed transfer carries and what a plain approval does not.
	deed := mustUnit(t, ctx, svc, estateID, adminID, "B-202", 4)
	mustAdmit(t, ctx, svc, estateID, adminID, deed.ID, first, OccupancyHomeowner)
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, deed.ID,
		AdmitOccupantRequest{UserID: second, OccupancyType: OccupancyHomeowner}); !errors.Is(err, ErrUnitHasAnotherOwner) {
		t.Fatalf("second owner = %v, want ErrUnitHasAnotherOwner", err)
	}
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, deed.ID,
		AdmitOccupantRequest{UserID: second, OccupancyType: OccupancyHomeowner, ReplaceOwner: true}); err != nil {
		t.Fatalf("flagged owner replacement: %v", err)
	}
	if status, landlordID, _ := unitState(t, ctx, pool, deed.ID); status != "occupied" || landlordID != second {
		t.Fatalf("deed after replacement: status=%q landlord=%q, want occupied/%s", status, landlordID, second)
	}
	if n := liveOccupantCount(t, ctx, pool, deed.ID); n != 1 {
		t.Fatalf("live occupants after replacement = %d, want the displaced owner released, not accumulated", n)
	}

	// One current tenant per unit, and the unit's own landlord may admit that tenant — the privilege
	// half of the same row: an approval is reviewed by the owner, not by whoever asks.
	tenancy := mustUnit(t, ctx, svc, estateID, adminID, "B-203", 4)
	mustAdmit(t, ctx, svc, estateID, adminID, tenancy.ID, second, OccupancyHomeowner)
	tenantA := seedDuesUser(t, ctx, pool)
	tenantB := seedDuesUser(t, ctx, pool)
	if _, err := svc.AdmitOccupant(ctx, estateID, second, tenancy.ID,
		AdmitOccupantRequest{UserID: tenantA, OccupancyType: OccupancyTenant}); err != nil {
		t.Fatalf("landlord admits their tenant: %v", err)
	}
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, tenancy.ID,
		AdmitOccupantRequest{UserID: tenantB, OccupancyType: OccupancyTenant}); !errors.Is(err, ErrUnitHasAnotherTenant) {
		t.Fatalf("second tenant = %v, want ErrUnitHasAnotherTenant", err)
	}
	// A landlord may admit a tenant and nothing else: they cannot hand out ownership or move a
	// neighbour in.
	if _, err := svc.AdmitOccupant(ctx, estateID, second, tenancy.ID,
		AdmitOccupantRequest{UserID: third, OccupancyType: OccupancyHomeowner}); !errors.Is(err, ErrNotAuthorisedToAdmit) {
		t.Fatalf("landlord admits an owner = %v, want ErrNotAuthorisedToAdmit", err)
	}
	if _, err := svc.AdmitOccupant(ctx, estateID, tenantA, tenancy.ID,
		AdmitOccupantRequest{UserID: third, OccupancyType: OccupancyResident}); !errors.Is(err, ErrNotAuthorisedToAdmit) {
		t.Fatalf("a plain occupant admits somebody = %v, want ErrNotAuthorisedToAdmit", err)
	}
	// An occupant may end their own registration; they may not end somebody else's.
	if _, err := svc.ReleaseOccupant(ctx, estateID, tenantA, tenancy.ID, tenantA, "left"); err != nil {
		t.Fatalf("occupant ends their own registration: %v", err)
	}
	if _, err := svc.ReleaseOccupant(ctx, estateID, tenantA, tenancy.ID, second, "evict the owner"); !errors.Is(err, ErrNotAuthorisedToRelease) {
		t.Fatalf("occupant ends another's registration = %v, want ErrNotAuthorisedToRelease", err)
	}

	// The unit has to belong to the estate in the path, or every route here is a cross-estate write.
	otherAdmin := seedDuesUser(t, ctx, pool)
	otherEstate := seedEstate(t, ctx, pool, otherAdmin)
	foreign := mustUnit(t, ctx, svc, otherEstate, otherAdmin, "B-299", 4)
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, foreign.ID,
		AdmitOccupantRequest{UserID: third, OccupancyType: OccupancyResident}); !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("admit into another estate's unit = %v, want ErrUnitNotFound", err)
	}
	// A banned membership is not revived by an admission.
	banned := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, banned, "resident")
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`UPDATE estate_residents SET banned_at=NOW() WHERE estate_id=$1 AND user_id=$2`, estateID, banned); err != nil {
		t.Fatalf("ban resident: %v", err)
	}
	// deed has room (one live occupant, capacity 4), so the refusal below is the membership rule and
	// not the capacity pre-check that runs before it.
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, deed.ID,
		AdmitOccupantRequest{UserID: banned, OccupancyType: OccupancyResident}); !errors.Is(err, ErrResidencyNotActive) {
		t.Fatalf("admit a banned member = %v, want ErrResidencyNotActive", err)
	}
	// A malformed kind is the caller's mistake, not a write attempt.
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, small.ID,
		AdmitOccupantRequest{UserID: third, OccupancyType: "squatter"}); !errors.Is(err, ErrUnknownOccupancyType) {
		t.Fatalf("unknown kind = %v, want ErrUnknownOccupancyType", err)
	}
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, small.ID,
		AdmitOccupantRequest{UserID: third, OccupancyType: OccupancyResident,
			EffectiveFrom: occupancyDate(t, 10), EffectiveUntil: occupancyDate(t, 1)}); !errors.Is(err, ErrInvalidOccupancyWindow) {
		t.Fatalf("inverted window = %v, want ErrInvalidOccupancyWindow", err)
	}
}

// TestLiveDB_Occupancy_TermGate is EST-UAT-0045 (P0): a lease/occupancy window that does not cover
// today must gate what the member may do and stop them being charged for it — while a registration
// with no dates behaves exactly as it did before (the "NULL = unrestricted" decision).
func TestLiveDB_Occupancy_TermGate(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	future := seedDuesUser(t, ctx, pool)
	openEnded := seedDuesUser(t, ctx, pool)
	unit := mustUnit(t, ctx, svc, estateID, adminID, "C-301", 4)

	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, unit.ID, AdmitOccupantRequest{
		UserID: future, OccupancyType: OccupancyResident, EffectiveFrom: occupancyDate(t, 3),
	}); err != nil {
		t.Fatalf("admit with a future term: %v", err)
	}
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, unit.ID,
		AdmitOccupantRequest{UserID: openEnded, OccupancyType: OccupancyResident}); err != nil {
		t.Fatalf("admit dateless: %v", err)
	}

	rows, err := svc.ListOccupancies(ctx, estateID, adminID, unit.ID, false)
	if err != nil {
		t.Fatalf("read register: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("register = %+v, want both registrations readable", rows)
	}
	for _, r := range rows {
		wantInEffect := r.UserID == openEnded
		if r.InEffect != wantInEffect {
			t.Fatalf("%s in_effect=%v, want %v", r.UserID, r.InEffect, wantInEffect)
		}
	}

	// Member-gated action: refused inside the term, allowed outside it, allowed with no dates at all.
	if _, err := svc.GetProperty(ctx, estateID, future, unit.ID); !errors.Is(err, ErrResidencyNotInEffect) {
		t.Fatalf("out-of-term member action = %v, want ErrResidencyNotInEffect", err)
	}
	if _, err := svc.GetProperty(ctx, estateID, openEnded, unit.ID); err != nil {
		t.Fatalf("dateless member action: %v", err)
	}
	// Reading the register that explains the refusal is never itself gated.
	if _, err := svc.ListOccupancies(ctx, estateID, future, unit.ID, false); err != nil {
		t.Fatalf("out-of-term member reads their own occupancy: %v", err)
	}
	// An admin is not gated by which unit they sleep in.
	if _, err := svc.GetProperty(ctx, estateID, adminID, unit.ID); err != nil {
		t.Fatalf("admin read: %v", err)
	}

	// The dues half of the same decision: the person billed is exempt while their term is not running,
	// and their co-resident on the same unit is not.
	base := CreateInvoiceRequest{PropertyID: unit.ID, Category: "service_charge", AmountKobo: 50_000, DueDate: time.Now().AddDate(0, 0, 7)}
	r := base
	r.ResidentID = future
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, r); !errors.Is(err, ErrOutOfTermUnitExempt) {
		t.Fatalf("billing an out-of-term occupant = %v, want ErrOutOfTermUnitExempt", err)
	}
	r.ResidentID = openEnded
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, r); err != nil {
		t.Fatalf("billing a dateless occupant: %v", err)
	}
	r.ResidentID = future
	r.TermOverride = true
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, r); !errors.Is(err, ErrBillingOverrideNeedsReason) {
		t.Fatalf("override without a reason = %v, want ErrBillingOverrideNeedsReason", err)
	}
	r.TermOverrideReason = "arrears accrued before the term break"
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, r); err != nil {
		t.Fatalf("reasoned term override: %v", err)
	}
	if n := auditCount(t, ctx, pool, estateID, future, "INVOICE_TERM_OVERRIDE"); n != 1 {
		t.Fatalf("term override audit rows = %d, want 1", n)
	}
}

// TestLiveDB_Occupancy_VacantUnitExemption is EST-UAT-0048 (P1): the amount was taken as given, with no
// occupancy-based rule at all. The product decision is that a vacant unit is exempt unless an admin
// overrides it and says why.
func TestLiveDB_Occupancy_VacantUnitExemption(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	who := seedDuesUser(t, ctx, pool)

	empty := mustUnit(t, ctx, svc, estateID, adminID, "D-401", 4)
	if status, _, _ := unitState(t, ctx, pool, empty.ID); status != "vacant" {
		t.Fatalf("new unit status = %q, want vacant", status)
	}

	req := CreateInvoiceRequest{ResidentID: who, PropertyID: empty.ID, Category: "service_charge",
		AmountKobo: 75_000, DueDate: time.Now().AddDate(0, 0, 14)}
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, req); !errors.Is(err, ErrVacantUnitExempt) {
		t.Fatalf("billing a vacant unit = %v, want ErrVacantUnitExempt", err)
	}

	// The exemption is the database's, not the service's: a writer that never calls CreateInvoice is
	// refused the same way, which is what makes the rule hold for every future caller.
	_, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO estate_dues_invoices (estate_id, property_id, resident_id, category, amount_kobo, due_date)
		 VALUES ($1,$2,$3,'service_charge',75000, NOW()+interval '14 days')`,
		estateID, empty.ID, who)
	if err == nil || !strings.Contains(err.Error(), "vacant") {
		t.Fatalf("raw INSERT against a vacant unit = %v, want the exemption trigger to refuse it", err)
	}

	// The override is explicit, reasoned, and audited against the unit it waives.
	req.VacancyOverride = true
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, req); !errors.Is(err, ErrBillingOverrideNeedsReason) {
		t.Fatalf("override without a reason = %v, want ErrBillingOverrideNeedsReason", err)
	}
	req.VacancyOverrideReason = "owner agreed to keep paying while the unit is empty"
	inv, err := svc.CreateInvoice(ctx, estateID, adminID, req)
	if err != nil {
		t.Fatalf("reasoned vacancy override: %v", err)
	}
	if !inv.VacancyOverride || inv.VacancyOverrideReason != req.VacancyOverrideReason {
		t.Fatalf("invoice = %+v, want the override and its reason carried", inv)
	}
	if n := auditCount(t, ctx, pool, estateID, empty.ID, "INVOICE_VACANCY_OVERRIDE"); n != 1 {
		t.Fatalf("vacancy override audit rows = %d, want 1", n)
	}

	// Once somebody is admitted the unit is billable on its own facts, with no override in sight.
	mustAdmit(t, ctx, svc, estateID, adminID, empty.ID, who, OccupancyTenant)
	clean := CreateInvoiceRequest{ResidentID: who, PropertyID: empty.ID, Category: "service_charge",
		AmountKobo: 75_000, DueDate: time.Now().AddDate(0, 0, 14)}
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, clean); err != nil {
		t.Fatalf("billing an occupied unit: %v", err)
	}

	// The read shows the exemption state, so the console can tell a waived bill from an ordinary one.
	list, err := svc.ListInvoices(ctx, estateID, adminID, "")
	if err != nil {
		t.Fatalf("list invoices: %v", err)
	}
	var overridden int
	for _, l := range list {
		if l.EstateID != estateID {
			continue
		}
		if l.VacancyOverride {
			overridden++
		}
	}
	if overridden != 1 {
		t.Fatalf("invoices read back with vacancy_override = %d, want exactly 1", overridden)
	}
}

// TestLiveDB_Occupancy_ProofReview is EST-UAT-0051 (P0): the proof URL sat on a claim with no reviewer,
// no state and no member-level read, so the word printed on a resident card was pure self-declaration.
func TestLiveDB_Occupancy_ProofReview(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	claimant := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, claimant, "resident")
	unit := mustUnit(t, ctx, svc, estateID, adminID, "E-501", 4)
	otherAdmin := seedDuesUser(t, ctx, pool)
	otherEstate := seedEstate(t, ctx, pool, otherAdmin)
	foreign := mustUnit(t, ctx, svc, otherEstate, otherAdmin, "E-599", 4)

	docV1 := "https://files.local.test/deed-v1.pdf"
	if _, err := svc.UpsertProfile(ctx, estateID, claimant, UpsertProfileRequest{
		OccupancyType: OccupancyHomeowner, OwnershipDocURL: docV1,
	}); err != nil {
		t.Fatalf("declare occupancy: %v", err)
	}
	proof, err := svc.GetOccupancyProof(ctx, estateID, claimant, "")
	if err != nil {
		t.Fatalf("member reads their own proof: %v", err)
	}
	if proof.ProofStatus != ProofUnverified {
		t.Fatalf("proof before any review = %q, want %q", proof.ProofStatus, ProofUnverified)
	}
	// A member asking for somebody else's proof is given their own, not the other row.
	if peek, err := svc.GetOccupancyProof(ctx, estateID, claimant, adminID); err != nil || peek.UserID != claimant {
		t.Fatalf("member reads another's proof = %+v / %v, want their own row", peek, err)
	}

	// EST-UAT-0051's IDOR half: the claim never checked the unit against the estate in the path.
	if _, err := svc.ClaimOwnership(ctx, estateID, foreign.ID, claimant, docV1); !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("claim on another estate's unit = %v, want ErrUnitNotFound", err)
	}

	claim, err := svc.ClaimOwnership(ctx, estateID, unit.ID, claimant, docV1)
	if err != nil {
		t.Fatalf("file claim: %v", err)
	}
	if claim.Status != "pending" {
		t.Fatalf("claim = %+v, want pending", claim)
	}
	if proof, err = svc.GetOccupancyProof(ctx, estateID, claimant, ""); err != nil || proof.ProofStatus != ProofPending {
		t.Fatalf("proof after filing = %+v / %v, want pending", proof, err)
	}
	// The queue the review route always lacked.
	queue, err := svc.ListOwnershipClaims(ctx, estateID, adminID, "pending")
	if err != nil {
		t.Fatalf("admin reads the claim queue: %v", err)
	}
	var listed bool
	for _, q := range queue {
		if q.ID == claim.ID && q.UserID == claimant && q.OwnershipDocURL == docV1 {
			listed = true
		}
	}
	if !listed {
		t.Fatalf("claim %s not in the queue: %+v", claim.ID, queue)
	}
	if _, err := svc.ListOwnershipClaims(ctx, estateID, claimant, ""); err == nil {
		t.Fatal("a plain member read the estate's claim queue")
	}

	// Approving is not a colour change: it admits the owner through the same writer as everything else.
	reviewed, err := svc.ReviewOwnershipClaim(ctx, estateID, adminID, claim.ID, "approved", "")
	if err != nil {
		t.Fatalf("approve claim: %v", err)
	}
	if reviewed.Status != "approved" || reviewed.VerifiedBy == nil || *reviewed.VerifiedBy != adminID {
		t.Fatalf("reviewed claim = %+v, want approved by the admin", reviewed)
	}
	if status, landlordID, _ := unitState(t, ctx, pool, unit.ID); status != "occupied" || landlordID != claimant {
		t.Fatalf("unit after approval: status=%q landlord=%q, want occupied/%s", status, landlordID, claimant)
	}
	proof, err = svc.GetOccupancyProof(ctx, estateID, adminID, claimant)
	if err != nil {
		t.Fatalf("admin reads the claimant's proof: %v", err)
	}
	if proof.ProofStatus != ProofVerified || proof.ProofVerifiedBy != adminID || proof.ProofVerifiedAt == nil {
		t.Fatalf("proof after approval = %+v, want verified by the admin", proof)
	}
	if _, err := svc.GetResidentCard(ctx, estateID, claimant); err != nil {
		t.Fatalf("resident card: %v", err)
	}
	// A decided claim cannot be decided again.
	if _, err := svc.ReviewOwnershipClaim(ctx, estateID, adminID, claim.ID, "approved", ""); !errors.Is(err, ErrClaimReviewed) {
		t.Fatalf("second review = %v, want ErrClaimReviewed", err)
	}
	if _, err := svc.ReviewOwnershipClaim(ctx, estateID, adminID, uuid.New().String(), "approved", ""); !errors.Is(err, ErrClaimNotFound) {
		t.Fatalf("unknown claim = %v, want ErrClaimNotFound", err)
	}
	if _, err := svc.ReviewOwnershipClaim(ctx, estateID, adminID, claim.ID, "maybe", ""); !errors.Is(err, ErrInvalidReviewDecision) {
		t.Fatalf("invalid decision = %v, want ErrInvalidReviewDecision", err)
	}

	// Re-declaring a document resets the verdict — the trigger, so no Go path can skip it. The
	// approval survives only as long as the file it covered.
	if _, err := svc.UpsertProfile(ctx, estateID, claimant, UpsertProfileRequest{
		OccupancyType: OccupancyHomeowner, OwnershipDocURL: "https://files.local.test/deed-v2.pdf",
	}); err != nil {
		t.Fatalf("re-declare with a new document: %v", err)
	}
	proof, err = svc.GetOccupancyProof(ctx, estateID, claimant, "")
	if err != nil {
		t.Fatalf("read proof after re-declaration: %v", err)
	}
	if proof.ProofStatus != ProofUnverified || proof.ProofVerifiedBy != "" {
		t.Fatalf("proof after re-declaration = %+v, want unverified with no reviewer", proof)
	}
	// An estate with nothing on file has nothing to approve.
	undocumented := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, undocumented, "resident")
	if _, err := svc.UpsertProfile(ctx, estateID, undocumented, UpsertProfileRequest{OccupancyType: "tenant"}); err != nil {
		t.Fatalf("declare without a document: %v", err)
	}
	if _, err := svc.VerifyOccupancyProof(ctx, estateID, adminID, undocumented, ProofVerified, "nothing filed"); !errors.Is(err, ErrProofNeedsDocument) {
		t.Fatalf("verifying an empty declaration = %v, want ErrProofNeedsDocument", err)
	}
	if _, err := svc.VerifyOccupancyProof(ctx, estateID, adminID, claimant, "approved", ""); !errors.Is(err, ErrInvalidProofDecision) {
		t.Fatalf("bad proof decision = %v, want ErrInvalidProofDecision", err)
	}
	// A decision is the estate's to record, not the resident's.
	if _, err := svc.VerifyOccupancyProof(ctx, estateID, claimant, claimant, ProofRejected, "self-verified"); err == nil {
		t.Fatal("a member recorded their own proof decision")
	}
	proof, err = svc.VerifyOccupancyProof(ctx, estateID, adminID, claimant, ProofRejected, "scan illegible")
	if err != nil {
		t.Fatalf("reject proof: %v", err)
	}
	if proof.ProofStatus != ProofRejected || proof.ProofReviewNote != "scan illegible" {
		t.Fatalf("rejected proof = %+v", proof)
	}
	// Filing again puts it back in the queue from the rejected state.
	if _, err := svc.ClaimOwnership(ctx, estateID, unit.ID, claimant, "https://files.local.test/deed-v3.pdf"); err != nil {
		t.Fatalf("re-file after rejection: %v", err)
	}
	if proof, err = svc.GetOccupancyProof(ctx, estateID, claimant, ""); err != nil || proof.ProofStatus != ProofPending {
		t.Fatalf("proof after re-filing = %+v / %v, want pending", proof, err)
	}
}

// TestLiveDB_Occupancy_ArchiveAndStatusGates is EST-UAT-0052: the flag used to outrank the register, so
// an admin could declare a populated unit vacant (switching off every billing and access rule that reads
// 'vacant') or archive one somebody still owns.
func TestLiveDB_Occupancy_ArchiveAndStatusGates(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	owner := seedDuesUser(t, ctx, pool)

	live := mustUnit(t, ctx, svc, estateID, adminID, "G-701", 4)
	mustAdmit(t, ctx, svc, estateID, adminID, live.ID, owner, OccupancyHomeowner)

	if _, err := svc.SetOccupancyStatus(ctx, estateID, adminID, live.ID, "vacant"); !errors.Is(err, ErrUnitHasLiveOccupants) {
		t.Fatalf("flagging a populated unit vacant = %v, want ErrUnitHasLiveOccupants", err)
	}
	if _, err := svc.SetOccupancyStatus(ctx, estateID, adminID, live.ID, "moved-in"); !errors.Is(err, ErrInvalidOccupancyStatus) {
		t.Fatalf("free-text status = %v, want ErrInvalidOccupancyStatus", err)
	}
	if err := svc.ArchiveProperty(ctx, estateID, adminID, live.ID); !errors.Is(err, ErrUnitHasLiveOccupants) {
		t.Fatalf("archiving a populated unit = %v, want ErrUnitHasLiveOccupants", err)
	}

	// A legacy unit that carries a deed owner but no registrations (the state before the registry) is
	// still not archiveable: somebody owns it.
	legacy := mustUnit(t, ctx, svc, estateID, adminID, "G-702", 4)
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`UPDATE estate_properties SET landlord_id=$2 WHERE id=$1`, legacy.ID, owner); err != nil {
		t.Fatalf("seed legacy deed: %v", err)
	}
	if err := svc.ArchiveProperty(ctx, estateID, adminID, legacy.ID); !errors.Is(err, ErrUnitHasDeedOwner) {
		t.Fatalf("archiving a unit with an owner on the deed = %v, want ErrUnitHasDeedOwner", err)
	}

	// An open receivable is the third gate; a vacant unit with a waived-through override on it is the
	// case where the admin has to settle or waive the invoice before retiring the unit.
	billed := mustUnit(t, ctx, svc, estateID, adminID, "G-703", 4)
	if _, err := svc.CreateInvoice(ctx, estateID, adminID, CreateInvoiceRequest{
		ResidentID: owner, PropertyID: billed.ID, Category: "service_charge", AmountKobo: 40_000,
		DueDate: time.Now().AddDate(0, 0, 7), VacancyOverride: true, VacancyOverrideReason: "agreed while empty",
	}); err != nil {
		t.Fatalf("seed invoice: %v", err)
	}
	if err := svc.ArchiveProperty(ctx, estateID, adminID, billed.ID); !errors.Is(err, ErrUnitHasOpenInvoices) {
		t.Fatalf("archiving a unit with an open invoice = %v, want ErrUnitHasOpenInvoices", err)
	}

	// With nothing in it and nothing owed, archiving works — and a retired unit is gone for the writers:
	// estate_occupancy_admit() selects live units only, so an admission against it is the same 404 as any
	// other unknown unit. A registration written straight at the row is what the durable guard catches.
	retired := mustUnit(t, ctx, svc, estateID, adminID, "G-704", 4)
	if err := svc.ArchiveProperty(ctx, estateID, adminID, retired.ID); err != nil {
		t.Fatalf("archive an empty unit: %v", err)
	}
	if _, err := svc.AdmitOccupant(ctx, estateID, adminID, retired.ID,
		AdmitOccupantRequest{UserID: owner, OccupancyType: OccupancyResident}); !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("admit into an archived unit = %v, want ErrUnitNotFound", err)
	}
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO estate_unit_occupants (estate_id, property_id, user_id, occupancy_type)
		 VALUES ($1,$2,$3,'resident')`, estateID, retired.ID, owner); err == nil || !strings.Contains(err.Error(), "archived") {
		t.Fatalf("raw registration on an archived unit = %v, want the capacity trigger to refuse it", err)
	}
	if _, err := svc.ClaimOwnership(ctx, estateID, retired.ID, owner, "https://files.local.test/deed.pdf"); !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("claim on an archived unit = %v, want ErrUnitNotFound", err)
	}
	// The same label may be reused once the unit is retired; the key is unique among live units.
	if again := mustUnit(t, ctx, svc, estateID, adminID, "G-704", 4); again.ID == retired.ID {
		t.Fatal("re-adding a retired unit's label returned the retired row")
	}
	if _, err := svc.AddProperty(ctx, estateID, adminID, AddPropertyRequest{
		UnitLabel: "G-704", PropertyType: "apartment",
	}); !errors.Is(err, ErrDuplicateUnitKey) {
		t.Fatalf("duplicate live label = %v, want ErrDuplicateUnitKey", err)
	}
	// A transfer request names a type the module has to understand.
	if _, err := svc.RequestPropertyTransfer(ctx, estateID, owner, billed.ID,
		RequestPropertyTransferBody{ToUserID: adminID, TransferType: "half-share"}); !errors.Is(err, ErrInvalidTransferType) {
		t.Fatalf("free-text transfer type = %v, want ErrInvalidTransferType", err)
	}
}

// TestLiveDB_Occupancy_TenancyApprovalAdmitsWithoutDemotion covers the two occupancy-shaped defects the
// tenancy approval carried: it DEMOTED an estate_admin who happened to be the tenant (the residency
// upsert wrote role='resident' unconditionally), and it threw the lease dates away so nothing downstream
// could tell whether the tenancy had started (EST-UAT-0045's gate needs them).
func TestLiveDB_Occupancy_TenancyApprovalAdmitsWithoutDemotion(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	unit := mustUnit(t, ctx, svc, estateID, adminID, "F-602", 4)
	ownerID := seedDuesUser(t, ctx, pool)
	mustAdmit(t, ctx, svc, estateID, adminID, unit.ID, ownerID, OccupancyHomeowner)

	// An estate admin takes a tenancy in a neighbour's unit.
	adminTenant := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, adminTenant, "estate_admin")
	tr, err := svc.CreateTenancyRequest(ctx, estateID, unit.ID, TenancyRequestBody{
		LandlordID: ownerID, LeaseStart: occupancyDate(t, -1), LeaseEnd: occupancyDate(t, 365),
		AgreementURL: "https://files.local.test/tenancy.pdf",
	}, adminTenant)
	if err != nil {
		t.Fatalf("file tenancy request: %v", err)
	}
	if tr.LandlordID != ownerID {
		t.Fatalf("request = %+v, want the unit's own landlord resolved server-side", tr)
	}
	// Only the landlord it was addressed to may decide it, and only through the unit it was filed
	// against — a request id is not a capability over a different unit's lease.
	if _, err := svc.ReviewTenancyRequest(ctx, estateID, unit.ID, tr.ID, adminID, "approved", ""); !errors.Is(err, ErrTenancyNotReviewable) {
		t.Fatalf("another admin approves = %v, want ErrTenancyNotReviewable", err)
	}
	neighbour := mustUnit(t, ctx, svc, estateID, adminID, "F-604", 4)
	if _, err := svc.ReviewTenancyRequest(ctx, estateID, neighbour.ID, tr.ID, ownerID, "approved", ""); !errors.Is(err, ErrTenancyNotReviewable) {
		t.Fatalf("landlord approves under the wrong unit path = %v, want ErrTenancyNotReviewable", err)
	}
	approved, err := svc.ReviewTenancyRequest(ctx, estateID, unit.ID, tr.ID, ownerID, "approved", "")
	if err != nil {
		t.Fatalf("landlord approves: %v", err)
	}
	if approved.Status != "approved" || approved.ReviewedBy == nil || *approved.ReviewedBy != ownerID || approved.ReviewedAt == nil {
		t.Fatalf("approved request = %+v, want the reviewer and timestamp recorded", approved)
	}

	// The admin who moved in is still an admin.
	if role := residentRole(t, ctx, pool, estateID, adminTenant); role != "estate_admin" {
		t.Fatalf("role after tenancy approval = %q, want estate_admin (the demotion defect)", role)
	}
	// The lease window is on the registration, and it is running. Read as the estate admin: a member's
	// register read is scoped to their own rows, which is ESTA-D033 — the landlord who just approved this
	// tenancy cannot read it back off the unit they own.
	rows, err := svc.ListOccupancies(ctx, estateID, adminID, unit.ID, false)
	if err != nil {
		t.Fatalf("admin reads the unit register: %v", err)
	}
	var found bool
	for _, r := range rows {
		if r.UserID == adminTenant {
			found = true
			if r.OccupancyType != OccupancyTenant || r.EffectiveFrom == nil || r.EffectiveUntil == nil || !r.InEffect {
				t.Fatalf("tenancy registration = %+v, want tenant kind over the lease window", r)
			}
		}
	}
	if !found {
		t.Fatalf("approved tenancy left no registration: %+v", rows)
	}
	if landlordView, err := svc.ListOccupancies(ctx, estateID, ownerID, unit.ID, false); err != nil || len(landlordView) != 1 {
		t.Fatalf("landlord's own register view = %+v / %v, want their single row", landlordView, err)
	}
	if status, _, tenantID := unitState(t, ctx, pool, unit.ID); status != "occupied" || tenantID != adminTenant {
		t.Fatalf("unit: status=%q tenant=%q, want occupied/%s", status, tenantID, adminTenant)
	}
	// An approved agreement is a checked document.
	proof, err := svc.GetOccupancyProof(ctx, estateID, adminTenant, "")
	if err != nil || proof.ProofStatus != ProofVerified {
		t.Fatalf("proof after tenancy approval = %+v / %v, want verified", proof, err)
	}
	// Reviewing it again is not a second admission.
	if _, err := svc.ReviewTenancyRequest(ctx, estateID, unit.ID, tr.ID, ownerID, "approved", ""); !errors.Is(err, ErrTenancyNotReviewable) {
		t.Fatalf("second review = %v, want ErrTenancyNotReviewable", err)
	}

	// A unit nobody owns has no reviewer, and the request route says so instead of filing an orphan.
	orphan := mustUnit(t, ctx, svc, estateID, adminID, "F-603", 4)
	if _, err := svc.CreateTenancyRequest(ctx, estateID, orphan.ID, TenancyRequestBody{
		LandlordID: adminID, LeaseStart: occupancyDate(t, 0),
	}, seedDuesUser(t, ctx, pool)); !errors.Is(err, ErrUnitNoLandlord) {
		t.Fatalf("request on an ownerless unit = %v, want ErrUnitNoLandlord", err)
	}
	// A unit in another estate is not in this one.
	otherAdmin := seedDuesUser(t, ctx, pool)
	otherEstate := seedEstate(t, ctx, pool, otherAdmin)
	foreign := mustUnit(t, ctx, svc, otherEstate, otherAdmin, "F-699", 4)
	if _, err := svc.CreateTenancyRequest(ctx, estateID, foreign.ID, TenancyRequestBody{
		LandlordID: adminID, LeaseStart: occupancyDate(t, 0),
	}, ownerID); !errors.Is(err, ErrUnitNotFound) {
		t.Fatalf("request on another estate's unit = %v, want ErrUnitNotFound", err)
	}
	// The transfer queue is admin-only and names its own bad decisions.
	if _, err := svc.ReviewPropertyTransfer(ctx, estateID, adminID, uuid.New().String(), "maybe"); !errors.Is(err, ErrInvalidReviewDecision) {
		t.Fatalf("bad transfer decision = %v, want ErrInvalidReviewDecision", err)
	}
	if _, err := svc.ReviewPropertyTransfer(ctx, estateID, adminID, uuid.New().String(), "approved"); !errors.Is(err, ErrPropertyTransferNotFound) {
		t.Fatalf("unknown transfer = %v, want ErrPropertyTransferNotFound", err)
	}
}

// TestLiveDB_Occupancy_CrossEstateVehicleVerification is the third authz defect in this slice: the
// UPDATE was keyed on the vehicle id alone, so any estate's admin could verify another estate's vehicle.
func TestLiveDB_Occupancy_CrossEstateVehicleVerification(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	mine := seedDuesUser(t, ctx, pool)
	estateA := seedEstate(t, ctx, pool, mine)
	theirs := seedDuesUser(t, ctx, pool)
	estateB := seedEstate(t, ctx, pool, theirs)
	neighbor := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateB, neighbor, "resident")

	v, err := svc.AddVehicle(ctx, estateB, neighbor, AddVehicleRequest{Plate: "UAT-123XA", DocURL: "https://files.local.test/insurance.pdf"})
	if err != nil {
		t.Fatalf("register vehicle in estate B: %v", err)
	}
	// Estate A's admin holds every privilege in A; this one does not extend to B's rows.
	if err := svc.VerifyVehicle(ctx, estateA, mine, v.ID); !errors.Is(err, ErrVehicleNotFound) {
		t.Fatalf("cross-estate verification = %v, want ErrVehicleNotFound", err)
	}
	if verified := vehicleVerified(t, ctx, pool, v.ID); verified {
		t.Fatal("the vehicle was verified by another estate's admin")
	}
	if err := svc.VerifyVehicle(ctx, estateB, theirs, v.ID); err != nil {
		t.Fatalf("in-estate verification: %v", err)
	}
	if verified := vehicleVerified(t, ctx, pool, v.ID); !verified {
		t.Fatal("the owning estate's admin did not verify the vehicle")
	}
	// Re-registering the same plate with a different document revokes the old verdict; the same
	// document keeps it.
	if _, err := svc.AddVehicle(ctx, estateB, neighbor, AddVehicleRequest{Plate: "UAT-123XA", DocURL: "https://files.local.test/insurance-2027.pdf"}); err != nil {
		t.Fatalf("re-register with a new document: %v", err)
	}
	if verified := vehicleVerified(t, ctx, pool, v.ID); verified {
		t.Fatal("a replaced document inherited the previous approval")
	}
}

func vehicleVerified(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vehicleID string) bool {
	t.Helper()
	var verified bool
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT verified FROM resident_vehicles WHERE id=$1`, vehicleID).Scan(&verified); err != nil {
		t.Fatalf("read vehicle: %v", err)
	}
	return verified
}
