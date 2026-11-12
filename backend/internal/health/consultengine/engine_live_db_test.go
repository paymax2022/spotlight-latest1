package consultengine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
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

// fakeEscrow models the escrow service's replay and state-machine semantics:
// a repeated idempotency key returns the same hold without moving money again,
// and a hold may only be refunded or released from HELD. Seeded ids with no
// recorded state (a crash before the fake knew about them) are allowed.
type fakeEscrow struct {
	mu        sync.Mutex
	byKey     map[string]string // idempotency key -> escrow id
	state     map[string]string // escrow id -> HELD/REFUNDED/RELEASED
	holds     []string
	released  []string
	refunded  []string
	err       error
	refundErr error
	afterHold func()
}

func (f *fakeEscrow) HoldWithPayee(_ context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return "", f.err
	}
	if f.byKey == nil {
		f.byKey = map[string]string{}
	}
	if f.state == nil {
		f.state = map[string]string{}
	}
	if id, ok := f.byKey[idemKey]; ok {
		// Replay: same hold, no second debit, no side effects.
		return id, nil
	}
	id := "escrow-" + idemKey
	f.byKey[idemKey] = id
	f.state[id] = "HELD"
	f.holds = append(f.holds, idemKey)
	if f.afterHold != nil {
		f.afterHold()
	}
	return id, nil
}
func (f *fakeEscrow) Release(_ context.Context, escrowID, payeeID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if st, ok := f.state[escrowID]; ok && st != "HELD" {
		return fmt.Errorf("escrow: cannot release %s from %s", escrowID, st)
	}
	if f.state == nil {
		f.state = map[string]string{}
	}
	f.state[escrowID] = "RELEASED"
	f.released = append(f.released, escrowID)
	return nil
}
func (f *fakeEscrow) Refund(_ context.Context, escrowID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refundErr != nil {
		return f.refundErr
	}
	if st, ok := f.state[escrowID]; ok && st != "HELD" {
		return fmt.Errorf("escrow: cannot refund %s from %s", escrowID, st)
	}
	if f.state == nil {
		f.state = map[string]string{}
	}
	f.state[escrowID] = "REFUNDED"
	f.refunded = append(f.refunded, escrowID)
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

func (f *engineFixture) publishVetChat(t *testing.T, minutes int, priceKobo int64) Package {
	t.Helper()
	pkg, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow,
		Vertical: VerticalVet, Mode: ModeChat,
		DurationMinutes: minutes, PriceKobo: priceKobo, Active: true,
	})
	if err != nil {
		t.Fatalf("publish chat package: %v", err)
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

func TestPatientExtensionNeedsApprovalThenPaymentBeforeItApplies(t *testing.T) {
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

	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if ext.Status != ExtPending || ext.PriceKobo != 166_667 {
		t.Fatalf("request = %+v, want pending at 166667 kobo", ext)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatal("a request must not move money")
	}
	unchanged, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if !unchanged.EndsAt.Equal(sess.EndsAt) {
		t.Fatal("a pending request changed ends_at")
	}

	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.patientID, true, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("patient approving their own request: err = %v, want ErrNotFound", err)
	}
	approved, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, "")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.Status != ExtAwaitingPayment || approved.PaymentExpiresAt == nil {
		t.Fatalf("approval = %+v, want awaiting payment with a deadline", approved)
	}
	still, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if !still.EndsAt.Equal(sess.EndsAt) {
		t.Fatal("approval alone changed ends_at")
	}

	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.providerID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("provider paying: err = %v, want ErrNotFound", err)
	}
	paid, extended, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if paid.Status != ExtPaid || paid.EscrowID == nil {
		t.Fatalf("paid = %+v, want paid with escrow", paid)
	}
	if welcome := "consult-ext:" + ext.ID; f.escrow.holds[0] != welcome {
		t.Fatalf("idempotency key = %q, want %q", f.escrow.holds[0], welcome)
	}
	if want := sess.EndsAt.Add(10 * time.Minute); !extended.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", extended.EndsAt, want)
	}
	if !extended.WarnAt.Before(extended.EndsAt) {
		t.Fatal("warn_at was not recomputed")
	}
	if extended.WarningSentAt != nil {
		t.Fatal("the warning flag must reset so the new end is announced")
	}

	// Paying twice is idempotent: the escrow key is the extension id.
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrExtensionNotPayable) {
		t.Fatalf("second pay: err = %v, want ErrExtensionNotPayable", err)
	}
	if len(f.escrow.holds) != 1 {
		t.Fatalf("holds = %v, want one", f.escrow.holds)
	}
}

