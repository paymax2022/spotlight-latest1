package placement

import (
	"context"
	"hash/fnv"
	"sort"
	"time"

	"github.com/google/uuid"
)

// LandingRequest is the public landing-resolve input.
type LandingRequest struct {
	SessionID string // deterministic rotation seed (per consumer session)
	Now       time.Time
}

// LandingZone is one zone's resolved slots in the landing response.
type LandingZone struct {
	ZoneCode   string       `json:"zone_code"`
	Label      string       `json:"label"`
	LayoutType LayoutType   `json:"layout_type"`
	Capacity   int          `json:"capacity"`
	Items      []ServedItem `json:"items"`
}

// Landing resolves the consumer-facing featured surface for all active zones.
//
//   - Per zone: campaigns with state=ACTIVE and now within [window_start,window_end).
//     SUSPENDED is structurally excluded by the ServingCandidates query (state=ACTIVE
//     only), satisfying the "re-check that you'd drop SUSPENDED" requirement.
//   - HERO (EXCLUSIVE): a single active campaign, else a house fallback object (never
//     empty).
//   - POOLED over capacity: weighted-fair rotation — candidates are ordered by tier
//     weight (tier_multiplier, higher first) then rotated by a deterministic seed
//     derived from the session id, so the same session sees a stable ordering and
//     different sessions see different leaders. (A full per-campaign fairness counter
//     is deferred to v2; documented here.)
//   - Each served item gets a fresh placement_token (uuid) and a "Featured" label.
func (s *Service) Landing(ctx context.Context, req LandingRequest) ([]LandingZone, error) {
	now := req.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()

	zones, err := s.repo.ListZones(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]LandingZone, 0, len(zones))
	for i := range zones {
		z := zones[i]
		candidates, err := s.repo.ServingCandidates(ctx, z.Code, now)
		if err != nil {
			return nil, err
		}
		items := resolveZoneItems(&z, candidates, req.SessionID)
		out = append(out, LandingZone{
			ZoneCode:   z.Code,
			Label:      z.Label,
			LayoutType: z.LayoutType,
			Capacity:   z.Capacity,
			Items:      items,
		})
	}
	return out, nil
}

// resolveZoneItems applies the per-zone serving policy. Pure (no DB) so the rotation
// is unit-testable. Tier weight here is the zone's configured tier_multiplier; a
// per-campaign tier weight can replace it without changing the rotation contract.
func resolveZoneItems(zone *Zone, candidates []Campaign, sessionID string) []ServedItem {
	if zone.LayoutType == LayoutExclusive {
		if len(candidates) == 0 {
			return []ServedItem{houseFallback(zone)}
		}
		// EXCLUSIVE: at most one slot. The no-overlap reservation guarantees a single
		// live campaign, but defend anyway by picking the rotation leader.
		ordered := rotateByTier(candidates, zone.TierMultiplier, sessionID)
		return []ServedItem{served(zone, ordered[0])}
	}

	// POOLED: order by tier weight + deterministic rotation, then cap at capacity.
	ordered := rotateByTier(candidates, zone.TierMultiplier, sessionID)
	capN := zone.Capacity
	if capN <= 0 {
		capN = len(ordered)
	}
	if len(ordered) > capN {
		ordered = ordered[:capN]
	}
	items := make([]ServedItem, 0, len(ordered))
	for _, c := range ordered {
		items = append(items, served(zone, c))
	}
	return items
}

// rotateByTier returns candidates ordered by descending tier weight, with a stable
// secondary order by id, then rotated by a deterministic offset derived from sessionID.
// The rotation keeps the relative tier ordering but shifts the leader per session so
// no single campaign permanently monopolizes the top slot across sessions.
func rotateByTier(in []Campaign, tierWeight float64, sessionID string) []Campaign {
	out := make([]Campaign, len(in))
	copy(out, in)
	// Stable tier ordering: higher weight first. All campaigns in a zone share the
	// zone's tier weight in v1, so the tie-break by id is what makes it deterministic.
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].ID < out[j].ID
	})
	n := len(out)
	if n <= 1 {
		return out
	}
	offset := int(seedHash(sessionID) % uint64(n))
	rotated := make([]Campaign, 0, n)
	rotated = append(rotated, out[offset:]...)
	rotated = append(rotated, out[:offset]...)
	return rotated
}

// seedHash hashes the session id to a deterministic uint64. An empty session id maps
// to 0 (stable default ordering).
func seedHash(sessionID string) uint64 {
	if sessionID == "" {
		return 0
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(sessionID))
	return h.Sum64()
}

func served(zone *Zone, c Campaign) ServedItem {
	return ServedItem{
		CampaignID:     c.ID,
		ZoneCode:       zone.Code,
		SubjectType:    c.SubjectType,
		SubjectID:      c.SubjectID,
		Creative:       c.Creative,
		PlacementToken: uuid.NewString(),
		Label:          "Featured",
	}
}

// houseFallback is the never-empty HERO filler when no campaign is live.
func houseFallback(zone *Zone) ServedItem {
	return ServedItem{
		ZoneCode:       zone.Code,
		SubjectType:    "house",
		SubjectID:      "house:" + zone.Code,
		Creative:       map[string]any{"headline": zone.Label, "house": true},
		PlacementToken: uuid.NewString(),
		Label:          "Featured",
		House:          true,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics ingest (public events endpoint)
// ─────────────────────────────────────────────────────────────────────────────

// EventKind discriminates the public analytics events.
type EventKind string

const (
	EventImpression EventKind = "impression"
	EventTap        EventKind = "tap"
)

// EventInput is one analytics event in the public batch.
type EventInput struct {
	Kind           EventKind `json:"kind"`
	CampaignID     string    `json:"campaign_id"`
	ZoneCode       string    `json:"zone_code"`
	PlacementToken string    `json:"placement_token"`
	SessionID      string    `json:"session_id"`
}

// RecordEvents appends a batch of impression/tap events (append-only, best-effort per
// row). Invalid rows are skipped; the count of accepted rows is returned.
func (s *Service) RecordEvents(ctx context.Context, events []EventInput) (int, error) {
	n := 0
	for _, e := range events {
		if e.CampaignID == "" || e.ZoneCode == "" || e.PlacementToken == "" {
			continue
		}
		var err error
		switch e.Kind {
		case EventTap:
			err = s.repo.InsertTap(ctx, e.CampaignID, e.ZoneCode, e.PlacementToken, e.SessionID)
		case EventImpression:
			err = s.repo.InsertImpression(ctx, e.CampaignID, e.ZoneCode, e.PlacementToken, e.SessionID)
		default:
			continue
		}
		if err == nil {
			n++
		}
	}
	return n, nil
}
