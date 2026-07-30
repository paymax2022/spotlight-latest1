// Package connectprofile implements Paymax Connect Phase-1 identity profiles and
// independent per-mode visibility (dating/friendship/professional/creator/event).
// Visibility is enforced server-side: a mode is only discoverable when the user
// has explicitly turned it on. See docs/prd/dating/{data-model.md, api.md §Phase 1}.
package connectprofile

import "time"

// Valid profile modes — MUST match the connect_profile_modes.mode CHECK constraint.
var validModes = map[string]bool{
	"dating": true, "friendship": true, "professional": true, "creator": true, "event": true,
}

// ValidMode reports whether m is a known profile mode.
func ValidMode(m string) bool { return validModes[m] }

// Profile is the identity-level record. dob is NEVER serialised to peers; it is
// only used for the age gate. The omitted json tag keeps it off the wire entirely.
type Profile struct {
	ID          string  `json:"id"`
	UserID      string  `json:"user_id"`
	DisplayName *string `json:"display_name,omitempty"`
	Bio         *string `json:"bio,omitempty"`
	City        *string `json:"city,omitempty"`
	dob         *time.Time
	geoLat      *float64
	geoLng      *float64
	Badge       bool      `json:"verified_badge"` // surfaced from connect_verification
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Mode is a per-mode visibility/privacy/intent record.
type Mode struct {
	Mode       string         `json:"mode"`
	Visible    bool           `json:"visible"`
	IntentTags []string       `json:"intent_tags"`
	Privacy    map[string]any `json:"privacy"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

// UpsertProfileInput is the member body for PATCH /profile. Nil fields are left
// unchanged; the user/dob are never settable here (dob is owned by the age gate).
type UpsertProfileInput struct {
	DisplayName *string  `json:"display_name"`
	Bio         *string  `json:"bio"`
	City        *string  `json:"city"`
	GeoLat      *float64 `json:"geo_lat"` // approximate centroid only
	GeoLng      *float64 `json:"geo_lng"`
}

// UpsertModeInput is the body for PATCH /profile/modes/:mode.
type UpsertModeInput struct {
	Visible    *bool          `json:"visible"`
	IntentTags []string       `json:"intent_tags"`
	Privacy    map[string]any `json:"privacy"`
}
