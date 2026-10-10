package healthlab

// LIVE-DB regression coverage for the lab order-actor authorization gaps fixed
// in this change:
//
//   - Schedule previously let ANY authenticated user schedule (and, for HOME
//     orders, dispatch a phlebotomist against) a foreign order. It is now
//     gated to the lab's verified owner or a platform admin, before any state
//     probe or dispatch side effect.
//   - Collect only gated HOME collections (verified phlebotomist); WALK_IN was
//     unguarded, and the SCHEDULED-state check ran BEFORE the role check, so
//     a foreign actor could learn another patient's order state from the
//     error. The lab-staff gate now covers both collection methods and runs
//     before the state check. EnterResults/Release got the same reorder.
//   - CreateOrder's idempotency replay was unscoped; it is now owner-scoped
//     and a foreign key is refused BEFORE escrow.Hold.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func labAuthzPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping lab authz live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// labAuthzEscrow records money-rail calls so tests can prove a refused replay
// never reaches escrow.
type labAuthzEscrow struct{ holds []string }

type labAuthzHoldRef struct{ id string }

func (h labAuthzHoldRef) HoldID() string { return h.id }

func (e *labAuthzEscrow) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error) {
	e.holds = append(e.holds, payerID+"|"+idemKey)
	return labAuthzHoldRef{id: uuid.New().String()}, nil
}
func (e *labAuthzEscrow) Release(ctx context.Context, escrowID, payeeID string) error { return nil }
func (e *labAuthzEscrow) Refund(ctx context.Context, escrowID string) error           { return nil }

// labAuthzDispatch records CreateDelivery calls so tests can prove a denied
// Schedule never books transport.
type labAuthzDispatch struct{ calls []string }

func (d *labAuthzDispatch) CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error) {
	d.calls = append(d.calls, reference)
	return "deliv-" + reference, nil
}

// seedLabAuthzFixture creates a patient, an APPROVED lab owned by ownerID, and
// distinct scientist/phlebotomist/foreign actors. The provider-gate fake
// (authzFakeProv from authz_test.go) supplies the HL-2 answers.
func seedLabAuthzFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (patientID, ownerID, sciID, phleboID, foreignID, labID string) {
	t.Helper()
	patientID = uuid.New().String()
	ownerID = uuid.New().String()
	sciID = uuid.New().String()
	phleboID = uuid.New().String()
	foreignID = uuid.New().String()
	labID = uuid.New().String()
	for _, u := range []string{patientID, ownerID, sciID, phleboID, foreignID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user %s: %v", u, err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab','Authz Test Lab','APPROVED')`, labID, ownerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM lab_custody_events WHERE sample_id IN (SELECT id FROM lab_samples WHERE order_id IN (SELECT id FROM lab_orders WHERE lab_provider_id=$1))`, labID)
		_, _ = pool.Exec(bg, `DELETE FROM lab_samples WHERE order_id IN (SELECT id FROM lab_orders WHERE lab_provider_id=$1)`, labID)
		_, _ = pool.Exec(bg, `DELETE FROM lab_order_lines WHERE order_id IN (SELECT id FROM lab_orders WHERE lab_provider_id=$1)`, labID)
		_, _ = pool.Exec(bg, `DELETE FROM lab_orders WHERE lab_provider_id=$1`, labID)
		_, _ = pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, labID)
	})
	return patientID, ownerID, sciID, phleboID, foreignID, labID
}

func seedLabOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patientID, labID, state, method string) string {
	t.Helper()
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,150000,$6)`,
		orderID, patientID, labID, state, method, "authz-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return orderID
}

func labOrderState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID string) string {
	t.Helper()
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM lab_orders WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read order state: %v", err)
	}
	return state
}

// A foreign actor cannot schedule another patient's lab order — no state
// change, and no phlebotomist dispatch is booked. The lab owner and a platform
// admin still schedule normally.
func TestLiveDB_Schedule_ActorGate(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	patientID, ownerID, sciID, phleboID, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	prov := authzFakeProv{ownerID: ownerID, providerID: labID, scientistID: sciID, phleboID: phleboID}
	disp := &labAuthzDispatch{}
	svc := NewService(pool, nil, disp, prov, nil, nil, nil, nil)

	// Foreign actor on a CREATED WALK_IN order: denied, no transition.
	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "CREATED", "WALK_IN")
	if _, err := svc.Schedule(ctx, foreignID, orderID, false); err == nil {
		t.Fatal("foreign Schedule must be refused")
	} else if !strings.Contains(err.Error(), "only the lab may schedule") {
		t.Fatalf("foreign Schedule denial = %v, want the role refusal", err)
	}
	if got := labOrderState(t, ctx, pool, orderID); got != "CREATED" {
		t.Fatalf("state = %s after refused Schedule, want CREATED", got)
	}

	// The patient may not schedule their own order either — scheduling is a
	// provider-side action (it books real dispatch resources for HOME).
	if _, err := svc.Schedule(ctx, patientID, orderID, false); err == nil {
		t.Fatal("patient Schedule must be refused")
	}

	// State oracle: the same foreign actor on a RELEASED order must get the
	// SAME role refusal, not a state-distinguishing error.
	releasedID := seedLabOrder(t, ctx, pool, patientID, labID, "RELEASED", "WALK_IN")
	if _, err := svc.Schedule(ctx, foreignID, releasedID, false); err == nil {
		t.Fatal("foreign Schedule on RELEASED order must be refused")
	} else if !strings.Contains(err.Error(), "only the lab may schedule") {
		t.Fatalf("foreign Schedule on RELEASED order = %v, want the same role refusal (no state leak)", err)
	}

	// Owner schedules the WALK_IN order — no dispatch for walk-in.
	out, err := svc.Schedule(ctx, ownerID, orderID, false)
	if err != nil {
		t.Fatalf("owner Schedule must succeed: %v", err)
	}
	if out.State != StateScheduled {
		t.Fatalf("state = %s, want SCHEDULED", out.State)
	}
	if len(disp.calls) != 0 {
		t.Fatalf("WALK_IN Schedule must not dispatch, calls=%v", disp.calls)
	}

	// A HOME order dispatches the phlebotomist — only after the actor gate.
	homeID := seedLabOrder(t, ctx, pool, patientID, labID, "CREATED", "HOME")
	if _, err := svc.Schedule(ctx, foreignID, homeID, false); err == nil {
		t.Fatal("foreign Schedule on HOME order must be refused")
	}
	if len(disp.calls) != 0 {
		t.Fatalf("refused HOME Schedule must not dispatch, calls=%v", disp.calls)
	}
	if _, err := svc.Schedule(ctx, ownerID, homeID, false); err != nil {
		t.Fatalf("owner Schedule on HOME order must succeed: %v", err)
	}
	if len(disp.calls) != 1 {
		t.Fatalf("HOME Schedule must dispatch exactly once, calls=%v", disp.calls)
	}

	// A platform admin may schedule on the lab's behalf.
	adminID := seedLabOrder(t, ctx, pool, patientID, labID, "CREATED", "WALK_IN")
	if _, err := svc.Schedule(ctx, foreignID, adminID, true); err != nil {
		t.Fatalf("admin Schedule must succeed: %v", err)
	}
}

// WALK_IN collection is now gated to verified lab staff, and the actor gate
// runs before the order-state check so a foreign actor cannot learn the state.
func TestLiveDB_Collect_StaffGate(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	patientID, ownerID, sciID, phleboID, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	prov := authzFakeProv{ownerID: ownerID, providerID: labID, scientistID: sciID, phleboID: phleboID}
	svc := NewService(pool, nil, nil, prov, nil, nil, nil, nil)

	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "SCHEDULED", "WALK_IN")

	// Foreign actor and even the patient are refused — with the ROLE error,
	// never a state answer.
	for _, actor := range []string{foreignID, patientID} {
		if _, err := svc.Collect(ctx, actor, orderID, "attempt"); err == nil {
			t.Fatalf("Collect by %s must be refused", actor)
		} else if !strings.Contains(err.Error(), "only verified lab staff may collect") {
			t.Fatalf("Collect denial for %s = %v, want the role refusal", actor, err)
		}
	}
	if got := labOrderState(t, ctx, pool, orderID); got != "SCHEDULED" {
		t.Fatalf("state = %s after refused Collect, want SCHEDULED", got)
	}

	// State oracle: a foreign actor probing a RELEASED order gets the same
	// role refusal — the order's state must not leak through the error text.
	releasedID := seedLabOrder(t, ctx, pool, patientID, labID, "RELEASED", "WALK_IN")
	if _, err := svc.Collect(ctx, foreignID, releasedID, "probe"); err == nil {
		t.Fatal("foreign Collect on RELEASED order must be refused")
	} else if strings.Contains(err.Error(), "RELEASED") || strings.Contains(err.Error(), "SCHEDULED") {
		t.Fatalf("foreign Collect leaked order state in error: %v", err)
	}

	// Lab owner collects the WALK_IN order (intake), minting the sample and
	// opening the custody chain.
	sm, err := svc.Collect(ctx, ownerID, orderID, "walk-in intake")
	if err != nil {
		t.Fatalf("owner Collect must succeed: %v", err)
	}
	if sm.State != SampleCollected || sm.OrderID != orderID {
		t.Fatalf("sample = %+v, want COLLECTED for %s", sm, orderID)
	}
	if got := labOrderState(t, ctx, pool, orderID); got != "SAMPLE_COLLECTED" {
		t.Fatalf("state = %s, want SAMPLE_COLLECTED", got)
	}
	var custody int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM lab_custody_events WHERE sample_id=$1`, sm.ID).Scan(&custody); err != nil {
		t.Fatalf("count custody events: %v", err)
	}
	if custody != 1 {
		t.Fatalf("custody events = %d, want exactly the collection origin event", custody)
	}

	// A verified scientist may also collect a WALK_IN sample.
	order2 := seedLabOrder(t, ctx, pool, patientID, labID, "SCHEDULED", "WALK_IN")
	if _, err := svc.Collect(ctx, sciID, order2, "bench intake"); err != nil {
		t.Fatalf("scientist Collect on WALK_IN must succeed: %v", err)
	}

	// HOME stays phlebotomist/owner-only: the scientist credential alone does
	// not collect at the doorstep.
	homeID := seedLabOrder(t, ctx, pool, patientID, labID, "SCHEDULED", "HOME")
	if _, err := svc.Collect(ctx, sciID, homeID, "field"); err == nil {
		t.Fatal("scientist Collect on HOME order must be refused")
	}
	if _, err := svc.Collect(ctx, phleboID, homeID, "field"); err != nil {
		t.Fatalf("phlebotomist Collect on HOME order must succeed: %v", err)
	}
}

