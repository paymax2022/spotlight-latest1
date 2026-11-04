package consultengine

import (
	"context"
	"errors"
	"testing"

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
