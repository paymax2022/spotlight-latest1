package marketplace

// cms.go implements MKT-007 — the admin CMS backend for home banners
// (ADM-003) and per-category landing/SEO content (ADM-004). Mirrors the
// existing admin pricing/moderation conventions (admin_handler.go,
// repository.go, audit.go): every mutation requires reason_code and writes
// an mkt_admin_audit_log row via Service.writeAudit.
//
// Kept in its own file (rather than folded into admin_handler.go/
// repository.go/service.go) to stay a scoped, additive diff — sibling agents
// own the rest of those files (service_boost.go, search/, taxonomy,
// analytics, fraud, users, appeals).

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// ─── Models ────────────────────────────────────────────────────────────────

// BannerSlot/BannerCtaType/bannerPersistedStatus mirror frontend-admin's
// MktBannerSlot/MktBannerCtaType (types/marketplaceAdmin.ts). Only "draft" and
// "archived" are ever written to mkt_banners.status — "scheduled"/"live"/
// "expired" are computed by deriveBannerStatus from start_at/end_at at read
// time, matching the console's Restore (-> draft)/Archive (-> archived)
// actions, which are the only two states the UI ever sets directly.
const (
	bannerStatusDraft     = "draft"
	bannerStatusArchived  = "archived"
	bannerStatusScheduled = "scheduled"
	bannerStatusLive      = "live"
	bannerStatusExpired   = "expired"
)

var validBannerSlots = map[string]bool{"home_hero": true, "home_strip": true, "category_top": true}
var validBannerCtaTypes = map[string]bool{"none": true, "category": true, "search": true, "listing": true, "external": true}

// Banner mirrors frontend-admin's MktBanner field-for-field.
type Banner struct {
	ID        string     `json:"id"`
	Slot      string     `json:"slot"`
	Title     string     `json:"title"`
	Subtitle  string     `json:"subtitle"`
	ImageURL  string     `json:"image_url"`
	CTALabel  string     `json:"cta_label"`
	CTAType   string     `json:"cta_type"`
	CTAValue  string     `json:"cta_value"`
	Status    string     `json:"status"` // derived — see deriveBannerStatus
	StartAt   *time.Time `json:"start_at"`
	EndAt     *time.Time `json:"end_at"`
	SortOrder int        `json:"sort_order"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`

	// persistedStatus is the raw DB column (draft|archived), kept unexported so
	// it never leaks into the JSON response — callers see only the derived
	// Status above.
	persistedStatus string
}

// BannerInput mirrors frontend-admin's MktBannerInput (the create/update
// request body).
type BannerInput struct {
	Slot       string     `json:"slot"`
	Title      string     `json:"title"`
	Subtitle   string     `json:"subtitle"`
	ImageURL   string     `json:"image_url"`
	CTALabel   string     `json:"cta_label"`
	CTAType    string     `json:"cta_type"`
	CTAValue   string     `json:"cta_value"`
	StartAt    *time.Time `json:"start_at"`
	EndAt      *time.Time `json:"end_at"`
	SortOrder  int        `json:"sort_order"`
	ReasonCode string     `json:"reason_code"`
}

func (b BannerInput) validate() error {
	if b.Title == "" {
		return fieldErr(CodeValidation, "title is required", "title")
	}
	if !validBannerSlots[b.Slot] {
		return fieldErr(CodeValidation, "slot must be one of home_hero, home_strip, category_top", "slot")
	}
	ctaType := b.CTAType
	if ctaType == "" {
		ctaType = "none"
	}
	if !validBannerCtaTypes[ctaType] {
		return fieldErr(CodeValidation, "cta_type must be one of none, category, search, listing, external", "cta_type")
	}
	if b.StartAt != nil && b.EndAt != nil && b.EndAt.Before(*b.StartAt) {
		return fieldErr(CodeValidation, "end_at must be after start_at", "end_at")
	}
	return nil
}

// deriveBannerStatus computes the display status from the persisted
// draft/archived column plus the schedule window, at read time.
func deriveBannerStatus(persisted string, startAt, endAt *time.Time, now time.Time) string {
	if persisted == bannerStatusArchived {
		return bannerStatusArchived
	}
	if startAt != nil && now.Before(*startAt) {
		return bannerStatusScheduled
	}
	if endAt != nil && now.After(*endAt) {
		return bannerStatusExpired
	}
	return bannerStatusLive
}