// The role gate now precedes the state check on the scientist write paths too:
// a foreign actor on a non-PROCESSING order gets the role refusal, not a state
// answer it could use to map the order's lifecycle.
func TestLiveDB_ResultWrites_RoleBeforeState(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	patientID, ownerID, sciID, phleboID, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	prov := authzFakeProv{ownerID: ownerID, providerID: labID, scientistID: sciID, phleboID: phleboID}
	svc := NewService(pool, nil, nil, prov, nil, nil, nil, nil)

	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "CREATED", "WALK_IN")

	_, err := svc.EnterResults(ctx, foreignID, orderID, "", []EnterResultInput{{TestID: uuid.New().String(), Value: "1", Status: ResultNormal}})
	if err == nil {
		t.Fatal("foreign EnterResults must be refused")
	}
	if strings.Contains(err.Error(), "PROCESSING") {
		t.Fatalf("foreign EnterResults leaked order state in error: %v", err)
	}

	_, err = svc.Release(ctx, foreignID, orderID)
	if err == nil {
		t.Fatal("foreign Release must be refused")
	}
	if strings.Contains(err.Error(), "not ready for release") {
		t.Fatalf("foreign Release leaked order state in error: %v", err)
	}
}

// Idempotency replay is owner-scoped: the same patient gets their original
// order back; a different patient replaying the key is refused BEFORE the
// money leg — no hold attempted, no order row written.
func TestLiveDB_CreateOrder_IdemReplayOwnerScoped(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	patientID, _, _, _, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	esc := &labAuthzEscrow{}
	svc := NewService(pool, esc, nil, nil, nil, nil, nil, nil)

	victimOrderID := seedLabOrder(t, ctx, pool, patientID, labID, "CREATED", "WALK_IN")
	var victimKey string
	if err := pool.QueryRow(ctx, `SELECT idempotency_key FROM lab_orders WHERE id=$1`, victimOrderID).Scan(&victimKey); err != nil {
		t.Fatalf("read victim idem key: %v", err)
	}

	in := CreateOrderInput{
		LabProviderID:    labID,
		CollectionMethod: CollectWalkIn,
		IdempotencyKey:   victimKey,
		TestIDs:          []string{uuid.New().String()},
	}

	got, err := svc.CreateOrder(ctx, patientID, in)
	if err != nil {
		t.Fatalf("owner replay must return the original order: %v", err)
	}
	if got.ID != victimOrderID {
		t.Fatalf("owner replay returned order %s, want original %s", got.ID, victimOrderID)
	}
	if len(esc.holds) != 0 {
		t.Fatalf("owner replay must not re-hold: %v", esc.holds)
	}

	if _, err := svc.CreateOrder(ctx, foreignID, in); !errors.Is(err, ErrIdemConflict) {
		t.Fatalf("foreign replay must fail ErrIdemConflict, got %v", err)
	}
	if len(esc.holds) != 0 {
		t.Fatalf("foreign replay must not reach the money leg: holds=%v", esc.holds)
	}
	var foreignOrders int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM lab_orders WHERE patient_id=$1`, foreignID).Scan(&foreignOrders); err != nil {
		t.Fatalf("count foreign orders: %v", err)
	}
	if foreignOrders != 0 {
		t.Fatalf("foreign replay wrote %d order rows, want 0", foreignOrders)
	}
}
