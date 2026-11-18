package consultengine

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLoadBySourceAndGetPackage(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)

	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-scan", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	bySource, err := f.svc.loadBySource(context.Background(), VerticalVet, "vet:appt-scan")
	if err != nil {
		t.Fatalf("load by source: %v", err)
	}
	if bySource.ID != sess.ID || bySource.PriceKobo != 500_000 {
		t.Fatalf("load by source = %s / %d", bySource.ID, bySource.PriceKobo)
	}
	if _, err := f.svc.loadBySource(context.Background(), VerticalVet, "vet:nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing source: err = %v, want ErrNotFound", err)
	}

	got, err := f.svc.GetPackage(context.Background(), pkg.ID)
	if err != nil {
		t.Fatalf("get package: %v", err)
	}
	if got.ID != pkg.ID || got.Mode != ModeVideo || got.DurationMinutes != 30 {
		t.Fatalf("package = %+v", got)
	}
	if _, err := f.svc.GetPackage(context.Background(), uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing package: err = %v, want ErrNotFound", err)
	}

	// An inactive package disappears from the public read.
	if _, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow, Vertical: VerticalVet,
		Mode: ModeVideo, DurationMinutes: 30, PriceKobo: 500_000, Active: false,
	}); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	if _, err := f.svc.GetPackage(context.Background(), pkg.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("inactive package: err = %v, want ErrNotFound", err)
	}
}

func TestEnsureSessionIsIdempotentOnSourceRef(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	req := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-idem", PackageID: pkg.ID,
	}
	first, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	second, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("a retry minted a second session: %s vs %s", second.ID, first.ID)
	}
	var count int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM consult_sessions WHERE vertical='vet' AND source_ref='vet:appt-idem'`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("sessions = %d, want 1", count)
	}
	if len(f.media.ensured) != 1 {
		t.Fatalf("a retry provisioned a second room: %v", f.media.ensured)
	}
}

func TestEnsureSessionRejectsAChangedPrice(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	base := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-reprice", PackageID: pkg.ID,
	}
	if _, err := f.svc.EnsureSession(context.Background(), base); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	cheaper := base
	cheaper.PackageID = ""
	cheaper.Snapshot = &PriceSnapshot{DurationMinutes: 30, PriceKobo: 400_000}
	if _, err := f.svc.EnsureSession(context.Background(), cheaper); !errors.Is(err, ErrState) {
		t.Fatalf("reprice: err = %v, want ErrState", err)
	}
}

func TestSnapshotPricedSessionNeedsNoPackage(t *testing.T) {
	f := newEngineFixture(t)
	sess, err := f.svc.EnsureSession(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:legacy-appt",
		Snapshot: &PriceSnapshot{DurationMinutes: 20, PriceKobo: 300_000},
	})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if sess.PackageID != nil {
		t.Fatalf("legacy session carries a package: %v", *sess.PackageID)
	}
	if sess.DurationMinutes != 20 || sess.PriceKobo != 300_000 {
		t.Fatalf("snapshot = %d min / %d kobo", sess.DurationMinutes, sess.PriceKobo)
	}
}

func TestJoinRefusesMoreThanTenMinutesEarly(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-early", PackageID: pkg.ID,
		Start: f.clock.Add(45 * time.Minute),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); !errors.Is(err, ErrState) {
		t.Fatalf("join 45m early: err = %v, want ErrState", err)
	}
	f.clock = f.clock.Add(36 * time.Minute) // 9 minutes before the booked start
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); err != nil {
		t.Fatalf("join inside the lead window: %v", err)
	}
}

func TestCompleteBySourceEndsThePinnedSession(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.EnsureSession(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-complete", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if err := f.svc.CompleteBySource(context.Background(), VerticalVet, "vet:appt-complete", f.providerID); err != nil {
		t.Fatalf("complete by source: %v", err)
	}
	got, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.State != StateEnded {
		t.Fatalf("state = %q, want ended", got.State)
	}
	if err := f.svc.CompleteBySource(context.Background(), VerticalVet, "vet:no-session", f.providerID); err != nil {
		t.Fatalf("a missing session must be a no-op, got %v", err)
	}
	if err := f.svc.CompleteBySource(context.Background(), VerticalVet, "vet:appt-complete", uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger complete: err = %v, want ErrNotFound", err)
	}
}

func TestListExtensionsIsParticipantScopedAndNewestFirst(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ctx := context.Background()

	first, err := f.svc.RequestExtension(ctx, sess.ID, f.patientID, 5)
	if err != nil {
		t.Fatalf("first request: %v", err)
	}
	if _, err := f.svc.DecideExtension(ctx, sess.ID, first.ID, f.providerID, false, "not now"); err != nil {
		t.Fatalf("decline: %v", err)
	}
	f.clock = f.clock.Add(time.Minute) // distinct created_at for the ordering
	second, err := f.svc.RequestExtension(ctx, sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("second request: %v", err)
	}

	list, err := f.svc.ListExtensions(ctx, sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 || list[0].ID != second.ID || list[1].ID != first.ID {
		t.Fatalf("order = %+v, want newest first", list)
	}
	if _, err := f.svc.ListExtensions(ctx, sess.ID, f.providerID); err != nil {
		t.Fatalf("provider list: %v", err)
	}
	if _, err := f.svc.ListExtensions(ctx, sess.ID, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger list: err = %v, want ErrNotFound", err)
	}
}

func TestEnsureSessionConvergesAfterThePackageIsRepriced(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	req := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-repriced", PackageID: pkg.ID,
	}
	first, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	repriced, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow, Vertical: VerticalVet,
		Mode: ModeVideo, DurationMinutes: 30, PriceKobo: 600_000, Active: true,
	})
	if err != nil {
		t.Fatalf("reprice: %v", err)
	}
	if repriced.ID != pkg.ID {
		t.Fatalf("reprice minted a new package: %s vs %s", repriced.ID, pkg.ID)
	}
	second, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("retry after reprice: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("a retry minted a second session: %s vs %s", second.ID, first.ID)
	}
	got, err := f.svc.Get(context.Background(), first.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.PriceKobo != 500_000 {
		t.Fatalf("stored price = %d, want 500000", got.PriceKobo)
	}
}

func TestEnsureSessionConvergesAfterThePackageIsDeactivated(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	req := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-deactivated", PackageID: pkg.ID,
	}
	first, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	deactivated, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow, Vertical: VerticalVet,
		Mode: ModeVideo, DurationMinutes: 30, PriceKobo: 500_000, Active: false,
	})
	if err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	if deactivated.ID != pkg.ID {
		t.Fatalf("deactivation minted a new package: %s vs %s", deactivated.ID, pkg.ID)
	}
	second, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("retry after deactivate: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("a retry minted a second session: %s vs %s", second.ID, first.ID)
	}
}

func TestEnsureSessionRejectsAChangedParticipant(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	base := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-participant", PackageID: pkg.ID,
	}
	if _, err := f.svc.EnsureSession(context.Background(), base); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	other := base
	other.PatientID = uuid.NewString() // no such user: identity is checked before any lookup
	if _, err := f.svc.EnsureSession(context.Background(), other); !errors.Is(err, ErrState) {
		t.Fatalf("changed participant: err = %v, want ErrState", err)
	}
}
