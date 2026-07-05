package connectdiscovery

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// ProfileCard is the mobile-aligned, camelCase discovery card. It NEVER carries
// raw coordinates — only a bucketed distance label / bucket (privacy invariant 3).
// It is derived from the same internal Candidate the Phase-1 discovery/search
// endpoints build, so ranking and privacy rules are shared, not re-implemented.
type ProfileCard struct {
	ProfileID     string   `json:"profileId"`
	DisplayName   *string  `json:"displayName,omitempty"`
	City          *string  `json:"city,omitempty"`
	Verified      bool     `json:"verified"`
	IntentTags    []string `json:"intentTags"`
	DistanceLabel string   `json:"distanceLabel,omitempty"` // e.g. "within 25 km"
	DistanceBucket int     `json:"distanceBucket,omitempty"` // coarse km bucket (nearby only)
}

// SwipeResult is the minimal shape Swipe needs back from the like recorder — the
// mutual-match outcome. It matches the fields of connectmatching.LikeResult so the
// route wiring can adapt the matching service without a cross-package import here.
type SwipeResult struct {
	Matched bool
	MatchID string
}

// LikeRecorder is the seam onto the existing mutual-match transaction
// (connectmatching.Service.Like). Swipe delegates like/superlike to it so the
// idempotent mutual-match creation lives in ONE place and is not re-implemented.
type LikeRecorder interface {
	Like(ctx context.Context, fromUserID, toProfileID, kind string) (SwipeResult, error)
}

// Swipe directions accepted by POST /discovery/swipe.
const (
	DirectionLike  = "like"
	DirectionPass  = "pass"
	DirectionSuper = "superlike"
)

// Sentinel errors for the member discovery surface.
var (
	ErrNoProfile      = errors.New("connect: no profile for user")
	ErrSelfSwipe      = errors.New("connect: cannot swipe your own profile")
	ErrInvalidSwipe   = errors.New("connect: direction must be like, pass or superlike")
	ErrTargetNotFound = errors.New("connect: target profile not found")
	ErrNothingToUndo  = errors.New("connect: no recent swipe to undo")
)

// cardFrom maps the internal Candidate to the camelCase mobile card. It copies only
// the already-privacy-safe fields (never lat/lng). The match-reason card is internal
// and intentionally dropped from the stack contract.
func cardFrom(c Candidate) ProfileCard {
	tags := c.IntentTags
	if tags == nil {
		tags = []string{}
	}
	return ProfileCard{
		ProfileID:     c.ProfileID,
		DisplayName:   c.DisplayName,
		City:          c.City,
		Verified:      c.Verified,
		IntentTags:    tags,
		DistanceLabel: c.DistanceLabel,
	}
}

// StackFilters mirrors SearchFilters but is the member-facing swipe-stack query.
type StackFilters struct {
	Mode         string
	VerifiedOnly bool
	Intent       string
	MaxDistKm    int
	Limit        int
}

