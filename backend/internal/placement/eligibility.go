package placement

import (
	"context"
	"fmt"
	"strings"
)

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility
//
// Re-checked at SUBMIT and at ACTIVATION (scheduler). Splits into:
//   - External checks (merchant verified + good-standing at required KYC tier;
//     subject published + owned): behind the ExternalEligibility interface so they
//     can be wired to KYC/tiers/subject modules later. A permissive default impl is
//     provided with a clear TODO — it must be replaced before go-live.
//   - Self-owned checks (concurrent-campaign cap, per-zone cooldown, creative
//     pre-checks): fully implemented here against this module's own tables.
// ─────────────────────────────────────────────────────────────────────────────

// ExternalEligibility abstracts the cross-module gates this package cannot own:
// merchant KYC/good-standing and subject publication/ownership. The service calls
// it at submit + activation. A failing check returns a non-nil error wrapping
// ErrIneligible.
//
// TODO(go-live): replace PermissiveExternalEligibility with a real impl that:
//   - resolves the merchant's KYC tier via finance/tiers and requires >= the zone's
//     minimum tier, plus a good-standing (not suspended/flagged) check;
//   - verifies the subject (subject_type + subject_id) is PUBLISHED and OWNED by the
//     merchant in its source module (product/service/property/event/store/creator).
type ExternalEligibility interface {
	// CheckMerchant validates the merchant is verified + in good standing at the KYC
	// tier the zone requires.
	CheckMerchant(ctx context.Context, merchantID, zoneCode string) error
	// CheckSubject validates the subject is published and owned by the merchant.
	CheckSubject(ctx context.Context, merchantID, subjectType, subjectID string) error
}

// PermissiveExternalEligibility is the default impl: it ALLOWS everything. It exists
// so the module is functional in dev/CI before the KYC/subject wiring lands. It MUST
// be replaced before go-live (see TODO on ExternalEligibility).
type PermissiveExternalEligibility struct{}

func (PermissiveExternalEligibility) CheckMerchant(ctx context.Context, merchantID, zoneCode string) error {
	return nil
}

func (PermissiveExternalEligibility) CheckSubject(ctx context.Context, merchantID, subjectType, subjectID string) error {
	return nil
}

// EligibilityConfig holds the self-owned eligibility knobs (config, not code).
type EligibilityConfig struct {
	// MaxConcurrentCampaigns caps how many non-terminal campaigns a merchant may hold
	// at once across all zones.
	MaxConcurrentCampaigns int
	// PerZoneCooldownDays is the minimum gap (in days) between a merchant's campaigns
	// in the SAME zone (measured against the most recent campaign's window_end).
	PerZoneCooldownDays int
	// BannedWords are rejected anywhere in the headline (case-insensitive substring).
	BannedWords []string
}

// DefaultEligibilityConfig returns sane v1 defaults.
func DefaultEligibilityConfig() EligibilityConfig {
	return EligibilityConfig{
		MaxConcurrentCampaigns: 5,
		PerZoneCooldownDays:    0,
		BannedWords:            []string{"scam", "guaranteed returns", "free money", "ponzi"},
	}
}

// validateCreative runs the creative pre-checks against the zone's creative_spec:
//   - image ratio present (creative.image_ref non-empty);
//   - headline length ≤ the zone's headline_max;
//   - no banned words in the headline;
//   - CTA in the zone's allowed cta_options set.
//
// It is a pure function (no DB) so it is unit-testable. Returns an error wrapping
// ErrIneligible on the first failed check.
func validateCreative(zone *Zone, creative map[string]any, banned []string) error {
	if creative == nil {
		return fmt.Errorf("%w: creative is required", ErrIneligible)
	}

	// image_ref must be present (the ratio itself is validated client-side against the
	// zone's image_ratio spec; here we require the asset reference exists).
	imageRef, _ := creative["image_ref"].(string)
	if strings.TrimSpace(imageRef) == "" {
		return fmt.Errorf("%w: creative.image_ref required (zone ratio %v)", ErrIneligible, zone.CreativeSpec["image_ratio"])
	}

	headline, _ := creative["headline"].(string)
	headline = strings.TrimSpace(headline)
	if headline == "" {
		return fmt.Errorf("%w: creative.headline required", ErrIneligible)
	}

	// headline_max from the zone spec (JSON numbers decode to float64).
	if maxRaw, ok := zone.CreativeSpec["headline_max"]; ok {
		if max := toInt(maxRaw); max > 0 && len([]rune(headline)) > max {
			return fmt.Errorf("%w: headline exceeds %d chars for zone %s", ErrIneligible, max, zone.Code)
		}
	}

	// Banned words (case-insensitive substring) in the headline.
	lower := strings.ToLower(headline)
	for _, w := range banned {
		w = strings.ToLower(strings.TrimSpace(w))
		if w != "" && strings.Contains(lower, w) {
			return fmt.Errorf("%w: headline contains banned word", ErrIneligible)
		}
	}

	// CTA must be in the zone's allowed set (when the zone declares one).
	cta, _ := creative["cta"].(string)
	cta = strings.TrimSpace(cta)
	if allowed := ctaOptions(zone); len(allowed) > 0 {
		if cta == "" {
			return fmt.Errorf("%w: cta required (allowed: %s)", ErrIneligible, strings.Join(allowed, ", "))
		}
		ok := false
		for _, a := range allowed {
			if a == cta {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Errorf("%w: cta %q not allowed for zone %s", ErrIneligible, cta, zone.Code)
		}
	}
	return nil
}

// ctaOptions extracts the allowed CTA strings from a zone's creative_spec.
func ctaOptions(zone *Zone) []string {
	raw, ok := zone.CreativeSpec["cta_options"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// toInt coerces a JSON-decoded numeric (float64) or int to int.
func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}
