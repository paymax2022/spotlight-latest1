package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// validMode and validVertical keep the API honest even though the DB also checks.
func validMode(m Mode) bool {
	return m == ModeChat || m == ModeVoice || m == ModeVideo
}

func validVertical(v Vertical) bool {
	return v == VerticalTelemedicine || v == VerticalVet || v == VerticalPharmacy || v == VerticalLab
}

// verifyOwner proves the caller may price for this owner.
func (s *Service) verifyOwner(ctx context.Context, callerID string, kind OwnerKind, ownerID string) error {
	callerID = strings.TrimSpace(callerID)
	if callerID == "" {
		return ErrNotFound
	}
	switch kind {
	case OwnerDoctor:
		if callerID != ownerID {
			return ErrNotFound
		}
		return nil
	case OwnerHealthProvider:
		var owner string
		err := s.db.QueryRow(ctx, `SELECT owner_user_id::text FROM health_providers WHERE id=$1`, ownerID).Scan(&owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("consult: resolve provider owner: %w", err)
		}
		if owner != callerID {
			return ErrNotFound
		}
		return nil
	default:
		return ErrInvalid
	}
}

// PublishPackage creates or updates one price point. The caller must own the
// pricing surface; publishing for someone else is a uniform not-found.
func (s *Service) PublishPackage(ctx context.Context, callerID string, pkg Package) (Package, error) {
	if !validVertical(pkg.Vertical) || !validMode(pkg.Mode) {
		return Package{}, ErrInvalid
	}
	if pkg.DurationMinutes < MinDurationMinutes || pkg.DurationMinutes > MaxDurationMinutes {
		return Package{}, ErrInvalid
	}
	if pkg.PriceKobo < 0 || pkg.PriceKobo > 100_000_000 {
		return Package{}, ErrInvalid
	}
	if err := s.verifyOwner(ctx, callerID, pkg.OwnerKind, pkg.OwnerID); err != nil {
		return Package{}, err
	}
	const q = `INSERT INTO consult_session_packages
	             (owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)
	           ON CONFLICT (owner_kind, owner_id, vertical, mode, duration_minutes)
	           DO UPDATE SET price_kobo=EXCLUDED.price_kobo, active=EXCLUDED.active, updated_at=now()
	           RETURNING id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active, created_at`
	var out Package
	var ownerKind, vertical, mode string
	err := s.db.QueryRow(ctx, q, pkg.OwnerKind, pkg.OwnerID, pkg.Vertical, pkg.Mode,
		pkg.DurationMinutes, pkg.PriceKobo, pkg.Active).Scan(
		&out.ID, &ownerKind, &out.OwnerID, &vertical, &mode,
		&out.DurationMinutes, &out.PriceKobo, &out.Active, &out.CreatedAt)
	if err != nil {
		return Package{}, fmt.Errorf("consult: publish package: %w", err)
	}
	out.OwnerKind, out.Vertical, out.Mode = OwnerKind(ownerKind), Vertical(vertical), Mode(mode)
	return out, nil
}

// ListPackages returns active price points for one vertical, optionally narrowed
// to one owner.
func (s *Service) ListPackages(ctx context.Context, vertical Vertical, ownerKind OwnerKind, ownerID string) ([]Package, error) {
	if !validVertical(vertical) {
		return nil, ErrInvalid
	}
	const q = `SELECT id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active, created_at
	           FROM consult_session_packages
	           WHERE vertical=$1 AND active=true
	             AND ($2='' OR owner_kind=$2)
	             AND ($3='' OR owner_id::text=$3)
	           ORDER BY mode, duration_minutes`
	rows, err := s.db.Query(ctx, q, vertical, string(ownerKind), ownerID)
	if err != nil {
		return nil, fmt.Errorf("consult: list packages: %w", err)
	}
	defer rows.Close()
	var out []Package
	for rows.Next() {
		var p Package
		var ownerKind, vertical, mode string
		if err := rows.Scan(&p.ID, &ownerKind, &p.OwnerID, &vertical, &mode,
			&p.DurationMinutes, &p.PriceKobo, &p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.OwnerKind, p.Vertical, p.Mode = OwnerKind(ownerKind), Vertical(vertical), Mode(mode)
		out = append(out, p)
	}
	return out, rows.Err()
}
