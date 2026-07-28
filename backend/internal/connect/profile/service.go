package connectprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BadgeChecker is the (additive) verification surface the profile service depends
// on to surface the verified badge. Satisfied by connectverification.StatusService.
type BadgeChecker interface {
	HasBadge(ctx context.Context, userID string) (bool, error)
}

// Service manages identity profiles and per-mode visibility. All cross-user reads
// honour per-mode visibility server-side.
type Service struct {
	db     *pgxpool.Pool
	badges BadgeChecker
}

// NewService builds the profile service. badges may be nil (badge defaults false).
func NewService(db *pgxpool.Pool, badges BadgeChecker) *Service {
	return &Service{db: db, badges: badges}
}

const profileSelect = `id, user_id, display_name, bio, city, dob, geo_lat, geo_lng, created_at, updated_at`

func (s *Service) scanProfile(row pgx.Row) (*Profile, error) {
	var p Profile
	if err := row.Scan(&p.ID, &p.UserID, &p.DisplayName, &p.Bio, &p.City, &p.dob, &p.geoLat, &p.geoLng, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetOrCreate returns the caller's profile, creating an empty one on first access.
// The verified badge is surfaced from the verification service.
func (s *Service) GetOrCreate(ctx context.Context, userID string) (*Profile, error) {
	p, err := s.getByUser(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		const ins = `INSERT INTO connect_profiles (user_id) VALUES ($1)
			ON CONFLICT (user_id) DO NOTHING RETURNING ` + profileSelect
		p, err = s.scanProfile(s.db.QueryRow(ctx, ins, userID))
		if errors.Is(err, pgx.ErrNoRows) { // lost the race; read it back
			p, err = s.getByUser(ctx, userID)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get/create profile: %w", err)
	}
	s.attachBadge(ctx, p)
	return p, nil
}

func (s *Service) getByUser(ctx context.Context, userID string) (*Profile, error) {
	const q = `SELECT ` + profileSelect + ` FROM connect_profiles WHERE user_id = $1`
	return s.scanProfile(s.db.QueryRow(ctx, q, userID))
}

func (s *Service) attachBadge(ctx context.Context, p *Profile) {
	if s.badges == nil || p == nil {
		return
	}
	if ok, err := s.badges.HasBadge(ctx, p.UserID); err == nil {
		p.Badge = ok
	}
}

// Update patches the caller's profile (creating it first if needed). Object-level
// authz is implicit: the row is keyed by the authenticated user_id.
func (s *Service) Update(ctx context.Context, userID string, in UpsertProfileInput) (*Profile, error) {
	if _, err := s.GetOrCreate(ctx, userID); err != nil {
		return nil, err
	}
	const upd = `UPDATE connect_profiles SET
		display_name = COALESCE($2, display_name),
		bio          = COALESCE($3, bio),
		city         = COALESCE($4, city),
		geo_lat      = COALESCE($5, geo_lat),
		geo_lng      = COALESCE($6, geo_lng)
		WHERE user_id = $1
		RETURNING ` + profileSelect
	p, err := s.scanProfile(s.db.QueryRow(ctx, upd, userID, in.DisplayName, in.Bio, in.City, in.GeoLat, in.GeoLng))
	if err != nil {
		return nil, fmt.Errorf("connect: update profile: %w", err)
	}
	s.attachBadge(ctx, p)
	return p, nil
}

// GetModes returns all per-mode visibility records for the caller's profile.
func (s *Service) GetModes(ctx context.Context, userID string) ([]Mode, error) {
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `SELECT mode, visible, intent_tags, privacy, updated_at
		FROM connect_profile_modes WHERE profile_id = $1 ORDER BY mode`
	rows, err := s.db.Query(ctx, q, p.ID)
	if err != nil {
		return nil, fmt.Errorf("connect: list modes: %w", err)
	}
	defer rows.Close()
	var out []Mode
	for rows.Next() {
		m, err := scanMode(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func scanMode(row pgx.Row) (Mode, error) {
	var m Mode
	var privacy []byte
	if err := row.Scan(&m.Mode, &m.Visible, &m.IntentTags, &privacy, &m.UpdatedAt); err != nil {
		return Mode{}, err
	}
	if len(privacy) > 0 {
		_ = json.Unmarshal(privacy, &m.Privacy)
	}
	return m, nil
}

// UpsertMode sets per-mode visibility/intent/privacy for the caller. Each mode is
// independent (UNIQUE(profile_id,mode)); changing one never affects another.
func (s *Service) UpsertMode(ctx context.Context, userID, mode string, in UpsertModeInput) (*Mode, error) {
	if !ValidMode(mode) {
		return nil, fmt.Errorf("connect: invalid mode %q", mode)
	}
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return nil, err
	}

	visible := false
	if in.Visible != nil {
		visible = *in.Visible
	}
	tags := in.IntentTags
	if tags == nil {
		tags = []string{}
	}
	privacy := in.Privacy
	if privacy == nil {
		privacy = map[string]any{"location": "approximate"}
	}
	privacyJSON, err := json.Marshal(privacy)
	if err != nil {
		return nil, fmt.Errorf("connect: encode privacy: %w", err)
	}

	const up = `INSERT INTO connect_profile_modes (profile_id, mode, visible, intent_tags, privacy)
		VALUES ($1,$2,$3,$4,$5::jsonb)
		ON CONFLICT (profile_id, mode) DO UPDATE SET
			visible     = COALESCE($6, connect_profile_modes.visible),
			intent_tags = CASE WHEN $7 THEN EXCLUDED.intent_tags ELSE connect_profile_modes.intent_tags END,
			privacy     = CASE WHEN $8 THEN EXCLUDED.privacy ELSE connect_profile_modes.privacy END
		RETURNING mode, visible, intent_tags, privacy, updated_at`

	var visibleArg any
	if in.Visible != nil {
		visibleArg = visible
	}
	m, err := scanMode(s.db.QueryRow(ctx, up,
		p.ID, mode, visible, tags, string(privacyJSON),
		visibleArg, in.IntentTags != nil, in.Privacy != nil,
	))
	if err != nil {
		return nil, fmt.Errorf("connect: upsert mode: %w", err)
	}
	return &m, nil
}

// AddMedia records an uploaded media item as moderation_status='pending' (not
// public until a moderation worker approves it — invariant 9).
func (s *Service) AddMedia(ctx context.Context, userID, url, kind string) (string, string, error) {
	if url == "" {
		return "", "", errors.New("connect: media url required")
	}
	if kind == "" {
		kind = "photo"
	}
	if kind != "photo" && kind != "clip" {
		return "", "", fmt.Errorf("connect: invalid media kind %q", kind)
	}
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return "", "", err
	}
	const ins = `INSERT INTO connect_profile_media (profile_id, url, kind)
		VALUES ($1,$2,$3) RETURNING id, moderation_status`
	var id, status string
	if err := s.db.QueryRow(ctx, ins, p.ID, url, kind).Scan(&id, &status); err != nil {
		return "", "", fmt.Errorf("connect: add media: %w", err)
	}
	return id, status, nil
}
