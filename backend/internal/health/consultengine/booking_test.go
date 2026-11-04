package consultengine

import (
	"errors"
	"testing"
)

func TestResolveBookPrice(t *testing.T) {
	snap := &PriceSnapshot{DurationMinutes: 20, PriceKobo: 300_000}
	cases := []struct {
		name      string
		dur       int
		price     int64
		active    bool
		snap      *PriceSnapshot
		wantDur   int
		wantPrice int64
		wantErr   bool
	}{
		{"active package", 30, 500_000, true, nil, 30, 500_000, false},
		{"inactive package without snapshot", 30, 500_000, false, nil, 0, 0, true},
		{"snapshot without package", 0, 0, false, snap, 20, 300_000, false},
		{"snapshot wins over package price", 20, 900_000, true, snap, 20, 300_000, false},
		{"snapshot duration disagrees with package", 30, 500_000, true, snap, 0, 0, true},
		{"zero snapshot price", 0, 0, false, &PriceSnapshot{DurationMinutes: 20}, 0, 0, true},
		{"snapshot below the duration floor", 0, 0, false, &PriceSnapshot{DurationMinutes: 1, PriceKobo: 100}, 0, 0, true},
		{"snapshot above the price ceiling", 0, 0, false, &PriceSnapshot{DurationMinutes: 20, PriceKobo: 100_000_001}, 0, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, p, err := resolveBookPrice(tc.dur, tc.price, tc.active, tc.snap)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalid) {
					t.Fatalf("err = %v, want ErrInvalid", err)
				}
				return
			}
			if err != nil || d != tc.wantDur || p != tc.wantPrice {
				t.Fatalf("got %d/%d/%v, want %d/%d", d, p, err, tc.wantDur, tc.wantPrice)
			}
		})
	}
}

func TestAssertSameBooking(t *testing.T) {
	pkg := "pkg-1"
	base := Session{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: "patient-1",
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: "owner-1",
		ProviderUserID: "provider-1", SourceRef: "vet:appt-1", PackageID: &pkg,
		DurationMinutes: 30, PriceKobo: 500_000,
	}
	req := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: "patient-1",
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: "owner-1",
		ProviderUserID: "provider-1", SourceRef: "vet:appt-1", PackageID: pkg,
	}
	if err := assertSameBooking(base, req, 30, 500_000); err != nil {
		t.Fatalf("identical booking: %v", err)
	}
	if err := assertSameBooking(base, req, 30, 400_000); !errors.Is(err, ErrState) {
		t.Fatalf("changed price: err = %v, want ErrState", err)
	}
	other := req
	other.PatientID = "patient-2"
	if err := assertSameBooking(base, other, 30, 500_000); !errors.Is(err, ErrState) {
		t.Fatalf("changed patient: err = %v, want ErrState", err)
	}
	unpinned := req
	unpinned.PackageID = ""
	if err := assertSameBooking(base, unpinned, 30, 500_000); !errors.Is(err, ErrState) {
		t.Fatalf("changed package: err = %v, want ErrState", err)
	}
}
