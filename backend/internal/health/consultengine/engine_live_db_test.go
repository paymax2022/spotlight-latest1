package consultengine

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- fakes ----

type fakeMedia struct {
	ensured   []string
	closed    []string
	tokens    []MediaRole
	ttl       time.Duration
	ensureErr error
}

func (f *fakeMedia) EnsureRoom(_ context.Context, room string) error {
	f.ensured = append(f.ensured, room)
	return f.ensureErr
}
func (f *fakeMedia) CloseRoom(_ context.Context, room string) error {
	f.closed = append(f.closed, room)
	return nil
}
func (f *fakeMedia) JoinToken(_ context.Context, room, identity string, role MediaRole, ttl time.Duration) (string, error) {
	f.tokens = append(f.tokens, role)
	f.ttl = ttl
	return "tok-" + identity, nil
}
func (f *fakeMedia) URL() string             { return "wss://rtc.test" }
func (f *fakeMedia) TokenTTL() time.Duration { return 10 * time.Minute }

type fakeEscrow struct {
	holds    []string
	released []string
	err      error
}

func (f *fakeEscrow) HoldWithPayee(_ context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	f.holds = append(f.holds, idemKey)
	return "escrow-" + idemKey, nil
}
func (f *fakeEscrow) Release(_ context.Context, escrowID, payeeID string) error {
	f.released = append(f.released, escrowID)
	return nil
}

// ---- live DB ----

func enginePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping consult engine live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type engineFixture struct {
	pool        *pgxpool.Pool
	svc         *Service
	media       *fakeMedia
	escrow      *fakeEscrow
	clock       time.Time
	patientID   string
	providerID  string
	providerRow string
}

func newEngineFixture(t *testing.T) *engineFixture {
	t.Helper()
	ctx := context.Background()
	pool := enginePool(t)
	patientID, providerID, providerRow := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{patientID, providerID} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		VALUES ($1,$2,'VET','vet','Seed Vet','APPROVED')`, providerRow, providerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.consult_sessions WHERE patient_id=$1`, patientID)
		_, _ = pool.Exec(bg, `DELETE FROM public.consult_session_packages WHERE owner_id=$1`, providerRow)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerRow)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, providerID)
	})
	f := &engineFixture{
		pool: pool, media: &fakeMedia{}, escrow: &fakeEscrow{},
		clock:     time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC),
		patientID: patientID, providerID: providerID, providerRow: providerRow,
	}
	f.svc = NewService(pool, f.media, f.escrow, nil).WithClock(func() time.Time { return f.clock })
	return f
}

func (f *engineFixture) publishVetVideo(t *testing.T, minutes int, priceKobo int64) Package {
	t.Helper()
	pkg, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow,
		Vertical: VerticalVet, Mode: ModeVideo,
		DurationMinutes: minutes, PriceKobo: priceKobo, Active: true,
	})
	if err != nil {
		t.Fatalf("publish package: %v", err)
	}
	return pkg
}

func TestBookSnapshotsPriceAndCreatesARoom(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)

	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo,
		PatientID:         f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID,
		SourceRef:      "vet_appointment:abc",
		PackageID:      pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if sess.PriceKobo != 500_000 || sess.DurationMinutes != 30 {
		t.Fatalf("snapshot = %d kobo / %d min, want 500000 / 30", sess.PriceKobo, sess.DurationMinutes)
	}
	if want := f.clock.Add(30 * time.Minute); !sess.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", sess.EndsAt, want)
	}
	if want := f.clock.Add(25 * time.Minute); !sess.WarnAt.Equal(want) {
		t.Fatalf("warn_at = %v, want %v", sess.WarnAt, want)
	}
	if len(f.media.ensured) != 1 || f.media.ensured[0] != sess.RoomName {
		t.Fatalf("room was not provisioned: %v", f.media.ensured)
	}
	if sess.RoomName[:len("consult-vet-")] != "consult-vet-" {
		t.Fatalf("room %q is not in the consult-vet namespace", sess.RoomName)
	}

	// The price snapshot survives a later package edit.
	_, err = f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow,
		Vertical: VerticalVet, Mode: ModeVideo,
		DurationMinutes: 30, PriceKobo: 900_000, Active: true,
	})
	if err != nil {
		t.Fatalf("republish: %v", err)
	}
	again, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if again.PriceKobo != 500_000 {
		t.Fatalf("a package edit rewrote a booked price: %d", again.PriceKobo)
	}
}

func TestBookRefusesAForeignPackageAndAnUnrelatedProvider(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	other := uuid.NewString()

	_, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo,
		PatientID:         f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: other, SourceRef: "vet_appointment:x", PackageID: pkg.ID,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("book with an unrelated provider: err = %v, want ErrInvalid", err)
	}

	_, err = f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalPharmacy, Mode: ModeVideo,
		PatientID:         f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:x", PackageID: pkg.ID,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("book across verticals: err = %v, want ErrInvalid", err)
	}
}

func TestGetFoldsNonParticipantsToNotFound(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	for _, caller := range []string{uuid.NewString(), ""} {
		if _, err := f.svc.Get(context.Background(), sess.ID, caller); !errors.Is(err, ErrNotFound) {
			t.Fatalf("caller %q: err = %v, want ErrNotFound", caller, err)
		}
	}
	if _, err := f.svc.Get(context.Background(), uuid.NewString(), f.patientID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing session must fold to ErrNotFound, got %v", err)
	}
}