func TestExtensionApprovalExpiresAfterFiveMinutes(t *testing.T) {
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
	ext, _ := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 5)
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	f.clock = f.clock.Add(ExtensionPaymentWindow + time.Second)
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrPaymentExpired) && !errors.Is(err, ErrExtensionNotPayable) {
		t.Fatalf("late pay: err = %v, want ErrPaymentExpired", err)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatalf("late payment moved money: %v", f.escrow.holds)
	}
}

func TestProviderExtensionAppliesImmediatelyAndFree(t *testing.T) {
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
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.providerID, 15)
	if err != nil {
		t.Fatalf("provider extend: %v", err)
	}
	if ext.Status != ExtPaid || ext.PriceKobo != 0 || ext.EscrowID != nil {
		t.Fatalf("provider extension = %+v, want paid/free/no escrow", ext)
	}
	after, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if want := sess.EndsAt.Add(15 * time.Minute); !after.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", after.EndsAt, want)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatal("a provider extension charged the patient")
	}
}

func TestExtensionCannotPushPastFourHoursAndEndReleasesEscrow(t *testing.T) {
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
	if _, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 240); !errors.Is(err, ErrInvalid) {
		t.Fatalf("4h extension: err = %v, want ErrInvalid", err)
	}
	if _, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("zero extension: err = %v, want ErrInvalid", err)
	}

	ext, _ := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	_, _ = f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, "")
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); err != nil {
		t.Fatalf("pay: %v", err)
	}
	extended, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	f.clock = extended.EndsAt.Add(time.Second)
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(f.escrow.released) != 1 || f.escrow.released[0] != "escrow-consult-ext:"+ext.ID {
		t.Fatalf("released = %v, want the one extension escrow", f.escrow.released)
	}
}

func TestSessionChatIsParticipantScopedAndClosesAtZero(t *testing.T) {
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
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "  hello doc  "); err != nil {
		t.Fatalf("post: %v", err)
	}
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.providerID, "hello patient"); err != nil {
		t.Fatalf("provider post: %v", err)
	}
	msgs, err := f.svc.ListMessages(context.Background(), sess.ID, f.providerID, time.Time{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(msgs) != 2 || msgs[0].Body != "hello doc" {
		t.Fatalf("messages = %+v, want two in order with trimmed body", msgs)
	}
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, uuid.NewString(), "hi"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger post: err = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.ListMessages(context.Background(), sess.ID, uuid.NewString(), time.Time{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger list: err = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.ListMessages(context.Background(), uuid.NewString(), f.patientID, time.Time{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing session list: err = %v, want ErrNotFound", err)
	}

	f.clock = sess.EndsAt.Add(-time.Second)
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "still here"); err != nil {
		t.Fatalf("post before end: %v", err)
	}
	f.clock = sess.EndsAt
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "too late"); !errors.Is(err, ErrState) {
		t.Fatalf("post at end: err = %v, want ErrState", err)
	}
	// Reading stays open after the end.
	if _, err := f.svc.ListMessages(context.Background(), sess.ID, f.patientID, time.Time{}); err != nil {
		t.Fatalf("read after end: %v", err)
	}
}

// TestPostMessageRefusesBeforeTheChatWindowOpens pins that a chat thread opens
// on the same window media does: a scheduled session whose start is beyond the
// early-join window rejects posting, while reading stays available.
func TestPostMessageRefusesBeforeTheChatWindowOpens(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetChat(t, 30, 500_000)
	// Book a chat session well past the early-join window so "now" is before it opens.
	start := f.clock.Add(2 * time.Hour)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeChat, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:chat", PackageID: pkg.ID,
		Start: start,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if sess.State != StateScheduled {
		t.Fatalf("state = %q, want scheduled", sess.State)
	}

	// Before the window opens posting is refused...
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "too early"); !errors.Is(err, ErrState) {
		t.Fatalf("post before window: err = %v, want ErrState", err)
	}
	// ...but reading the thread still works.
	if _, err := f.svc.ListMessages(context.Background(), sess.ID, f.patientID, time.Time{}); err != nil {
		t.Fatalf("list before window: %v", err)
	}

	// Once the window opens, posting succeeds.
	f.clock = sess.BookedStart.Add(-EarlyJoinWindow)
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "window open"); err != nil {
		t.Fatalf("post once the window opens: %v", err)
	}
}