// CategoryContent mirrors frontend-admin's MktCategoryContent.
type CategoryContent struct {
	CategoryID     string     `json:"category_id"`
	CategoryName   string     `json:"category_name"`
	HeroHeading    string     `json:"hero_heading"`
	IntroCopy      string     `json:"intro_copy"`
	SEOTitle       string     `json:"seo_title"`
	SEODescription string     `json:"seo_description"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
	UpdatedBy      *string    `json:"updated_by,omitempty"`
}

// CategoryContentInput mirrors frontend-admin's MktCategoryContentInput.
type CategoryContentInput struct {
	HeroHeading    string `json:"hero_heading"`
	IntroCopy      string `json:"intro_copy"`
	SEOTitle       string `json:"seo_title"`
	SEODescription string `json:"seo_description"`
	ReasonCode     string `json:"reason_code"`
}

// ─── Repository ────────────────────────────────────────────────────────────

const bannerCols = `id, slot, title, subtitle, image_url, cta_label, cta_type, cta_value, status, start_at, end_at, sort_order, created_at, updated_at`

func scanBanner(row pgx.Row) (*Banner, error) {
	var b Banner
	if err := row.Scan(
		&b.ID, &b.Slot, &b.Title, &b.Subtitle, &b.ImageURL, &b.CTALabel, &b.CTAType, &b.CTAValue,
		&b.persistedStatus, &b.StartAt, &b.EndAt, &b.SortOrder, &b.CreatedAt, &b.UpdatedAt,
	); err != nil {
		return nil, err
	}
	b.Status = deriveBannerStatus(b.persistedStatus, b.StartAt, b.EndAt, time.Now())
	return &b, nil
}

// ListBanners returns every banner (any status), newest sort_order first
// within slot — the admin console shows and manages all of them, including
// archived ones (so it can Restore).
func (r *Repository) ListBanners(ctx context.Context) ([]Banner, error) {
	rows, err := r.db.Query(ctx, `SELECT `+bannerCols+` FROM public.mkt_banners ORDER BY slot, sort_order, created_at DESC`)
	if err != nil {
		return nil, wrapInternal("list banners", err)
	}
	defer rows.Close()
	var out []Banner
	for rows.Next() {
		b, serr := scanBanner(rows)
		if serr != nil {
			return nil, wrapInternal("scan banner", serr)
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// GetBanner loads one banner by id.
func (r *Repository) GetBanner(ctx context.Context, id string) (*Banner, error) {
	row := r.db.QueryRow(ctx, `SELECT `+bannerCols+` FROM public.mkt_banners WHERE id=$1`, id)
	b, err := scanBanner(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("banner")
		}
		return nil, wrapInternal("get banner", err)
	}
	return b, nil
}

// CreateBanner inserts a new banner (always starts in 'draft').
func (r *Repository) CreateBanner(ctx context.Context, in BannerInput, createdBy string) (*Banner, error) {
	ctaType := in.CTAType
	if ctaType == "" {
		ctaType = "none"
	}
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_banners
			(slot, title, subtitle, image_url, cta_label, cta_type, cta_value, status, start_at, end_at, sort_order, created_by, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$11)
		RETURNING `+bannerCols,
		in.Slot, in.Title, in.Subtitle, in.ImageURL, in.CTALabel, ctaType, in.CTAValue, in.StartAt, in.EndAt, in.SortOrder, createdBy,
	)
	return scanBanner(row)
}

// UpdateBanner overwrites a banner's content fields (not status — see
// SetBannerStatus). Returns ErrNotFoundCoded("banner") if id doesn't exist.
func (r *Repository) UpdateBanner(ctx context.Context, id string, in BannerInput, updatedBy string) (*Banner, error) {
	ctaType := in.CTAType
	if ctaType == "" {
		ctaType = "none"
	}
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_banners SET
			slot=$1, title=$2, subtitle=$3, image_url=$4, cta_label=$5, cta_type=$6, cta_value=$7,
			start_at=$8, end_at=$9, sort_order=$10, updated_by=$11, updated_at=now()
		WHERE id=$12
		RETURNING `+bannerCols,
		in.Slot, in.Title, in.Subtitle, in.ImageURL, in.CTALabel, ctaType, in.CTAValue, in.StartAt, in.EndAt, in.SortOrder, updatedBy, id,
	)
	b, err := scanBanner(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("banner")
		}
		return nil, wrapInternal("update banner", err)
	}
	return b, nil
}

// SetBannerStatus persists the two admin-settable states: 'draft' (Restore)
// or 'archived' (Archive). Any other value is caller-input validation, not a
// DB concern — the service layer rejects it before this is called.
func (r *Repository) SetBannerStatus(ctx context.Context, id, status, updatedBy string) (*Banner, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_banners SET status=$1, updated_by=$2, updated_at=now()
		WHERE id=$3
		RETURNING `+bannerCols,
		status, updatedBy, id,
	)
	b, err := scanBanner(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("banner")
		}
		return nil, wrapInternal("set banner status", err)
	}
	return b, nil
}

