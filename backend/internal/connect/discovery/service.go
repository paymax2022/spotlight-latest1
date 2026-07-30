package connectdiscovery

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service powers curated daily discovery and privacy-preserving search. It runs
// with the service-role pgx pool so it can read across users while applying
// per-mode visibility and verified/badge rules itself in SQL.
type Service struct {
	db  *pgxpool.Pool
	cfg *configReader
	// viewerFn resolves the caller's profile id + approximate geo. It defaults to
	// the DB-backed viewer; tests override it to exercise Swipe's routing/guards
	// (direction → kind, self-swipe, invalid direction) without a live database.
	viewerFn func(ctx context.Context, userID string) (string, *float64, *float64, error)
}

// NewService builds the discovery service.
func NewService(db *pgxpool.Pool) *Service {
	s := &Service{db: db, cfg: newConfigReader(db)}
	s.viewerFn = s.viewer
	return s
}

// resolveViewer indirects through the (overridable) viewerFn seam, falling back to
// the DB-backed viewer when unset (e.g. a Service built as a struct literal).
func (s *Service) resolveViewer(ctx context.Context, userID string) (string, *float64, *float64, error) {
	if s.viewerFn != nil {
		return s.viewerFn(ctx, userID)
	}
	return s.viewer(ctx, userID)
}

// rawCandidate is the internal row shape before distance bucketing / reason cards.
type rawCandidate struct {
	profileID   string
	displayName *string
	city        *string
	verified    bool
	intentTags  []string
	geoLat      *float64
	geoLng      *float64
}

// viewer resolves the caller's profile id + approximate geo for distance calc.
func (s *Service) viewer(ctx context.Context, userID string) (profileID string, lat, lng *float64, err error) {
	const q = `SELECT id, geo_lat, geo_lng FROM connect_profiles WHERE user_id = $1`
	err = s.db.QueryRow(ctx, q, userID).Scan(&profileID, &lat, &lng)
	if err == pgx.ErrNoRows {
		return "", nil, nil, fmt.Errorf("connect: no profile for user")
	}
	return profileID, lat, lng, err
}

// candidateQuery selects visible peers in a mode, excluding the viewer, anyone the
// viewer already liked, existing matches, and — DM-008 / safety invariant 3 — any
// user the viewer has blocked or who has blocked the viewer. Per-mode visibility is
// enforced in SQL: only modes with visible=true surface. verifiedOnly gates on a
// passed L0/L1 verification status. `viewerUserID` is the caller's auth user id
// (connect_blocks keys on user ids, while candidates are matched by profile.user_id).
func (s *Service) candidateQuery(ctx context.Context, viewerProfile, viewerUserID, mode, intent string, verifiedOnly bool, limit int) ([]rawCandidate, error) {
	const q = `
		SELECT p.id, p.display_name, p.city, p.geo_lat, p.geo_lng,
		       COALESCE(v.status IN ('l0_passed','l1_passed'), false) AS verified,
		       pm.intent_tags
		FROM connect_profile_modes pm
		JOIN connect_profiles p ON p.id = pm.profile_id
		LEFT JOIN connect_verification v ON v.user_id = p.user_id
		WHERE pm.mode = $1
		  AND pm.visible = true
		  AND p.id <> $2
		  AND ($3 = '' OR $3 = ANY(pm.intent_tags))
		  AND (NOT $4 OR COALESCE(v.status IN ('l0_passed','l1_passed'), false))
		  AND NOT EXISTS (SELECT 1 FROM connect_likes l
		                  WHERE l.from_profile = $2 AND l.to_profile = p.id)
		  AND NOT EXISTS (SELECT 1 FROM connect_matches m
		                  WHERE (m.profile_a = LEAST($2, p.id) AND m.profile_b = GREATEST($2, p.id)))
		  AND NOT EXISTS (SELECT 1 FROM connect_blocks b
		                  WHERE (b.blocker_id = NULLIF($6,'')::uuid AND b.blocked_id = p.user_id)
		                     OR (b.blocked_id = NULLIF($6,'')::uuid AND b.blocker_id = p.user_id))
		  -- DM-007 / safety invariant 1: minor-in-deck defense-in-depth. Exclude any
		  -- profile whose owner is flagged underage (and not admin-cleared) or whose
		  -- on-profile DOB proves they are under 18. NULL dob is allowed (onboarding
		  -- does not copy dob onto the profile) — the underage-flag queue and the
		  -- fail-closed onboarding age-gate are the primary guards; this is depth.
		  AND NOT EXISTS (SELECT 1 FROM connect_underage_flags uf
		                  WHERE uf.user_id = p.user_id AND uf.status <> 'cleared')
		  AND (p.dob IS NULL OR p.dob <= (CURRENT_DATE - INTERVAL '18 years'))
		  -- TS-009 / invariant 6: suspended/banned users disappear from discovery.
		  AND NOT EXISTS (SELECT 1 FROM connect_account_restrictions r
		                  WHERE r.user_id = p.user_id AND r.active
		                    AND (r.expires_at IS NULL OR r.expires_at > now()))
		ORDER BY p.updated_at DESC
		LIMIT $5`
	rows, err := s.db.Query(ctx, q, mode, viewerProfile, intent, verifiedOnly, limit, viewerUserID)
	if err != nil {
		return nil, fmt.Errorf("connect: candidate query: %w", err)
	}
	defer rows.Close()
	return scanCandidates(rows)
}