func TestASecondOpenExtensionRequestIsRefused(t *testing.T) {
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
	if _, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 5); err != nil {
		t.Fatalf("first request: %v", err)
	}
	if _, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 5); !errors.Is(err, ErrState) {
		t.Fatalf("second request: err = %v, want ErrState", err)
	}
}

func (f *engineFixture) bookVetVideo(t *testing.T, pkg Package) Session {
	t.Helper()
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	return sess
}

// TestPayExtensionRefundsWhenTheSessionEndsMidPayment pins the money-safe
// order: the hold is placed first, so a session that ends before the minutes
// commit must give the money back and leave no escrow on the request.
func TestPayExtensionRefundsWhenTheSessionEndsMidPayment(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	wantEscrow := "escrow-consult-ext:" + ext.ID
	f.escrow.afterHold = func() {
		if _, err := f.pool.Exec(context.Background(),
			`UPDATE consult_sessions SET state='ended', ended_at=$2 WHERE id=$1`, sess.ID, f.clock); err != nil {
			t.Fatalf("end session mid-payment: %v", err)
		}
	}

	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrState) {
		t.Fatalf("pay after the session ended: err = %v, want ErrState", err)
	}
	if len(f.escrow.refunded) != 1 || f.escrow.refunded[0] != wantEscrow {
		t.Fatalf("refunded = %v, want [%s]", f.escrow.refunded, wantEscrow)
	}
	var status string
	var escrowID *string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT status, escrow_id FROM consult_extension_requests WHERE id=$1`, ext.ID).Scan(&status, &escrowID); err != nil {
		t.Fatalf("reload extension: %v", err)
	}
	if status != string(ExtExpired) || escrowID != nil {
		t.Fatalf("extension = %s / escrow %v, want expired with no hold", status, escrowID)
	}
	after, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !after.EndsAt.Equal(sess.EndsAt) {
		t.Fatalf("ends_at = %v, want the unchanged %v", after.EndsAt, sess.EndsAt)
	}

	// The retired request can never be paid again, and a retry must not refund
	// the same hold twice (escrow forbids REFUNDED → REFUNDED).
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrExtensionNotPayable) {
		t.Fatalf("retry after the refund: err = %v, want ErrExtensionNotPayable", err)
	}
	if len(f.escrow.refunded) != 1 {
		t.Fatalf("refunded = %v, want the one refund", f.escrow.refunded)
	}
}

// TestPayReusesARecordedHoldAfterACrash pins that a hold recorded on the row is
// this request's hold: payment adopts it instead of refunding and re-holding.
func TestPayReusesARecordedHoldAfterACrash(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE consult_extension_requests SET escrow_id='esc-crash' WHERE id=$1`, ext.ID); err != nil {
		t.Fatalf("seed recorded hold: %v", err)
	}

	paid, extended, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatalf("a recorded hold was held again: %v", f.escrow.holds)
	}
	if paid.Status != ExtPaid || paid.EscrowID == nil || *paid.EscrowID != "esc-crash" {
		t.Fatalf("paid = %+v, want paid on esc-crash", paid)
	}
	if want := sess.BookedStart.Add(40 * time.Minute); !extended.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v (30 + 10 minutes)", extended.EndsAt, want)
	}
}

