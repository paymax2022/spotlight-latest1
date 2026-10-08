package connectprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/platform/r2"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	strAuthenticationRequired = "authentication required"
	keyData                   = "data"
)

// BadgeChecker is the (additive) verification surface the profile service depends
// on to surface the verified badge. Satisfied by connectverification.StatusService.
type BadgeChecker interface {
	HasBadge(ctx context.Context, userID string) (bool, error)
}

// Service manages identity profiles and per-mode visibility. All cross-user reads
// honour per-mode visibility server-side.
type Service struct {
	db        *pgxpool.Pool
	badges    BadgeChecker
	presigner *r2.Presigner
}

// NewService builds the profile service. badges may be nil (badge defaults false).
func NewService(db *pgxpool.Pool, badges BadgeChecker) *Service {
	return &Service{db: db, badges: badges}
}

const profileSelect = `id, user_id, display_name, bio, city, dob, geo_lat, geo_lng, gender, headline, interests, preferences, created_at, updated_at`

func (s *Service) scanProfile(row pgx.Row) (*Profile, error) {
	var p Profile
	var prefs []byte
	if err := row.Scan(&p.ID, &p.UserID, &p.DisplayName, &p.Bio, &p.City, &p.dob, &p.geoLat, &p.geoLng,
		&p.Gender, &p.Headline, &p.Interests, &prefs, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.Preferences = map[string]any{}
	if len(prefs) > 0 {
		_ = json.Unmarshal(prefs, &p.Preferences)
	}
	if p.Interests == nil {
		p.Interests = []string{}
	}
	if p.dob != nil {
		age := ageOn(*p.dob, time.Now().UTC())
		p.Age = &age
	}
	return &p, nil
}

// ageOn returns the full years between dob and now. Only the derived age ever
// leaves the server — never the date of birth itself.
func ageOn(dob, now time.Time) int {
	years := now.Year() - dob.Year()
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		years--
	}
	return years
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
		geo_lng      = COALESCE($6, geo_lng),
		gender       = COALESCE($7, gender),
		headline     = COALESCE($8, headline),
		interests    = COALESCE($9, interests),
		preferences  = COALESCE($10::jsonb, preferences)
		WHERE user_id = $1
		RETURNING ` + profileSelect
	var prefsArg any
	if in.Preferences != nil {
		b, err := json.Marshal(in.Preferences)
		if err != nil {
			return nil, fmt.Errorf("connect: encode preferences: %w", err)
		}
		prefsArg = string(b)
	}
	p, err := s.scanProfile(s.db.QueryRow(ctx, upd, userID, in.DisplayName, in.Bio, in.City, in.GeoLat, in.GeoLng,
		in.Gender, in.Headline, in.Interests, prefsArg))
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

// MaxPhotos is the most photos a profile may carry.
const MaxPhotos = 9

// ErrTooManyPhotos is returned when a profile is already at MaxPhotos.
var ErrTooManyPhotos = errors.New("connect: photo limit reached")

// AddMedia records an uploaded media item as moderation_status='pending' (not
// public until a moderation worker approves it — invariant 9). `ref` is either
// an https URL or an R2 object key minted by PresignMedia; a key must live under
// the caller's own prefix so one member can never attach another's upload.
func (s *Service) AddMedia(ctx context.Context, userID, ref, kind string) (string, string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", "", errors.New("connect: media url required")
	}
	if kind == "" {
		kind = "photo"
	}
	if kind != "photo" && kind != "clip" {
		return "", "", fmt.Errorf("connect: invalid media kind %q", kind)
	}
	if !strings.Contains(ref, "://") && !strings.HasPrefix(ref, mediaKeyPrefix(userID)) {
		return "", "", errors.New("connect: invalid media reference")
	}
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return "", "", err
	}
	if kind == "photo" {
		var n int
		if err := s.db.QueryRow(ctx,
			`SELECT count(*) FROM connect_profile_media WHERE profile_id = $1 AND kind = 'photo'`, p.ID).Scan(&n); err != nil {
			return "", "", fmt.Errorf("connect: count media: %w", err)
		}
		if n >= MaxPhotos {
			return "", "", ErrTooManyPhotos
		}
	}
	const ins = `INSERT INTO connect_profile_media (profile_id, url, kind, sort_order)
		VALUES ($1,$2,$3, COALESCE((SELECT max(sort_order) + 1 FROM connect_profile_media WHERE profile_id = $1), 0))
		RETURNING id, moderation_status`
	var id, status string
	if err := s.db.QueryRow(ctx, ins, p.ID, ref, kind).Scan(&id, &status); err != nil {
		return "", "", fmt.Errorf("connect: add media: %w", err)
	}
	return id, status, nil
}

// Valid profile modes — MUST match the connect_profile_modes.mode CHECK constraint.
var validModes = map[string]bool{
	"dating": true, "friendship": true, "professional": true, "creator": true, "event": true,
}

// ValidMode reports whether m is a known profile mode.
func ValidMode(m string) bool { return validModes[m] }

// Profile is the identity-level record. dob is NEVER serialised to peers; it is
// only used for the age gate. The omitted json tag keeps it off the wire entirely.
type Profile struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	DisplayName *string        `json:"display_name,omitempty"`
	Bio         *string        `json:"bio,omitempty"`
	City        *string        `json:"city,omitempty"`
	Gender      *string        `json:"gender,omitempty"`
	Headline    *string        `json:"headline,omitempty"`
	Interests   []string       `json:"interests"`
	Preferences map[string]any `json:"preferences"`
	Age         *int           `json:"age,omitempty"`
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
	Gender      *string  `json:"gender"`
	Headline    *string  `json:"headline"`
	Interests   []string `json:"interests"` // nil = leave unchanged; [] = clear
	// Preferences REPLACES the stored object when present (nil = leave unchanged).
	Preferences map[string]any `json:"preferences"`
}

// UpsertModeInput is the body for PATCH /profile/modes/:mode.
type UpsertModeInput struct {
	Visible    *bool          `json:"visible"`
	IntentTags []string       `json:"intent_tags"`
	Privacy    map[string]any `json:"privacy"`
}

// Handler exposes the Phase-1 profile + per-mode visibility endpoints.
type Handler struct{ svc *Service }

// NewHandler builds the profile HTTP handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Get — GET /api/v1/connect/profile (authenticated member).
func (h *Handler) Get(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	p, err := h.svc.GetOrCreate(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: p})
}

// Update — PATCH /api/v1/connect/profile (authenticated member).
func (h *Handler) Update(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	var in UpsertProfileInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.Update(c.Request.Context(), uid, in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: p})
}

// GetModes — GET /api/v1/connect/profile/modes (authenticated member).
func (h *Handler) GetModes(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	modes, err := h.svc.GetModes(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load modes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: modes})
}

// UpsertMode — PATCH /api/v1/connect/profile/modes/:mode (authenticated member).
func (h *Handler) UpsertMode(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	mode := c.Param("mode")
	if !ValidMode(mode) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mode"})
		return
	}
	var in UpsertModeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	m, err := h.svc.UpsertMode(c.Request.Context(), uid, mode, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: m})
}

type mediaRequest struct {
	URL  string `json:"url" binding:"required"`
	Kind string `json:"kind"`
}

// AddMedia — POST /api/v1/connect/profile/media (authenticated member).
// Returns moderation_status=pending; media is NOT public until moderated.
func (h *Handler) AddMedia(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	var req mediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	id, status, err := h.svc.AddMedia(c.Request.Context(), uid, req.URL, req.Kind)
	if errors.Is(err, ErrTooManyPhotos) {
		c.JSON(http.StatusConflict, gin.H{"error": "You can add up to 9 photos. Remove one to add another."})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{keyData: gin.H{"id": id, "moderation_status": status}})
}
