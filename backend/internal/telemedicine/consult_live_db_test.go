package telemedicine_test

// LIVE-DB coverage for the Slice 2 telemedicine path. Skips unless
// TEST_DATABASE_URL is set:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/telemedicine -run TestLiveDB_Consult -v

import (
	"context"
	"errors"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/telemedicine"
)

type fakeConsultEngine struct {
	requests    []consultengine.BookRequest
	completed   []string
	completeErr error
}

func (f *fakeConsultEngine) EnsureSession(_ context.Context, req consultengine.BookRequest) (consultengine.Session, error) {
	f.requests = append(f.requests, req)
	return consultengine.Session{ID: "sess-1"}, nil
}

func (f *fakeConsultEngine) CompleteBySource(_ context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error {
	f.completed = append(f.completed, string(vertical)+"|"+sourceRef+"|"+callerID)
	return f.completeErr
}

func seedPackage(t *testing.T, ctx context.Context, pool *pgxpool.Pool, doctorUserID, mode string, minutes int, priceKobo int64) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO consult_session_packages
		(id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
		VALUES ($1::uuid,'doctor',$2::uuid,'telemedicine',$3,$4,$5,TRUE)`,
		id, doctorUserID, mode, minutes, priceKobo); err != nil {
		t.Fatalf("seed package: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM consult_session_packages WHERE id=$1::uuid`, id)
	})
	return id
}

func testTelemedService(t *testing.T, pool *pgxpool.Pool) *telemedicine.Service {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return telemedicine.NewService(pool, settlement.NewService(pool, led)).
		WithTiers(tiers.NewService(pool)).
		WithPlatformFeeBp(telemedicine.PlatformFeeBp)
}

func TestLiveDB_ConsultPackageIsPricedAndPinnedAtBooking(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	pkgID := seedPackage(t, ctx, pool, doctorUserID, "video", 30, 700_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:          doctorID,
		ScheduledAt:       time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType:  "video",
		PackageID:         pkgID,
		ExpectedTotalKobo: 735_000,
		IdempotencyKey:    "pkg-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if appt.FeeKobo != 700_000 || appt.PlatformFeeKobo != 35_000 || appt.TotalKobo != 735_000 {
		t.Fatalf("prices = %+v, want 700000/35000/735000", appt)
	}

	var pinnedPkg, mode string
	var minutes int
	if err := pool.QueryRow(ctx, `SELECT consult_package_id::text, consult_mode, consult_duration_minutes
		FROM appointments WHERE id=$1::uuid`, appt.ID).Scan(&pinnedPkg, &mode, &minutes); err != nil {
		t.Fatalf("read pin: %v", err)
	}
	if pinnedPkg != pkgID || mode != "video" || minutes != 30 {
		t.Fatalf("pin = %s/%s/%d, want %s/video/30", pinnedPkg, mode, minutes, pkgID)
	}

	doc, err := svc.GetDoctor(ctx, doctorID)
	if err != nil {
		t.Fatalf("get doctor: %v", err)
	}
	if len(doc.Packages) != 1 || doc.Packages[0].ID != pkgID {
		t.Fatalf("packages = %+v", doc.Packages)
	}
	if doc.Packages[0].Booking.TotalKobo != 735_000 {
		t.Fatalf("package quote = %+v", doc.Packages[0].Booking)
	}
}

func TestLiveDB_ConsultRequiresAPackageOnceTheDoctorSellsOne(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	seedPackage(t, ctx, pool, doctorUserID, "video", 30, 700_000)

	_, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "video",
		IdempotencyKey:   "nopkg-" + uuid.NewString(),
	})
	if !errors.Is(err, telemedicine.ErrPackageRequired) {
		t.Fatalf("video without a package: err = %v, want ErrPackageRequired", err)
	}

	// A chat booking is untouched: the doctor sells no chat package.
	if _, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(74 * time.Hour).Truncate(time.Second),
		ConsultationType: "chat",
		IdempotencyKey:   "chat-" + uuid.NewString(),
	}); err != nil {
		t.Fatalf("chat legacy booking: %v", err)
	}

	_, err = svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(76 * time.Hour).Truncate(time.Second),
		ConsultationType: "video",
		PackageID:        uuid.NewString(),
		IdempotencyKey:   "foreign-" + uuid.NewString(),
	})
	if !errors.Is(err, telemedicine.ErrPackageInvalid) {
		t.Fatalf("unknown package: err = %v, want ErrPackageInvalid", err)
	}
}