// Stack returns the swipe deck: ranked ProfileCards that the caller has not yet
// swiped (like/super/pass) and that are not the caller. It reuses the exact
// candidateQuery used by curated Discovery — which already excludes self, prior
// likes and existing matches — and layers the additional pass-exclusion on top so
// passed profiles never resurface. Ranking reuses the shared reason weights.
func (s *Service) Stack(ctx context.Context, userID string, f StackFilters) ([]ProfileCard, error) {
	mode := f.Mode
	if mode == "" {
		mode = "dating"
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}
	viewerProfile, vlat, vlng, err := s.viewer(ctx, userID)
	if err != nil {
		return nil, ErrNoProfile
	}
	buckets := s.cfg.distanceBuckets(ctx)
	maxDist := snapMaxDistance(f.MaxDistKm, buckets)

	// Reuse the shared candidate query (self / prior-like / existing-match excluded
	// in SQL). Pull a larger pool so pass-filtering + ranking have room.
	raws, err := s.candidateQuery(ctx, viewerProfile, mode, f.Intent, f.VerifiedOnly, f.Limit*3)
	if err != nil {
		return nil, err
	}

	// Exclude anyone the caller already PASSED on (passes live outside connect_likes
	// because the likes.kind CHECK is like/super only — see connect_passes migration).
	passed, err := s.passedTargets(ctx, viewerProfile)
	if err != nil {
		return nil, err
	}

	out := make([]ProfileCard, 0, len(raws))
	for _, rc := range raws {
		if passed[rc.profileID] {
			continue
		}
		cand := s.toCandidate(rc, vlat, vlng, buckets)
		// Distance cap (bucketed): only drop when both sides have geo.
		if f.MaxDistKm > 0 && vlat != nil && vlng != nil && rc.geoLat != nil && rc.geoLng != nil {
			if haversineKm(*vlat, *vlng, *rc.geoLat, *rc.geoLng) > float64(maxDist) {
				continue
			}
		}
		out = append(out, cardFrom(cand))
		if len(out) >= f.Limit {
			break
		}
	}
	return out, nil
}

// passedTargets returns the set of profile ids the viewer has passed on. Reads the
// connect_passes table (owned by the discovery migration). A missing table would
// surface as a query error, keeping the stack fail-closed rather than leaking
// already-passed profiles.
func (s *Service) passedTargets(ctx context.Context, viewerProfile string) (map[string]bool, error) {
	const q = `SELECT to_profile FROM connect_passes WHERE from_profile = $1`
	rows, err := s.db.Query(ctx, q, viewerProfile)
	if err != nil {
		return nil, fmt.Errorf("connect: passed targets: %w", err)
	}
	defer rows.Close()
	set := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		set[id] = true
	}
	return set, rows.Err()
}

// LikesYou is the REVERSE-likes query: profiles who liked the caller but whom the
// caller has NOT yet swiped (neither liked/super nor passed). These are the
// pending inbound likes the caller can convert into a match by liking back.
func (s *Service) LikesYou(ctx context.Context, userID string, limit int) ([]ProfileCard, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	viewerProfile, vlat, vlng, err := s.viewer(ctx, userID)
	if err != nil {
		return nil, ErrNoProfile
	}
	buckets := s.cfg.distanceBuckets(ctx)

	// Inbound likers (l.to_profile = me) minus anyone I already liked (would be a
	// match, surfaced under /matches) or passed. Never expose raw geo.
	const q = `
		SELECT p.id, p.display_name, p.city, p.geo_lat, p.geo_lng,
		       COALESCE(v.status IN ('l0_passed','l1_passed'), false) AS verified,
		       pm.intent_tags
		FROM connect_likes l
		JOIN connect_profiles p ON p.id = l.from_profile
		LEFT JOIN connect_profile_modes pm ON pm.profile_id = p.id AND pm.mode = 'dating'
		LEFT JOIN connect_verification v ON v.user_id = p.user_id
		WHERE l.to_profile = $1
		  AND NOT EXISTS (SELECT 1 FROM connect_likes me
		                  WHERE me.from_profile = $1 AND me.to_profile = p.id)
		  AND NOT EXISTS (SELECT 1 FROM connect_passes ps
		                  WHERE ps.from_profile = $1 AND ps.to_profile = p.id)
		ORDER BY l.created_at DESC
		LIMIT $2`
	rows, err := s.db.Query(ctx, q, viewerProfile, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: likes-you: %w", err)
	}
	defer rows.Close()

	out := make([]ProfileCard, 0)
	for rows.Next() {
		var rc rawCandidate
		if err := rows.Scan(&rc.profileID, &rc.displayName, &rc.city, &rc.geoLat, &rc.geoLng, &rc.verified, &rc.intentTags); err != nil {
			return nil, err
		}
		out = append(out, cardFrom(s.toCandidate(rc, vlat, vlng, buckets)))
	}
	return out, rows.Err()
}