// GetCategoryContent loads the per-category landing/SEO content row, joined
// to the category name. If no content row exists yet, synthesizes a default
// (empty text fields, nil updated_at/by) rather than erroring — the console
// shows an editable-but-empty form on first select, not an error state.
// Returns ErrNotFoundCoded("category") if categoryID itself doesn't exist.
func (r *Repository) GetCategoryContent(ctx context.Context, categoryID string) (*CategoryContent, error) {
	row := r.db.QueryRow(ctx, `
		SELECT c.id, c.name,
		       COALESCE(cc.hero_heading, ''), COALESCE(cc.intro_copy, ''),
		       COALESCE(cc.seo_title, ''), COALESCE(cc.seo_description, ''),
		       cc.updated_at, cc.updated_by
		FROM public.mkt_categories c
		LEFT JOIN public.mkt_category_content cc ON cc.category_id = c.id
		WHERE c.id = $1`, categoryID)
	var cc CategoryContent
	if err := row.Scan(
		&cc.CategoryID, &cc.CategoryName, &cc.HeroHeading, &cc.IntroCopy,
		&cc.SEOTitle, &cc.SEODescription, &cc.UpdatedAt, &cc.UpdatedBy,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("category")
		}
		return nil, wrapInternal("get category content", err)
	}
	return &cc, nil
}

