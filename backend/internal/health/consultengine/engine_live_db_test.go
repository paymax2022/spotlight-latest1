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

func TestJoinMintsAPeerTokenCappedByTheRemainingWindow(t *testing.T) {
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

	patientJoin, err := f.svc.Join(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("patient join: %v", err)
	}
	if patientJoin.Token != "tok-"+f.patientID || patientJoin.RTC.Provider != "livekit" || patientJoin.RTC.URL != "wss://rtc.test" {
		t.Fatalf("bad join payload: %+v", patientJoin)
	}
	if patientJoin.Session.State != StateLive {
		t.Fatalf("first join must move the session live, got %q", patientJoin.Session.State)
	}
	if got := f.media.tokens[len(f.media.tokens)-1]; got != MediaPeer {
		t.Fatalf("patient role = %q, want %q", got, MediaPeer)
	}
	if f.media.ttl != 10*time.Minute {
		t.Fatalf("ttl = %v, want the 10m client default", f.media.ttl)
	}

	if _, err := f.svc.Join(context.Background(), sess.ID, f.providerID); err != nil {
		t.Fatalf("provider join: %v", err)
	}
	if got := f.media.tokens[len(f.media.tokens)-1]; got != MediaPeerAdmin {
		t.Fatalf("provider role = %q, want %q", got, MediaPeerAdmin)
	}

	// Late in the session the token shrinks to the remaining time + 1m.
	f.clock = sess.EndsAt.Add(-90 * time.Second)
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); err != nil {
		t.Fatalf("late join: %v", err)
	}
	if f.media.ttl != 150*time.Second {
		t.Fatalf("late ttl = %v, want 150s", f.media.ttl)
	}
}

func TestSweepWarnsThenEndsAndIsIdempotent(t *testing.T) {
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
	_, _ = f.svc.Join(context.Background(), sess.ID, f.patientID)

	f.clock = sess.WarnAt.Add(time.Second)
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep at warning: %v", err)
	}
	warned, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if warned.WarningSentAt == nil {
		t.Fatal("the warning was not recorded")
	}

	f.clock = sess.EndsAt.Add(time.Second)
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep at end: %v", err)
	}
	ended, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if ended.State != StateEnded || ended.EndedAt == nil {
		t.Fatalf("state = %q ended_at = %v, want ended", ended.State, ended.EndedAt)
	}
	if len(f.media.closed) != 1 || f.media.closed[0] != sess.RoomName {
		t.Fatalf("room close calls = %v, want [%s]", f.media.closed, sess.RoomName)
	}
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if len(f.media.closed) != 1 {
		t.Fatalf("sweep closed the room twice: %v", f.media.closed)
	}
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); !errors.Is(err, ErrState) {
		t.Fatalf("join after end: err = %v, want ErrState", err)
	}
}

func TestCompleteIsIdempotentAndParticipantOnly(t *testing.T) {
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
	if err := f.svc.Complete(context.Background(), sess.ID, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger complete: err = %v, want ErrNotFound", err)
	}
	for i := 0; i < 2; i++ {
		if err := f.svc.Complete(context.Background(), sess.ID, f.providerID); err != nil {
			t.Fatalf("complete #%d: %v", i+1, err)
		}
	}
	if len(f.media.closed) != 1 {
		t.Fatalf("close calls = %v, want exactly one", f.media.closed)
	}
}

func TestCompleteDoesNotRewriteATerminalState(t *testing.T) {
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
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE consult_sessions SET state='cancelled' WHERE id=$1`, sess.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if err := f.svc.Complete(context.Background(), sess.ID, f.providerID); err != nil {
		t.Fatalf("complete cancelled: %v", err)
	}
	got, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.State != StateCancelled {
		t.Fatalf("state = %q, want cancelled (Complete must not rewrite a terminal state)", got.State)
	}
	if len(f.media.closed) != 0 {
		t.Fatalf("Complete closed the room of a cancelled session: %v", f.media.closed)
	}
}
