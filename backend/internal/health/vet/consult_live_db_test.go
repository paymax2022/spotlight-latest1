package healthvet

// LIVE-DB coverage for the vet Slice 2 path: package-priced tele booking pins
// mode/duration/price, the quote guard refuses a stale total before money
// moves, and OpenConsultSession resolves the one session per appointment with
// participant scoping. Skips unless TEST_DATABASE_URL is set:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/health/vet -run TestLiveDB_VetConsult -v

import (
	"context"
	"errors"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/health/consultengine"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/testsupport"
)

func seedVetConsultPackage(t *testing.T, ctx context.Context, pool *pgxpool.Pool, providerID, mode string, minutes int, price int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO consult_session_packages
		    (id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
		VALUES ($1,'health_provider',$2,'vet',$3,$4,$5,true)`,
		id, providerID, mode, minutes, price); err != nil {
		t.Fatalf("seed vet package: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM consult_session_packages WHERE id=$1`, id)
	})
	return id
}

func fundVetConsultWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amount int64) {
	t.Helper()
	acc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "vet-consult-seed", "vet-consult-fund-"+uuid.New().String(), acc.ID, amount); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// fakeRoomEngine records what the vet module asked the engine to open.
type fakeRoomEngine struct {
	reqs      []consultengine.BookRequest
	completed []string
}

func (f *fakeRoomEngine) EnsureSession(_ context.Context, req consultengine.BookRequest) (consultengine.Session, error) {
	f.reqs = append(f.reqs, req)
	return consultengine.Session{
		ID: "sess-" + req.SourceRef, Vertical: req.Vertical, Mode: req.Mode,
		SourceRef: req.SourceRef, State: consultengine.StateScheduled,
	}, nil
}

func (f *fakeRoomEngine) CompleteBySource(_ context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error {
	f.completed = append(f.completed, string(vertical)+"/"+sourceRef+"/"+callerID)
	return nil
}

func TestLiveDB_VetConsult_BookPackagePinsModeDurationPrice(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID := uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	testsupport.SetKycTier(t, ctx, pool, ownerID, testsupport.KycTierUnlimited)
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)
	// No vet_services row: this vet sells the tele consult as a timed package.
	packageID := seedVetConsultPackage(t, ctx, pool, providerID, "video", 30, 250_000)

	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, healthscheduling.NewService(pool, scheduler.NewService(pool), nil),
		nil, nil, nil, nil, nil)
	fundVetConsultWallet(t, ctx, led, ownerID, 5_000_000)

	start := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	appt, err := svc.Book(ctx, ownerID, BookInput{
		ProviderID: providerID, PetID: petID, PackageID: packageID,
		VisitType: VisitTele, ConsultMode: "video",
		SlotStart: start, SlotEnd: start.Add(30 * time.Minute),
		ExpectedTotalKobo: 250_000,
		IdempotencyKey:    "vet-consult-pkg-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book pinned package: %v", err)
	}
	if appt.TotalKobo != 250_000 {
		t.Fatalf("total = %d, want the package price 250000", appt.TotalKobo)
	}
	if appt.ServiceID != nil {
		t.Fatalf("service id = %v, want nil for a package booking", *appt.ServiceID)
	}
	if appt.ConsultPackageID == nil || *appt.ConsultPackageID != packageID {
		t.Fatalf("package pin = %v, want %s", appt.ConsultPackageID, packageID)
	}
	if appt.ConsultMode == nil || *appt.ConsultMode != "video" {
		t.Fatalf("mode pin = %v, want video", appt.ConsultMode)
	}
	if appt.ConsultDurationMinutes == nil || *appt.ConsultDurationMinutes != 30 {
		t.Fatalf("duration pin = %v, want 30", appt.ConsultDurationMinutes)
	}
}

