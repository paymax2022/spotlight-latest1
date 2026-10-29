// Package clinicloc holds the clinic-location rules shared by the vet provider
// profile (PUT /provider/profile) and the provider application location route
// (PUT /providers/applications/:id/location): one validator, one draft patch and
// one merge into doctor_vet_profiles.profile_draft, so the two never drift.
package clinicloc

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	MaxAddressLen = 200
	MaxPartLen    = 100
)

// Input is the optional clinic-location fields. A nil field was not sent.
type Input struct {
	Address *string
	City    *string
	State   *string
	Lat     *float64
	Lng     *float64
}

// Validate returns the message to show the caller, or "" when the input is acceptable.
func Validate(in Input) string {
	if in.Address != nil && len(strings.TrimSpace(*in.Address)) > MaxAddressLen {
		return "clinic address must be 200 characters or fewer"
	}
	for _, s := range []*string{in.City, in.State} {
		if s != nil && len(strings.TrimSpace(*s)) > MaxPartLen {
			return "clinic city and state must be 100 characters or fewer"
		}
	}
	if (in.Lat == nil) != (in.Lng == nil) {
		return "send both clinicLat and clinicLng, or neither"
	}
	if in.Lat != nil {
		lat, lng := *in.Lat, *in.Lng
		if lat != lat || lng != lng || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			return "clinic coordinates are out of range"
		}
		if lat == 0 && lng == 0 {
			return "clinic coordinates must be a real location"
		}
	}
	return ""
}

// DraftPatch is the personalInfo keys the caller actually sent, so a save that
// omits a field never blanks it.
func DraftPatch(in Input) map[string]string {
	patch := map[string]string{}
	if in.Address != nil {
		patch["address"] = strings.TrimSpace(*in.Address)
	}
	if in.City != nil {
		patch["city"] = strings.TrimSpace(*in.City)
	}
	if in.State != nil {
		patch["state"] = strings.TrimSpace(*in.State)
	}
	return patch
}

// Execer is satisfied by pgx.Tx and *pgxpool.Pool.
type Execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

const mergeDraftSQL = `
	INSERT INTO doctor_vet_profiles (user_id, profile_draft)
	VALUES ($1, jsonb_build_object('draft', jsonb_build_object('personalInfo', $2::jsonb)))
	ON CONFLICT (user_id) DO UPDATE SET
	  profile_draft = jsonb_set(
	    COALESCE(doctor_vet_profiles.profile_draft, '{}'::jsonb)
	      || jsonb_build_object('draft', COALESCE(doctor_vet_profiles.profile_draft->'draft', '{}'::jsonb)),
	    '{draft,personalInfo}',
	    COALESCE(doctor_vet_profiles.profile_draft->'draft'->'personalInfo', '{}'::jsonb) || $2::jsonb,
	    true),
	  updated_at = now()`

// MergeDraft merges patch into the user's doctor_vet_profiles personalInfo without
// touching any other draft key, creating the profile row when it is absent. An
// empty patch is a no-op.
func MergeDraft(ctx context.Context, ex Execer, userID string, patch map[string]string) error {
	if len(patch) == 0 {
		return nil
	}
	raw, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	_, err = ex.Exec(ctx, mergeDraftSQL, userID, string(raw))
	return err
}