// Nearby returns a bucketed-distance list ONLY — no raw coordinates ever leave the
// service. It reuses the same haversine + bucket logic as discovery/search and
// exposes the coarse bucket integer (not the precise distance) as distanceBucket.
// Candidates without geo, or beyond the largest bucket, are dropped.
func (s *Service) Nearby(ctx context.Context, userID string, limit int) ([]ProfileCard, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	viewerProfile, vlat, vlng, err := s.viewer(ctx, userID)
	if err != nil {
		return nil, ErrNoProfile
	}
	if vlat == nil || vlng == nil {
		// No viewer geo → nothing to rank by distance. Empty, not an error.
		return []ProfileCard{}, nil
	}
	buckets := s.cfg.distanceBuckets(ctx)
	raws, err := s.candidateQuery(ctx, viewerProfile, "dating", "", false, limit*3)
	if err != nil {
		return nil, err
	}

	type withDist struct {
		card ProfileCard
		km   float64
	}
	tmp := make([]withDist, 0, len(raws))
	for _, rc := range raws {
		if rc.geoLat == nil || rc.geoLng == nil {
			continue // no geo → cannot place on the nearby list
		}
		d := haversineKm(*vlat, *vlng, *rc.geoLat, *rc.geoLng)
		bucket, within := bucketKm(d, buckets)
		if !within {
			continue // beyond the largest bucket → not "nearby"
		}
		card := cardFrom(s.toCandidate(rc, vlat, vlng, buckets))
		card.DistanceBucket = bucket
		tmp = append(tmp, withDist{card: card, km: d})
	}
	// Ascending by true distance so the closest surface first, but ONLY the coarse
	// bucket is ever serialised (privacy: exact km stays server-side).
	sort.SliceStable(tmp, func(i, j int) bool { return tmp[i].km < tmp[j].km })
	out := make([]ProfileCard, 0, len(tmp))
	for _, wd := range tmp {
		out = append(out, wd.card)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// Swipe records a directional swipe (like | superlike | pass) from the caller onto
// a target profile. like/superlike reuse the shared matching.Like transaction (via
// the injected LikeRecorder) so the mutual-match creation stays in ONE place and
// stays idempotent. pass is recorded idempotently in connect_passes so the target
// is excluded from future stacks and can be undone by rewind.
func (s *Service) Swipe(ctx context.Context, userID, targetID, direction string, liker LikeRecorder) (matched bool, matchID string, err error) {
	viewerProfile, _, _, verr := s.resolveViewer(ctx, userID)
	if verr != nil {
		return false, "", ErrNoProfile
	}
	if targetID == "" {
		return false, "", ErrTargetNotFound
	}
	if targetID == viewerProfile {
		return false, "", ErrSelfSwipe
	}

	switch direction {
	case DirectionLike, DirectionSuper:
		kind := "like"
		if direction == DirectionSuper {
			kind = "super"
		}
		res, lerr := liker.Like(ctx, userID, targetID, kind)
		if lerr != nil {
			return false, "", lerr
		}
		// A like supersedes any prior pass on the same target so the two swipe
		// records can never disagree. Idempotent (DELETE of an absent row is a no-op).
		if s.db != nil {
			_ = s.deletePass(ctx, viewerProfile, targetID)
		}
		return res.Matched, res.MatchID, nil
	case DirectionPass:
		if err := s.recordPass(ctx, viewerProfile, targetID); err != nil {
			return false, "", err
		}
		return false, "", nil
	default:
		return false, "", ErrInvalidSwipe
	}
}

// recordPass idempotently inserts a pass. ON CONFLICT DO NOTHING mirrors the
// like path so a double-submit is a safe no-op.
func (s *Service) recordPass(ctx context.Context, fromProfile, toProfile string) error {
	// Guard against passing a non-existent target (keeps the pass table clean and
	// matches the like path's existence check).
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM connect_profiles WHERE id = $1)`, toProfile).Scan(&exists); err != nil {
		return fmt.Errorf("connect: pass target check: %w", err)
	}
	if !exists {
		return ErrTargetNotFound
	}
	const q = `INSERT INTO connect_passes (from_profile, to_profile)
		VALUES ($1,$2)
		ON CONFLICT (from_profile, to_profile) DO NOTHING`
	if _, err := s.db.Exec(ctx, q, fromProfile, toProfile); err != nil {
		return fmt.Errorf("connect: record pass: %w", err)
	}
	return nil
}

func (s *Service) deletePass(ctx context.Context, fromProfile, toProfile string) error {
	_, err := s.db.Exec(ctx,
		`DELETE FROM connect_passes WHERE from_profile = $1 AND to_profile = $2`, fromProfile, toProfile)
	return err
}

// Rewind undoes the caller's single most-recent swipe (premium action). It finds
// the newest swipe across both the like and pass tables, voids it, and — if a like
// had created a mutual match — voids that match too, all inside one transaction so
// a partially-undone state is impossible. Idempotent-safe: if there is nothing to
// undo it returns ErrNothingToUndo without side effects.
//
// PREMIUM: gating (entitlement / boost tier) is intentionally left to the caller;
// this method performs the undo unconditionally so it stays reusable.
func (s *Service) Rewind(ctx context.Context, userID string) (undone string, err error) {
	viewerProfile, _, _, verr := s.viewer(ctx, userID)
	if verr != nil {
		return "", ErrNoProfile
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("connect: begin rewind tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Newest like for this viewer.
	var likeTarget string
	var likeAt time.Time
	likeFound := true
	if err := tx.QueryRow(ctx,
		`SELECT to_profile, created_at FROM connect_likes
		 WHERE from_profile = $1 ORDER BY created_at DESC LIMIT 1`,
		viewerProfile).Scan(&likeTarget, &likeAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			likeFound = false
		} else {
			return "", fmt.Errorf("connect: rewind read like: %w", err)
		}
	}

	// Newest pass for this viewer.
	var passTarget string
	var passAt time.Time
	passFound := true
	if err := tx.QueryRow(ctx,
		`SELECT to_profile, created_at FROM connect_passes
		 WHERE from_profile = $1 ORDER BY created_at DESC LIMIT 1`,
		viewerProfile).Scan(&passTarget, &passAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			passFound = false
		} else {
			return "", fmt.Errorf("connect: rewind read pass: %w", err)
		}
	}

	if !likeFound && !passFound {
		return "", ErrNothingToUndo
	}

	// Choose the more recent of the two swipes.
	undoLike := likeFound && (!passFound || !passAt.After(likeAt))
	if undoLike {
		// If this like created a mutual match, void the match first.
		a, b := orderPairLocal(viewerProfile, likeTarget)
		if _, err := tx.Exec(ctx,
			`DELETE FROM connect_matches WHERE profile_a = $1 AND profile_b = $2`, a, b); err != nil {
			return "", fmt.Errorf("connect: rewind void match: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM connect_likes WHERE from_profile = $1 AND to_profile = $2`,
			viewerProfile, likeTarget); err != nil {
			return "", fmt.Errorf("connect: rewind void like: %w", err)
		}
		undone = likeTarget
	} else {
		if _, err := tx.Exec(ctx,
			`DELETE FROM connect_passes WHERE from_profile = $1 AND to_profile = $2`,
			viewerProfile, passTarget); err != nil {
			return "", fmt.Errorf("connect: rewind void pass: %w", err)
		}
		undone = passTarget
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("connect: commit rewind: %w", err)
	}
	return undone, nil
}

// orderPairLocal mirrors matching.orderPair (canonical a<b) so the match-void query
// hits the same UNIQUE(profile_a, profile_b) row the matcher created. Kept local to
// avoid a cross-package dependency on an unexported helper.
func orderPairLocal(x, y string) (string, string) {
	if x < y {
		return x, y
	}
	return y, x
}