func TestLiveDB_VetConsult_StaleQuoteRefusedBeforeMoneyMoves(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID := uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	testsupport.SetKycTier(t, ctx, pool, ownerID, testsupport.KycTierUnlimited)
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)
	packageID := seedVetConsultPackage(t, ctx, pool, providerID, "voice", 20, 180_000)

	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, healthscheduling.NewService(pool, scheduler.NewService(pool), nil),
		nil, nil, nil, nil, nil)
	fundVetConsultWallet(t, ctx, led, ownerID, 5_000_000)

	start := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	_, err := svc.Book(ctx, ownerID, BookInput{
		ProviderID: providerID, PetID: petID, PackageID: packageID,
		VisitType: VisitTele, SlotStart: start, SlotEnd: start.Add(30 * time.Minute),
		ExpectedTotalKobo: 150_000,
		IdempotencyKey:    "vet-consult-stale-" + uuid.New().String(),
	})
	if !errors.Is(err, ErrQuoteMismatch) {
		t.Fatalf("stale quote must fail on ErrQuoteMismatch, got %v", err)
	}
	var appts int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_appointments WHERE patient_id=$1`, ownerID).Scan(&appts); err != nil {
		t.Fatalf("count appointments: %v", err)
	}
	if appts != 0 {
		t.Fatalf("a refused quote must not mint an appointment, found %d", appts)
	}
}

func TestLiveDB_VetConsult_OpenSessionScopesParticipants(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID, strangerID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID, strangerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)

	apptID := uuid.New().String()
	slot := time.Now().Add(time.Hour).Truncate(time.Minute)
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_appointments
		    (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET','TELE','IN_PROGRESS',$4,$5)`,
		apptID, providerID, ownerID, slot, slot.Add(30*time.Minute)); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		bg := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id=$1`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM health_appointments WHERE id=$1`, apptID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments
		    (appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state,
		     idempotency_key, consult_mode, consult_duration_minutes)
		VALUES ($1,$2,$3,$4,'TELE',250000,'HELD',$5,'video',30)`,
		apptID, ownerID, providerID, petID, "vet-open-"+apptID); err != nil {
		t.Fatalf("seed payment: %v", err)
	}

	engine := &fakeRoomEngine{}
	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, nil, nil, nil, nil, nil, nil).WithConsultRoomEngine(engine)

	if _, err := svc.OpenConsultSession(ctx, strangerID, apptID); !errors.Is(err, ErrAppointmentNotFound) {
		t.Fatalf("stranger must get ErrAppointmentNotFound, got %v", err)
	}
	if len(engine.reqs) != 0 {
		t.Fatal("a stranger must never reach the media engine")
	}

	sess, err := svc.OpenConsultSession(ctx, ownerID, apptID)
	if err != nil {
		t.Fatalf("owner open: %v", err)
	}
	if sess.SourceRef != "vet:"+apptID {
		t.Fatalf("source ref = %q, want vet:%s", sess.SourceRef, apptID)
	}
	req := engine.reqs[len(engine.reqs)-1]
	if req.Vertical != consultengine.VerticalVet || req.Mode != consultengine.ModeVideo {
		t.Fatalf("vertical/mode = %q/%q", req.Vertical, req.Mode)
	}
	if req.ProviderOwnerKind != consultengine.OwnerHealthProvider ||
		req.ProviderOwnerID != providerID || req.ProviderUserID != vetOwnerID {
		t.Fatalf("provider = %q/%q/%q", req.ProviderOwnerKind, req.ProviderOwnerID, req.ProviderUserID)
	}
	if req.Snapshot == nil || req.Snapshot.DurationMinutes != 30 || req.Snapshot.PriceKobo != 250_000 {
		t.Fatalf("snapshot = %+v, want 30m/250000", req.Snapshot)
	}

	if _, err := svc.OpenConsultSession(ctx, vetOwnerID, apptID); err != nil {
		t.Fatalf("vet open of an IN_PROGRESS consult: %v", err)
	}
}

func TestLiveDB_VetConsult_NonTeleAppointmentIsNotOpenable(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID := uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)

	apptID := uuid.New().String()
	slot := time.Now().Add(24 * time.Hour).Truncate(time.Minute)
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_appointments
		    (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET','HOME','CONFIRMED',$4,$5)`,
		apptID, providerID, ownerID, slot, slot.Add(30*time.Minute)); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		bg := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id=$1`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM health_appointments WHERE id=$1`, apptID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments
		    (appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state, idempotency_key)
		VALUES ($1,$2,$3,$4,'HOME',1200000,'HELD',$5)`,
		apptID, ownerID, providerID, petID, "vet-home-"+apptID); err != nil {
		t.Fatalf("seed payment: %v", err)
	}

	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, nil, nil, nil, nil, nil, nil).WithConsultRoomEngine(&fakeRoomEngine{})

	if _, err := svc.OpenConsultSession(ctx, ownerID, apptID); !errors.Is(err, ErrConsultNotOpenable) {
		t.Fatalf("a home visit must not open a room, got %v", err)
	}
}
