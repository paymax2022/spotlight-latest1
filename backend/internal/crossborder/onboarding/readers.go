package onboarding

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// rowQuerier is the single-row read seam (satisfied by *pgxpool.Pool).
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ProfileStore reads the existing Spotlight KYC/profile data from user_profiles.
// It is READ-ONLY and never re-collects anything from the user. It satisfies
// both KYCReader and ProfileReader.
//
// KNOWN GAP (do not paper over): Spotlight stores NO postal address line and
// NO nationality for a user (kycverify only extracts them transiently from the
// provider response). This reader therefore returns only what is really stored
// (legal name, DOB, BVN/NIN presence, country/city when present) and leaves
// Nationality and Address.Line1 empty. BuildOnboardingData then FAILS CLOSED
// with "KYC nationality is required" / "KYC address is required" — individual
// activation cannot succeed until a persisted source exists. No value is
// guessed or defaulted here.
type ProfileStore struct{ db rowQuerier }

// NewProfileStore builds the reader over a pool.
func NewProfileStore(db rowQuerier) *ProfileStore { return &ProfileStore{db: db} }

var (
	_ KYCReader     = (*ProfileStore)(nil)
	_ ProfileReader = (*ProfileStore)(nil)
)

// GetKYCView implements KYCReader.
func (p *ProfileStore) GetKYCView(ctx context.Context, userID string) (KYCView, error) {
	const q = `
		SELECT COALESCE(first_name,''), COALESCE(last_name,''),
		       COALESCE(to_char(date_of_birth,'YYYY-MM-DD'),''),
		       COALESCE(country,''), COALESCE(city,''),
		       COALESCE(bvn_hash,'') <> '', COALESCE(nin_hash,'') <> ''
		FROM user_profiles WHERE id = $1`
	var v KYCView
	var country, city string
	err := p.db.QueryRow(ctx, q, userID).Scan(&v.FirstName, &v.LastName, &v.DateOfBirth,
		&country, &city, &v.HasBVN, &v.HasNIN)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return KYCView{}, fmt.Errorf("onboarding: no profile for user")
		}
		return KYCView{}, fmt.Errorf("onboarding: read kyc view: %w", err)
	}
	// Only a well-formed ISO alpha-2 country is carried; free text is not
	// reinterpreted. Line1 and Nationality have no stored source (see type doc).
	if c := strings.ToUpper(strings.TrimSpace(country)); len(c) == 2 {
		v.Address.Country = c
	}
	v.Address.City = strings.TrimSpace(city)
	return v, nil
}

// GetProfile implements ProfileReader (contact data only; a business profile
// has no stored source and must be supplied by the request).
func (p *ProfileStore) GetProfile(ctx context.Context, userID string) (Profile, error) {
	const q = `SELECT COALESCE(email,''), COALESCE(phone,'') FROM user_profiles WHERE id = $1`
	prof := Profile{UserID: userID}
	err := p.db.QueryRow(ctx, q, userID).Scan(&prof.Email, &prof.Phone)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return Profile{}, fmt.Errorf("onboarding: no profile for user")
		}
		return Profile{}, fmt.Errorf("onboarding: read profile: %w", err)
	}
	return prof, nil
}
