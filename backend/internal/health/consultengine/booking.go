package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// resolveBookPrice decides what a session costs. A snapshot wins over the
// package price because the module already moved that money; it must still
// agree with the pinned package's duration. A package that went inactive
// between the picker and the booking is refused — its price is no longer a
// price anyone can buy.
func resolveBookPrice(pkgDuration int, pkgPrice int64, pkgActive bool, snap *PriceSnapshot) (int, int64, error) {
	if snap != nil {
		if snap.DurationMinutes < MinDurationMinutes || snap.DurationMinutes > MaxDurationMinutes {
			return 0, 0, ErrInvalid
		}
		if snap.PriceKobo <= 0 || snap.PriceKobo > 100_000_000 {
			return 0, 0, ErrInvalid
		}
		if pkgDuration > 0 && snap.DurationMinutes != pkgDuration {
			return 0, 0, ErrInvalid
		}
		return snap.DurationMinutes, snap.PriceKobo, nil
	}
	if !pkgActive {
		return 0, 0, ErrInvalid
	}
	return pkgDuration, pkgPrice, nil
}

// resolveBooking validates the request and prices it, loading the pinned
// package when one is named.
func (s *Service) resolveBooking(ctx context.Context, req BookRequest) (int, int64, error) {
	if !validVertical(req.Vertical) || !validMode(req.Mode) {
		return 0, 0, ErrInvalid
	}
	if strings.TrimSpace(req.PatientID) == "" || strings.TrimSpace(req.SourceRef) == "" {
		return 0, 0, ErrInvalid
	}
	if strings.TrimSpace(req.PackageID) == "" && req.Snapshot == nil {
		return 0, 0, ErrInvalid
	}
	if err := s.verifyProviderUser(ctx, req); err != nil {
		return 0, 0, err
	}

	var pkgDuration int
	var pkgPrice int64
	var pkgActive bool
	if strings.TrimSpace(req.PackageID) != "" {
		const pq = `SELECT duration_minutes, price_kobo, active
		            FROM consult_session_packages
		            WHERE id=$1 AND owner_kind=$2 AND owner_id=$3 AND vertical=$4 AND mode=$5`
		err := s.db.QueryRow(ctx, pq, req.PackageID, req.ProviderOwnerKind,
			req.ProviderOwnerID, req.Vertical, req.Mode).
			Scan(&pkgDuration, &pkgPrice, &pkgActive)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, ErrInvalid
		}
		if err != nil {
			return 0, 0, fmt.Errorf("consult: load package: %w", err)
		}
	}
	return resolveBookPrice(pkgDuration, pkgPrice, pkgActive, req.Snapshot)
}

// assertSameBooking proves a conflicting insert is the SAME booking, not a
// second attempt to sell the same appointment at another price or to another
// provider. Any difference is a state conflict; the first row stays canonical.
func assertSameBooking(existing Session, req BookRequest, duration int, price int64) error {
	existingPackage := ""
	if existing.PackageID != nil {
		existingPackage = *existing.PackageID
	}
	same := existing.Vertical == req.Vertical &&
		existing.Mode == req.Mode &&
		existing.PatientID == req.PatientID &&
		existing.ProviderUserID == req.ProviderUserID &&
		existing.ProviderOwnerKind == req.ProviderOwnerKind &&
		existing.ProviderOwnerID == req.ProviderOwnerID &&
		existing.SourceRef == req.SourceRef &&
		existingPackage == req.PackageID &&
		existing.DurationMinutes == duration &&
		existing.PriceKobo == price
	if !same {
		return ErrState
	}
	return nil
}