// UpsertCategoryContent creates or overwrites the per-category content row.
// Assumes categoryID has already been validated to exist (the service layer
// calls GetCategory first) — the FK would otherwise reject it anyway.
func (r *Repository) UpsertCategoryContent(ctx context.Context, categoryID string, in CategoryContentInput, updatedBy string) (*CategoryContent, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_category_content (category_id, hero_heading, intro_copy, seo_title, seo_description, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,now())
		ON CONFLICT (category_id) DO UPDATE SET
			hero_heading = EXCLUDED.hero_heading, intro_copy = EXCLUDED.intro_copy,
			seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description,
			updated_by = EXCLUDED.updated_by, updated_at = now()
		RETURNING category_id, hero_heading, intro_copy, seo_title, seo_description, updated_at, updated_by`,
		categoryID, in.HeroHeading, in.IntroCopy, in.SEOTitle, in.SEODescription, updatedBy,
	)
	var cc CategoryContent
	if err := row.Scan(&cc.CategoryID, &cc.HeroHeading, &cc.IntroCopy, &cc.SEOTitle, &cc.SEODescription, &cc.UpdatedAt, &cc.UpdatedBy); err != nil {
		return nil, wrapInternal("upsert category content", err)
	}
	// Category name isn't stored on mkt_category_content (1:1 FK to
	// mkt_categories) — fetch it so the response matches GetCategoryContent's
	// shape. A second cheap point-lookup; not worth a JOIN on a write path.
	cat, err := r.GetCategory(ctx, categoryID)
	if err != nil {
		return nil, err
	}
	cc.CategoryName = cat.Name
	return &cc, nil
}

// ─── Service ───────────────────────────────────────────────────────────────

// ListBanners is a plain read — no audit needed.
func (s *Service) ListBanners(ctx context.Context) ([]Banner, error) {
	return s.repo.ListBanners(ctx)
}

// CreateBanner creates a new home banner (ADM-003). reason_code MANDATORY,
// audited.
func (s *Service) CreateBanner(ctx context.Context, adminID string, in BannerInput) (*Banner, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	b, err := s.repo.CreateBanner(ctx, in, adminID)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.cms.banner.create", TargetType: "banner", TargetID: b.ID, ReasonCode: in.ReasonCode,
		AfterState: map[string]any{"slot": b.Slot, "title": b.Title, "status": b.Status},
	})
	return b, nil
}

// UpdateBanner overwrites a banner's content fields. reason_code MANDATORY,
// audited.
func (s *Service) UpdateBanner(ctx context.Context, adminID, id string, in BannerInput) (*Banner, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	before, err := s.repo.GetBanner(ctx, id)
	if err != nil {
		return nil, err
	}
	after, err := s.repo.UpdateBanner(ctx, id, in, adminID)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.cms.banner.update", TargetType: "banner", TargetID: id, ReasonCode: in.ReasonCode,
		BeforeState: map[string]any{"title": before.Title, "slot": before.Slot, "image_url": before.ImageURL},
		AfterState:  map[string]any{"title": after.Title, "slot": after.Slot, "image_url": after.ImageURL},
	})
	return after, nil
}

// SetBannerStatus archives or restores a banner (ADM-003 Archive/Restore).
// status MUST be 'archived' or 'draft' — any other value is rejected before
// touching the repo. reason_code MANDATORY, audited.
func (s *Service) SetBannerStatus(ctx context.Context, adminID, id, status, reasonCode string) (*Banner, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	if status != bannerStatusDraft && status != bannerStatusArchived {
		return nil, fieldErr(CodeValidation, "status must be draft or archived", "status")
	}
	before, err := s.repo.GetBanner(ctx, id)
	if err != nil {
		return nil, err
	}
	after, err := s.repo.SetBannerStatus(ctx, id, status, adminID)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.cms.banner.set_status", TargetType: "banner", TargetID: id, ReasonCode: reasonCode,
		BeforeState: map[string]any{"status": before.persistedStatus},
		AfterState:  map[string]any{"status": after.persistedStatus},
	})
	return after, nil
}

// GetCategoryContent is a plain read — no audit needed.
func (s *Service) GetCategoryContent(ctx context.Context, categoryID string) (*CategoryContent, error) {
	return s.repo.GetCategoryContent(ctx, categoryID)
}

// UpsertCategoryContent creates/overwrites the per-category landing/SEO
// content (ADM-004). reason_code MANDATORY, audited.
func (s *Service) UpsertCategoryContent(ctx context.Context, adminID, categoryID string, in CategoryContentInput) (*CategoryContent, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	if _, err := s.repo.GetCategory(ctx, categoryID); err != nil {
		return nil, err
	}
	before, _ := s.repo.GetCategoryContent(ctx, categoryID) // best-effort; nil BeforeState if it fails
	after, err := s.repo.UpsertCategoryContent(ctx, categoryID, in, adminID)
	if err != nil {
		return nil, err
	}
	var beforeState map[string]any
	if before != nil {
		beforeState = map[string]any{"hero_heading": before.HeroHeading, "seo_title": before.SEOTitle}
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.cms.category_content.upsert", TargetType: "category_content", TargetID: categoryID, ReasonCode: in.ReasonCode,
		BeforeState: beforeState,
		AfterState:  map[string]any{"hero_heading": after.HeroHeading, "seo_title": after.SEOTitle},
	})
	return after, nil
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// AdminListBanners GET /admin/cms/banners
func (h *Handler) AdminListBanners(c *gin.Context) {
	bs, err := h.svc.ListBanners(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, bs)
}

// AdminCreateBanner POST /admin/cms/banners — reason_code MANDATORY.
func (h *Handler) AdminCreateBanner(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body BannerInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.CreateBanner(c.Request.Context(), uid, body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, b)
}

// AdminUpdateBanner PATCH /admin/cms/banners/:id — reason_code MANDATORY.
func (h *Handler) AdminUpdateBanner(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body BannerInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.UpdateBanner(c.Request.Context(), uid, c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, b)
}

// AdminSetBannerStatus PATCH /admin/cms/banners/:id/status — reason_code MANDATORY.
func (h *Handler) AdminSetBannerStatus(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Status     string `json:"status"`
		ReasonCode string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.SetBannerStatus(c.Request.Context(), uid, c.Param("id"), body.Status, body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, b)
}

// AdminGetCategoryContent GET /admin/cms/categories/:categoryId/content
func (h *Handler) AdminGetCategoryContent(c *gin.Context) {
	cc, err := h.svc.GetCategoryContent(c.Request.Context(), c.Param("categoryId"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, cc)
}

// AdminUpsertCategoryContent PUT /admin/cms/categories/:categoryId/content — reason_code MANDATORY.
func (h *Handler) AdminUpsertCategoryContent(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body CategoryContentInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	cc, err := h.svc.UpsertCategoryContent(c.Request.Context(), uid, c.Param("categoryId"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, cc)
}