func TestLiveDB_OpenConsultSessionPinsThePaidSnapshot(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := testTelemedService(t, pool)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	pkgID := seedPackage(t, ctx, pool, doctorUserID, "video", 30, 700_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:          doctorID,
		ScheduledAt:       time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType:  "video",
		PackageID:         pkgID,
		ExpectedTotalKobo: 735_000,
		IdempotencyKey:    "open-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	engine := &fakeConsultEngine{}
	svc = svc.WithConsultEngine(engine)
	if _, err := svc.OpenConsultSession(ctx, appt.ID, patientID); err != nil {
		t.Fatalf("open as patient: %v", err)
	}
	if _, err := svc.OpenConsultSession(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("open as doctor: %v", err)
	}
	if len(engine.requests) != 2 {
		t.Fatalf("engine calls = %d", len(engine.requests))
	}
	req := engine.requests[0]
	if req.Vertical != consultengine.VerticalTelemedicine || req.Mode != consultengine.ModeVideo {
		t.Fatalf("vertical/mode = %q/%q", req.Vertical, req.Mode)
	}
	if req.SourceRef != "appointment:"+appt.ID {
		t.Fatalf("source ref = %q", req.SourceRef)
	}
	if req.ProviderOwnerKind != consultengine.OwnerDoctor ||
		req.ProviderOwnerID != doctorUserID || req.ProviderUserID != doctorUserID {
		t.Fatalf("provider = %q/%q/%q", req.ProviderOwnerKind, req.ProviderOwnerID, req.ProviderUserID)
	}
	if req.PackageID != pkgID || req.BaseHoldID != appt.SettlementID {
		t.Fatalf("package/hold = %q/%q", req.PackageID, req.BaseHoldID)
	}
	if req.Snapshot == nil || req.Snapshot.DurationMinutes != 30 || req.Snapshot.PriceKobo != 700_000 {
		t.Fatalf("snapshot = %+v", req.Snapshot)
	}
	if !req.Start.Equal(appt.ScheduledAt) {
		t.Fatalf("start = %v, want %v", req.Start, appt.ScheduledAt)
	}

	if _, err := svc.OpenConsultSession(ctx, appt.ID, uuid.NewString()); !errors.Is(err, telemedicine.ErrAppointmentNotFound) {
		t.Fatalf("stranger: err = %v, want ErrAppointmentNotFound", err)
	}
}

func TestLiveDB_OpenConsultSessionFallsBackToTheLegacySnapshot(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := testTelemedService(t, pool)
	doctorID, _, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "audio",
		IdempotencyKey:   "legacy-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	engine := &fakeConsultEngine{}
	if _, err := svc.WithConsultEngine(engine).OpenConsultSession(ctx, appt.ID, patientID); err != nil {
		t.Fatalf("open: %v", err)
	}
	req := engine.requests[0]
	if req.Mode != consultengine.ModeVoice || req.PackageID != "" {
		t.Fatalf("mode/package = %q/%q", req.Mode, req.PackageID)
	}
	if req.Snapshot == nil || req.Snapshot.DurationMinutes != 20 || req.Snapshot.PriceKobo != 500_000 {
		t.Fatalf("snapshot = %+v", req.Snapshot)
	}
}

func TestLiveDB_CompleteAppointmentEndsTheConsultBestEffort(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := testTelemedService(t, pool)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "chat",
		IdempotencyKey:   "complete-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	engine := &fakeConsultEngine{completeErr: errors.New("sfu unreachable")}
	if err := svc.WithConsultEngine(engine).CompleteAppointment(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("completion must not fail on an engine error: %v", err)
	}
	want := "telemedicine|appointment:" + appt.ID + "|" + doctorUserID
	if len(engine.completed) != 1 || engine.completed[0] != want {
		t.Fatalf("completed = %v, want [%s]", engine.completed, want)
	}
}
