package consultengine

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

// stubRow assigns values positionally, so a scanner can be tested without a DB.
type stubRow struct{ values []any }

func (s stubRow) Scan(dest ...any) error {
	if len(dest) != len(s.values) {
		return fmt.Errorf("scan: %d destinations, %d values", len(dest), len(s.values))
	}
	for i := range dest {
		target := reflect.ValueOf(dest[i]).Elem()
		src := reflect.ValueOf(s.values[i])
		if !src.IsValid() {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		if !src.Type().AssignableTo(target.Type()) {
			return fmt.Errorf("scan: value %d is %s, want %s", i, src.Type(), target.Type())
		}
		target.Set(src)
	}
	return nil
}

func TestScanSessionMapsEnumsAndNullables(t *testing.T) {
	start := time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC)
	pkg, hold := "pkg-1", "hold-1"
	row := stubRow{values: []any{
		"id-1", "vet", "video", "patient-1", "health_provider", "owner-1", "provider-1",
		"vet:appt-1", &pkg, 30, int64(500_000), start, start.Add(30 * time.Minute),
		start.Add(25 * time.Minute), (*time.Time)(nil), "live", "consult-vet-id-1", &hold,
		(*time.Time)(nil),
	}}
	sess, err := scanSession(row)
	if err != nil {
		t.Fatalf("scanSession: %v", err)
	}
	if sess.Vertical != VerticalVet || sess.Mode != ModeVideo || sess.State != StateLive {
		t.Fatalf("enums = %q/%q/%q", sess.Vertical, sess.Mode, sess.State)
	}
	if sess.ProviderOwnerKind != OwnerHealthProvider {
		t.Fatalf("owner kind = %q", sess.ProviderOwnerKind)
	}
	if sess.PackageID == nil || *sess.PackageID != "pkg-1" {
		t.Fatalf("package id = %v", sess.PackageID)
	}
	if sess.BaseHoldID == nil || *sess.BaseHoldID != "hold-1" {
		t.Fatalf("hold id = %v", sess.BaseHoldID)
	}
	if sess.WarningSentAt != nil || sess.EndedAt != nil {
		t.Fatalf("nullable timestamps = %v / %v", sess.WarningSentAt, sess.EndedAt)
	}
	if !sess.EndsAt.Equal(start.Add(30 * time.Minute)) {
		t.Fatalf("ends_at = %v", sess.EndsAt)
	}
}

func TestScanSessionRejectsAWidthMismatch(t *testing.T) {
	if _, err := scanSession(stubRow{values: []any{"only-one"}}); err == nil {
		t.Fatal("a short row must error rather than silently zero the session")
	}
}
