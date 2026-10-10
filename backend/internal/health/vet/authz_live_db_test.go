package healthvet

// LIVE-DB regression coverage for the vet authorization gaps fixed in this
// change:
//
//   - Dispatch checked the appointment's visit_type BEFORE the verified-vet
//     gate, so a foreign actor could learn another owner's appointment
//     details from the error. The HL-2 actor gate now runs first.
//   - Book's idempotency replay was unscoped: replaying another owner's key
//     returned THEIR appointment (escrow id, totals) — and would mint an
//     orphaned scheduling row before escrow.Hold deduped onto the victim's
//     hold. The lookup is now owner-scoped and a foreign key is refused
//     BEFORE the scheduling engine and the money leg run.
//
// Skips unless TEST_DATABASE_URL is set (same gate as the other vet tests).

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func vetAuthzPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet authz live-DB tests")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// vetAuthzDispatch records CreateDelivery calls.
type vetAuthzDispatch struct{ calls []string }

func (d *vetAuthzDispatch) CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error) {
	d.calls = append(d.calls, senderID+"|"+reference)
	return "deliv-" + reference, nil
}

// vetAuthzEscrow records money-rail calls so tests can prove a refused replay
// never reaches escrow.
type vetAuthzEscrow struct{ holds []string }

type vetAuthzHoldRef struct{ id string }

func (h vetAuthzHoldRef) HoldID() string { return h.id }

func (e *vetAuthzEscrow) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error) {
	e.holds = append(e.holds, payerID+"|"+idemKey)
	return vetAuthzHoldRef{id: uuid.New().String()}, nil
}
func (e *vetAuthzEscrow) Release(ctx context.Context, escrowID, payeeID string) error { return nil }
func (e *vetAuthzEscrow) Refund(ctx context.Context, escrowID string) error           { return nil }

// seedVetAuthzFixture creates a vet (owner vetOwnerID), a pet owner with a pet
// and an ACCEPTED appointment + HELD payment row under a known idempotency
// key, plus a foreign bystander who owns their own pet. Returns the seeded ids.
func seedVetAuthzFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, visitType string) (providerID, vetOwnerID, ownerID, foreignID, foreignPetID, serviceID, apptID, idemKey string) {
	t.Helper()
	vetOwnerID = uuid.New().String()
	ownerID = uuid.New().String()
	foreignID = uuid.New().String()
	for _, u := range []string{vetOwnerID, ownerID, foreignID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	providerID = seedVetProvider(t, ctx, pool, vetOwnerID)
	serviceID = seedVetService(t, ctx, pool, providerID)

	petID := uuid.New().String()
	foreignPetID = uuid.New().String()
	for pet, owner := range map[string]string{petID: ownerID, foreignPetID: foreignID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO pets (id, owner_user_id, name, species) VALUES ($1,$2,'Authz Pet','dog')`,
			pet, owner); err != nil {
			t.Fatalf("seed pet: %v", err)
		}
	}

	apptID = uuid.New().String()
	idemKey = "authz-vet-" + apptID
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET',$4,'ACCEPTED', now() + interval '1 day', now() + interval '1 day 1 hour')`,
		apptID, providerID, ownerID, visitType); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments (id, appointment_id, owner_id, provider_id, pet_id, service_id, visit_type, total_kobo, pay_state, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,200000,'HELD',$8)`,
		uuid.New().String(), apptID, ownerID, providerID, petID, serviceID, visitType, idemKey); err != nil {
		t.Fatalf("seed payment row: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id=$1`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM health_appointments WHERE id=$1`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM pets WHERE id IN ($1,$2)`, petID, foreignPetID)
	})
	return providerID, vetOwnerID, ownerID, foreignID, foreignPetID, serviceID, apptID, idemKey
}

// A foreign actor probing a TELE appointment must get the uniform not-found
// refusal — not the "dispatch only applies to HOME visits" answer that would
// confirm the appointment exists and reveal its visit type.
func TestLiveDB_Dispatch_RoleBeforeVisitCheck(t *testing.T) {
	pool := vetAuthzPool(t)
	ctx := t.Context()
	providerID, vetOwnerID, _, foreignID, _, _, apptID, _ := seedVetAuthzFixture(t, ctx, pool, "TELE")

	disp := &vetAuthzDispatch{}
	gate := fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true}
	svc := NewService(pool, nil, disp, gate, nil, nil, nil, nil, nil, nil, nil)

	_, err := svc.Dispatch(ctx, foreignID, apptID)
	if !errors.Is(err, ErrAppointmentNotFound) {
		t.Fatalf("foreign Dispatch = %v, want ErrAppointmentNotFound (no existence/visit-type leak)", err)
	}
	if len(disp.calls) != 0 {
		t.Fatalf("refused Dispatch must not book transport: %v", disp.calls)
	}

	// The legitimate vet still gets the meaningful visit-type error on TELE.
	if _, err := svc.Dispatch(ctx, vetOwnerID, apptID); err == nil || !strings.Contains(err.Error(), "HOME visits") {
		t.Fatalf("vet Dispatch on TELE = %v, want the visit-type refusal", err)
	}
}