func scanCandidates(rows pgx.Rows) ([]rawCandidate, error) {
	var out []rawCandidate
	for rows.Next() {
		var rc rawCandidate
		if err := rows.Scan(&rc.profileID, &rc.displayName, &rc.city, &rc.geoLat, &rc.geoLng, &rc.verified, &rc.intentTags); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// Discovery returns the curated daily set for a mode with match-reason cards,
// honouring the anti-fatigue daily limit from connect_config.
func (s *Service) Discovery(ctx context.Context, userID, mode string) (*DiscoveryResponse, error) {
	if mode == "" {
		mode = "dating"
	}
	viewerProfile, vlat, vlng, err := s.viewer(ctx, userID)
	if err != nil {
		return nil, err
	}

	dailyLimit := s.cfg.intVal(ctx, "discovery.daily_match_limit", 20)
	buckets := s.cfg.distanceBuckets(ctx)
	weights := s.cfg.reasonWeights(ctx)
	viewerIntents, _ := s.viewerIntents(ctx, viewerProfile, mode)

	// Pull a slightly larger pool so ranking has room, then cap to dailyLimit.
	raws, err := s.candidateQuery(ctx, viewerProfile, userID, mode, "", false, dailyLimit*3)
	if err != nil {
		return nil, err
	}

	scored := make([]Candidate, 0, len(raws))
	for _, rc := range raws {
		cand := s.toCandidate(rc, vlat, vlng, buckets)
		cand.MatchReason = buildReason(rc, viewerIntents, weights, cand.DistanceLabel)
		scored = append(scored, cand)
	}
	// Rank by reason score desc (curation), then cap to the anti-fatigue limit.
	sort.SliceStable(scored, func(i, j int) bool {
		si, sj := 0.0, 0.0
		if scored[i].MatchReason != nil {
			si = scored[i].MatchReason.Score
		}
		if scored[j].MatchReason != nil {
			sj = scored[j].MatchReason.Score
		}
		return si > sj
	})
	if len(scored) > dailyLimit {
		scored = scored[:dailyLimit]
	}

	return &DiscoveryResponse{Mode: mode, DailyLimit: dailyLimit, Candidates: scored}, nil
}

// Search runs the privacy-preserving filtered search (verified-only, intent,
// bucketed distance). No match-reason card; distance is always bucketed.
func (s *Service) Search(ctx context.Context, userID string, f SearchFilters) ([]Candidate, error) {
	mode := f.Mode
	if mode == "" {
		mode = "dating"
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 50
	}
	viewerProfile, vlat, vlng, err := s.viewer(ctx, userID)
	if err != nil {
		return nil, err
	}
	buckets := s.cfg.distanceBuckets(ctx)
	maxDist := snapMaxDistance(f.MaxDistKm, buckets)

	raws, err := s.candidateQuery(ctx, viewerProfile, userID, mode, strings.TrimSpace(f.Intent), f.VerifiedOnly, f.Limit*3)
	if err != nil {
		return nil, err
	}

	out := make([]Candidate, 0, len(raws))
	for _, rc := range raws {
		cand := s.toCandidate(rc, vlat, vlng, buckets)
		// Distance filter: only drop a candidate if BOTH viewer and candidate have
		// geo and the bucketed distance exceeds the requested (snapped) cap.
		if f.MaxDistKm > 0 && vlat != nil && vlng != nil && rc.geoLat != nil && rc.geoLng != nil {
			d := haversineKm(*vlat, *vlng, *rc.geoLat, *rc.geoLng)
			if d > float64(maxDist) {
				continue
			}
		}
		out = append(out, cand)
		if len(out) >= f.Limit {
			break
		}
	}
	return out, nil
}

// toCandidate builds the wire candidate, bucketing distance for privacy.
func (s *Service) toCandidate(rc rawCandidate, vlat, vlng *float64, buckets []int) Candidate {
	c := Candidate{
		ProfileID:   rc.profileID,
		DisplayName: rc.displayName,
		City:        rc.city,
		Verified:    rc.verified,
		IntentTags:  rc.intentTags,
	}
	if c.IntentTags == nil {
		c.IntentTags = []string{}
	}
	if vlat != nil && vlng != nil && rc.geoLat != nil && rc.geoLng != nil {
		d := haversineKm(*vlat, *vlng, *rc.geoLat, *rc.geoLng)
		bucket, within := bucketKm(d, buckets)
		c.DistanceLabel = distanceLabel(bucket, within)
	}
	return c
}

func (s *Service) viewerIntents(ctx context.Context, viewerProfile, mode string) ([]string, error) {
	const q = `SELECT intent_tags FROM connect_profile_modes WHERE profile_id = $1 AND mode = $2`
	var tags []string
	if err := s.db.QueryRow(ctx, q, viewerProfile, mode).Scan(&tags); err != nil {
		return nil, err
	}
	return tags, nil
}

// buildReason composes a match-reason card from shared intent, verification and
// distance, scored by the backend-owned weights.
func buildReason(rc rawCandidate, viewerIntents []string, weights map[string]float64, distLabel string) *MatchReason {
	var factors []string
	score := 0.0

	shared := intersect(viewerIntents, rc.intentTags)
	if len(shared) > 0 {
		factors = append(factors, "shared intent: "+strings.Join(shared, ", "))
		score += weights["shared_intent"]
	}
	if rc.verified {
		factors = append(factors, "verified profile")
		score += weights["verification"]
	}
	if distLabel != "" {
		factors = append(factors, distLabel)
		if strings.HasPrefix(distLabel, "within") {
			score += weights["distance"]
		}
	}

	headline := "Suggested for you"
	if len(shared) > 0 {
		headline = "You both like " + shared[0]
	} else if rc.verified {
		headline = "A verified match nearby"
	}
	return &MatchReason{Headline: headline, Factors: factors, Score: score}
}

func intersect(a, b []string) []string {
	set := make(map[string]bool, len(a))
	for _, x := range a {
		set[x] = true
	}
	var out []string
	for _, y := range b {
		if set[y] {
			out = append(out, y)
		}
	}
	return out
}
