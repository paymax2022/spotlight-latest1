package engage

import (
	"context"
	"errors"
	"strings"
)

// ─── Campaign engagement events (VIEW / SHARE) ───────────────────────────────
//
// These feed the creator performance screen's Views, Shares, Conversion and
// traffic-source figures. Before this existed those numbers were derived from a
// hash of the campaign id (see the migration header for the exact formula), so
// they looked plausible without being real.
//
// Writes are backend-only: cf_campaign_events grants no INSERT to
// `authenticated`, so a client cannot inflate its own counts by posting rows
// straight at PostgREST.

// ErrInvalidEvent is returned when the event type or campaign is not usable.
var ErrInvalidEvent = errors.New("engage: invalid campaign event")

// knownSources is the channel vocabulary the traffic-source breakdown groups on.
// Anything unrecognised is normalised to "other" rather than stored verbatim, so
// a typo or a spoofed value from a client cannot create a junk row in the
// creator's breakdown.
var knownSources = map[string]string{
	"direct":         "Direct",
	"whatsapp":       "WhatsApp",
	"facebook":       "Facebook",
	"instagram":      "Instagram",
	"twitter":        "Twitter/X",
	"x":              "Twitter/X",
	"telegram":       "Telegram",
	"linkedin":       "LinkedIn",
	"spotlight_feed": "Spotlight feed",
	"email":          "Email",
	"sms":            "SMS",
	"other":          "Other",
}

// NormaliseSource maps a caller-supplied channel onto the known vocabulary.
// Unknown or empty values become "other"/"direct" rather than being trusted.
func NormaliseSource(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "direct"
	}
	if _, ok := knownSources[s]; ok {
		return s
	}
	return "other"
}

// SourceLabel returns the display label for a stored source key.
func SourceLabel(key string) string {
	if label, ok := knownSources[key]; ok {
		return label
	}
	return "Other"
}

// RecordCampaignEvent appends one VIEW or SHARE for a campaign.
//
// userID may be empty — campaign pages are public and an anonymous view is still
// a view; anonymousID then carries the device/session so unique-viewer counts
// stay meaningful. The insert is deliberately not idempotent: repeat views are
// real events, and de-duplication (unique viewers vs total views) is a decision
// for the read side, not the write side.
func (s *Service) RecordCampaignEvent(ctx context.Context, campaignID, eventType, source, userID, anonymousID string) error {
	et := strings.ToUpper(strings.TrimSpace(eventType))
	if et != "VIEW" && et != "SHARE" {
		return ErrInvalidEvent
	}
	if strings.TrimSpace(campaignID) == "" {
		return ErrInvalidEvent
	}

	// A NULL actor is an anonymous viewer; an empty string would violate the FK.
	var actor any
	if strings.TrimSpace(userID) != "" {
		actor = userID
	}

	const q = `
		INSERT INTO cf_campaign_events (campaign_id, event_type, source, actor_user_id, anonymous_id)
		VALUES ($1, $2, $3, $4, $5)`
	_, err := s.db.Exec(ctx, q, campaignID, et, NormaliseSource(source), actor, strings.TrimSpace(anonymousID))
	return err
}