// TestFailedStampClaimsThenRefundsTheHold pins the failed-stamp branch: the row
// is claimed with the same status guard before any money moves, so a hold is
// refunded only when this attempt wins the claim, and a successful refund clears
// escrow_id so the sweep can never refund the same hold twice.
func TestFailedStampClaimsThenRefundsTheHold(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}

	ctx := context.Background()
	// Reject only the stamp update (awaiting-payment row gaining an escrow id);
	// the claim update that flips the row expired stays legal.
	if _, err := f.pool.Exec(ctx, `CREATE OR REPLACE FUNCTION consult_test_fail_stamp() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'approved_awaiting_payment' AND NEW.escrow_id IS NOT NULL AND OLD.escrow_id IS NULL THEN
        RAISE EXCEPTION 'consult test: stamp fault';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;`); err != nil {
		t.Fatalf("install stamp fault function: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `CREATE TRIGGER consult_test_fail_stamp_trg BEFORE UPDATE ON consult_extension_requests
    FOR EACH ROW EXECUTE FUNCTION consult_test_fail_stamp();`); err != nil {
		t.Fatalf("install stamp fault trigger: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = f.pool.Exec(bg, `DROP TRIGGER IF EXISTS consult_test_fail_stamp_trg ON consult_extension_requests`)
		_, _ = f.pool.Exec(bg, `DROP FUNCTION IF EXISTS consult_test_fail_stamp()`)
	})

	_, _, err = f.svc.PayExtension(ctx, sess.ID, ext.ID, f.patientID)
	if err == nil || !strings.Contains(err.Error(), "record extension hold") {
		t.Fatalf("err = %v, want a record extension hold failure", err)
	}

	f.escrow.mu.Lock()
	holds := append([]string(nil), f.escrow.holds...)
	refunded := append([]string(nil), f.escrow.refunded...)
	states := make([]string, len(refunded))
	for i, id := range refunded {
		states[i] = f.escrow.state[id]
	}
	f.escrow.mu.Unlock()
	if len(holds) != 1 {
		t.Fatalf("holds = %v, want exactly one", holds)
	}
	if len(refunded) != 1 {
		t.Fatalf("refunded = %v, want exactly one", refunded)
	}
	if states[0] != "REFUNDED" {
		t.Fatalf("hold state = %q, want REFUNDED", states[0])
	}

	var status string
	var escrowID *string
	var released *time.Time
	if err := f.pool.QueryRow(ctx,
		`SELECT status, escrow_id, released_at FROM consult_extension_requests WHERE id=$1`, ext.ID).
		Scan(&status, &escrowID, &released); err != nil {
		t.Fatalf("reload extension: %v", err)
	}
	if status != string(ExtExpired) || escrowID != nil || released == nil {
		t.Fatalf("extension = %s / escrow %v / released %v, want expired, no hold, released", status, escrowID, released)
	}

	after, err := f.svc.Get(ctx, sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !after.EndsAt.Equal(sess.EndsAt) {
		t.Fatalf("ends_at = %v, want the unchanged %v", after.EndsAt, sess.EndsAt)
	}
}

// TestTwoConcurrentPaymentsChargeOnceAndApplyOnce pins the replay + claim race:
// both callers may take the same escrow hold, but only one may stamp the row
// paid and advance the session.
func TestTwoConcurrentPaymentsChargeOnceAndApplyOnce(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}

	errs := make([]error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	for i := range errs {
		i := i
		go func() {
			defer wg.Done()
			_, _, errs[i] = f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID)
		}()
	}
	wg.Wait()
	winners := 0
	for _, err := range errs {
		if err == nil {
			winners++
			continue
		}
		if !errors.Is(err, ErrExtensionNotPayable) && !errors.Is(err, ErrPaymentExpired) {
			t.Fatalf("loser err = %v, want ErrExtensionNotPayable or ErrPaymentExpired", err)
		}
	}
	if winners != 1 {
		t.Fatalf("payments succeeded = %d (%v), want exactly one", winners, errs)
	}
	if len(f.escrow.holds) != 1 {
		t.Fatalf("holds = %v, want one", f.escrow.holds)
	}
	if len(f.escrow.refunded) != 0 {
		t.Fatalf("a concurrent payment refunded a winner's hold: %v", f.escrow.refunded)
	}
	got, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if want := sess.BookedStart.Add(40 * time.Minute); !got.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v (30 base + 10 applied once)", got.EndsAt, want)
	}
}

func TestConcurrentProviderGrantAndPaidExtensionKeepBothIncrements(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}

	var grantErr, payErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, grantErr = f.svc.RequestExtension(context.Background(), sess.ID, f.providerID, 5)
	}()
	go func() {
		defer wg.Done()
		_, _, payErr = f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID)
	}()
	wg.Wait()
	if grantErr != nil {
		t.Fatalf("provider grant: %v", grantErr)
	}
	if payErr != nil {
		t.Fatalf("patient payment: %v", payErr)
	}
	got, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	wantEnd := sess.BookedStart.Add(45 * time.Minute)
	if !got.EndsAt.Equal(wantEnd) {
		t.Fatalf("ends_at = %v, want %v (30 + 5 + 10 minutes)", got.EndsAt, wantEnd)
	}
	if want := WarnAt(sess.BookedStart, wantEnd); !got.WarnAt.Equal(want) {
		t.Fatalf("warn_at = %v, want %v", got.WarnAt, want)
	}
}

func TestExtensionPaymentIsRefusedAfterComplete(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if err := f.svc.Complete(context.Background(), sess.ID, f.patientID); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrState) {
		t.Fatalf("pay after complete: err = %v, want ErrState", err)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatalf("a refused payment moved money: %v", f.escrow.holds)
	}
}

func TestApprovalIsRefusedAfterComplete(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if err := f.svc.Complete(context.Background(), sess.ID, f.providerID); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); !errors.Is(err, ErrState) {
		t.Fatalf("approve after complete: err = %v, want ErrState", err)
	}
}

func TestFreePriceExtensionNeedsNoEscrow(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 0)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if ext.PriceKobo != 0 {
		t.Fatalf("price = %d, want 0", ext.PriceKobo)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	paid, after, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatalf("a free extension held money: %v", f.escrow.holds)
	}
	if want := sess.EndsAt.Add(10 * time.Minute); !after.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", after.EndsAt, want)
	}
	if paid.Status != ExtPaid || paid.EscrowID != nil {
		t.Fatalf("paid = %+v, want paid with no escrow", paid)
	}
}

func TestExpiredHeldExtensionIsRefundedAtSessionEnd(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE consult_extension_requests SET status='expired', escrow_id='esc-crash', released_at=NULL WHERE id=$1`, ext.ID); err != nil {
		t.Fatalf("seed crashed hold: %v", err)
	}
	if err := f.svc.Complete(context.Background(), sess.ID, f.providerID); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if len(f.escrow.refunded) != 1 || f.escrow.refunded[0] != "esc-crash" {
		t.Fatalf("refunded = %v, want [esc-crash]", f.escrow.refunded)
	}
	var released *time.Time
	if err := f.pool.QueryRow(context.Background(),
		`SELECT released_at FROM consult_extension_requests WHERE id=$1`, ext.ID).Scan(&released); err != nil {
		t.Fatalf("reload extension: %v", err)
	}
	if released == nil {
		t.Fatal("released_at stayed NULL after the refund")
	}
}