// The verified vet owner dispatches a HOME-visit appointment normally —
// the reorder must not break the legitimate flow.
func TestLiveDB_Dispatch_HomeVisitSucceeds(t *testing.T) {
	pool := vetAuthzPool(t)
	ctx := t.Context()
	providerID, vetOwnerID, ownerID, _, _, _, apptID, _ := seedVetAuthzFixture(t, ctx, pool, "HOME")

	disp := &vetAuthzDispatch{}
	gate := fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true}
	svc := NewService(pool, nil, disp, gate, nil, nil, nil, nil, nil, nil, nil)

	out, err := svc.Dispatch(ctx, vetOwnerID, apptID)
	if err != nil {
		t.Fatalf("verified vet Dispatch on HOME appointment must succeed: %v", err)
	}
	if out.DeliveryRef == nil || !strings.HasPrefix(*out.DeliveryRef, "deliv-vet-homevisit:") {
		t.Fatalf("delivery_ref = %v, want the pinned dispatch ref", out.DeliveryRef)
	}
	if len(disp.calls) != 1 || !strings.HasPrefix(disp.calls[0], ownerID+"|") {
		t.Fatalf("dispatch calls = %v, want one call on the owner's behalf", disp.calls)
	}
}

// Idempotency replay is owner-scoped: the same owner gets their original
// appointment back; a different owner replaying the key is refused BEFORE the
// scheduling engine creates an appointment and before the money leg.
func TestLiveDB_Book_IdemReplayOwnerScoped(t *testing.T) {
	pool := vetAuthzPool(t)
	ctx := t.Context()
	providerID, vetOwnerID, ownerID, foreignID, foreignPetID, serviceID, apptID, idemKey := seedVetAuthzFixture(t, ctx, pool, "TELE")

	esc := &vetAuthzEscrow{}
	gate := fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true}
	svc := NewService(pool, esc, nil, gate, nil, nil, nil, nil, nil, nil, nil)

	var petID string
	if err := pool.QueryRow(ctx, `SELECT pet_id FROM vet_appointment_payments WHERE appointment_id=$1`, apptID).Scan(&petID); err != nil {
		t.Fatalf("read pet id: %v", err)
	}
	in := BookInput{
		ProviderID:     providerID,
		PetID:          petID,
		ServiceID:      serviceID,
		VisitType:      VisitTele,
		SlotStart:      time.Now().Add(24 * time.Hour),
		SlotEnd:        time.Now().Add(24*time.Hour + 30*time.Minute),
		IdempotencyKey: idemKey,
	}

	// Owner replay returns the original appointment — no new row, no hold.
	got, err := svc.Book(ctx, ownerID, in)
	if err != nil {
		t.Fatalf("owner replay must return the original appointment: %v", err)
	}
	if got.ID != apptID {
		t.Fatalf("owner replay returned appointment %s, want original %s", got.ID, apptID)
	}
	if len(esc.holds) != 0 {
		t.Fatalf("owner replay must not re-hold: %v", esc.holds)
	}

	// Foreign replay: the caller legitimately owns a pet (passes ownsPet), but
	// the key belongs to someone else — refused before sched.Request runs, so
	// no orphaned appointment row is minted for them.
	in.PetID = foreignPetID
	if _, err := svc.Book(ctx, foreignID, in); !errors.Is(err, ErrIdemConflict) {
		t.Fatalf("foreign replay must fail ErrIdemConflict, got %v", err)
	}
	if len(esc.holds) != 0 {
		t.Fatalf("foreign replay must not reach the money leg: holds=%v", esc.holds)
	}
	var foreignAppts int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_appointments WHERE patient_id=$1`, foreignID).Scan(&foreignAppts); err != nil {
		t.Fatalf("count foreign appointments: %v", err)
	}
	if foreignAppts != 0 {
		t.Fatalf("foreign replay minted %d orphaned appointments, want 0", foreignAppts)
	}
	var foreignPayments int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM vet_appointment_payments WHERE owner_id=$1`, foreignID).Scan(&foreignPayments); err != nil {
		t.Fatalf("count foreign payments: %v", err)
	}
	if foreignPayments != 0 {
		t.Fatalf("foreign replay wrote %d payment rows, want 0", foreignPayments)
	}
}
