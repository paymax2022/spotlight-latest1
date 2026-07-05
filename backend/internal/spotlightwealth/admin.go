package spotlightwealth

import (
	"context"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ──────────────────────────────────────────────────────────────────────────
// Spotlight Wealth — CONTENT ADMIN.
//
// This file adds the content-authoring surface on top of the read-mostly
// member API in service.go/handler.go/routes.go (none of those files are
// modified here — additive only, per house brownfield-safety rules).
// Mirrors backend/internal/learn/admin.go exactly.
//
// Scope: create/update/delete for spotlight_videos, spotlight_challenges,
// spotlight_campaigns. All mutations are RBAC-gated at the route layer (see
// RegisterSpotlightwealthAdmin / backend/internal/app/spotlightwealth_routes.go)
// and audited via the existing nil-safe Auditor sink (Service.audit /
// AdminService.audit).
//
// MONEY: challenge reward amounts are BIGINT kobo (int64) — never floats,
// never strings for math (per house iron rules). This file only authors the
// challenge's reward_kobo config column; the actual reward payout (ledger
// credit) remains solely in Service.CompleteChallenge (service.go), untouched.
// ──────────────────────────────────────────────────────────────────────────

// AdminService owns the content-authoring mutations. It shares the same pool
// (and, optionally, the same Auditor) as the read-mostly Service.
type AdminService struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewAdminService(db *pgxpool.Pool, audit Auditor) *AdminService {
	return &AdminService{db: db, audit: audit}
}

func (s *AdminService) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "spotlightwealth", resType, resID, oldV, newV, "", "", "info")
}

func newID(prefix string) string {
	return prefix + "_" + uuid.New().String()[:20]
}

var isValidTopic = map[SpotlightTopic]bool{
	"budgeting": true, "investing-basics": true, "crypto": true,
	"stocks": true, "saving": true, "mindset": true,
}
var isValidChallengeKind = map[ChallengeKind]bool{
	"literacy": true, "quiz": true, "savings": true,
}

// ───────────────────────── Admin DTOs ─────────────────────────

type AdminVideoInput struct {
	ID             string         `json:"id"`
	Title          string         `json:"title" binding:"required"`
	Creator        string         `json:"creator" binding:"required"`
	ThumbnailColor string         `json:"thumbnailColor"`
	DurationMins   int            `json:"durationMins"`
	Topic          SpotlightTopic `json:"topic" binding:"required"`
	SortOrder      int            `json:"sortOrder"`
	Published      *bool          `json:"published"`
}

// AdminChallengeInput authors a challenge. RewardKobo is the reward amount in
// integer minor units (kobo) — never a float (Iron Rule: money handling).
type AdminChallengeInput struct {
	ID          string        `json:"id"`
	Title       string        `json:"title" binding:"required"`
	Description string        `json:"description"`
	RewardKobo  int64         `json:"rewardKobo"`
	Currency    string        `json:"currency"`
	EndsAt      string        `json:"endsAt" binding:"required"` // RFC3339
	Kind        ChallengeKind `json:"kind" binding:"required"`
	Published   *bool         `json:"published"`
}

type AdminCampaignInput struct {
	ID          string `json:"id"`
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	IconColor   string `json:"iconColor"`
	CTA         string `json:"cta"`
	SortOrder   int    `json:"sortOrder"`
	Published   *bool  `json:"published"`
}

// ───────────────────────── Videos ─────────────────────────

func (s *AdminService) CreateVideo(ctx context.Context, actor string, in AdminVideoInput) (*FinanceVideo, error) {
	if !isValidTopic[in.Topic] {
		return nil, ErrBadInput
	}
	id := in.ID
	if id == "" {
		id = newID("vid")
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const ins = `INSERT INTO spotlight_videos (id, title, creator, thumbnail_color, duration_mins, topic, sort_order, published)
	             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, ins, id, in.Title, in.Creator, in.ThumbnailColor, in.DurationMins, string(in.Topic), in.SortOrder, published); err != nil {
		return nil, fmt.Errorf("spotlight admin: create video: %w", err)
	}
	s.log(actor, "spotlight.admin.video.create", "spotlight_video", id, nil, map[string]any{"title": in.Title, "topic": in.Topic})
	return &FinanceVideo{ID: id, Title: in.Title, Creator: in.Creator, ThumbnailColor: in.ThumbnailColor, DurationMins: in.DurationMins, Topic: in.Topic}, nil
}

func (s *AdminService) UpdateVideo(ctx context.Context, actor, id string, in AdminVideoInput) (*FinanceVideo, error) {
	if !isValidTopic[in.Topic] {
		return nil, ErrBadInput
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const upd = `UPDATE spotlight_videos SET title=$2, creator=$3, thumbnail_color=$4, duration_mins=$5, topic=$6, sort_order=$7, published=$8 WHERE id=$1`
	ct, err := s.db.Exec(ctx, upd, id, in.Title, in.Creator, in.ThumbnailColor, in.DurationMins, string(in.Topic), in.SortOrder, published)
	if err != nil {
		return nil, fmt.Errorf("spotlight admin: update video: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	s.log(actor, "spotlight.admin.video.update", "spotlight_video", id, nil, map[string]any{"title": in.Title, "topic": in.Topic})
	return &FinanceVideo{ID: id, Title: in.Title, Creator: in.Creator, ThumbnailColor: in.ThumbnailColor, DurationMins: in.DurationMins, Topic: in.Topic}, nil
}

func (s *AdminService) DeleteVideo(ctx context.Context, actor, id string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM spotlight_videos WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("spotlight admin: delete video: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "spotlight.admin.video.delete", "spotlight_video", id, nil, nil)
	return nil
}

// ───────────────────────── Challenges ─────────────────────────

func (s *AdminService) CreateChallenge(ctx context.Context, actor string, in AdminChallengeInput) (*Challenge, error) {
	if !isValidChallengeKind[in.Kind] {
		return nil, ErrBadInput
	}
	if in.RewardKobo < 0 {
		return nil, ErrBadInput
	}
	id := in.ID
	if id == "" {
		id = newID("chl")
	}
	currency := in.Currency
	if currency == "" {
		currency = DefaultCurrency
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const ins = `INSERT INTO spotlight_challenges (id, title, description, reward_kobo, currency, ends_at, kind, published)
	             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, ins, id, in.Title, in.Description, in.RewardKobo, currency, in.EndsAt, string(in.Kind), published); err != nil {
		return nil, fmt.Errorf("spotlight admin: create challenge: %w", err)
	}
	s.log(actor, "spotlight.admin.challenge.create", "spotlight_challenge", id, nil,
		map[string]any{"title": in.Title, "rewardKobo": in.RewardKobo, "kind": in.Kind})
	return &Challenge{ID: id, Title: in.Title, Description: in.Description, Reward: koboToMoney(in.RewardKobo, currency), EndsAt: in.EndsAt, Kind: in.Kind}, nil
}

func (s *AdminService) UpdateChallenge(ctx context.Context, actor, id string, in AdminChallengeInput) (*Challenge, error) {
	if !isValidChallengeKind[in.Kind] {
		return nil, ErrBadInput
	}
	if in.RewardKobo < 0 {
		return nil, ErrBadInput
	}
	currency := in.Currency
	if currency == "" {
		currency = DefaultCurrency
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const upd = `UPDATE spotlight_challenges SET title=$2, description=$3, reward_kobo=$4, currency=$5, ends_at=$6, kind=$7, published=$8 WHERE id=$1`
	ct, err := s.db.Exec(ctx, upd, id, in.Title, in.Description, in.RewardKobo, currency, in.EndsAt, string(in.Kind), published)
	if err != nil {
		return nil, fmt.Errorf("spotlight admin: update challenge: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	s.log(actor, "spotlight.admin.challenge.update", "spotlight_challenge", id, nil,
		map[string]any{"title": in.Title, "rewardKobo": in.RewardKobo, "kind": in.Kind})
	return &Challenge{ID: id, Title: in.Title, Description: in.Description, Reward: koboToMoney(in.RewardKobo, currency), EndsAt: in.EndsAt, Kind: in.Kind}, nil
}

func (s *AdminService) DeleteChallenge(ctx context.Context, actor, id string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM spotlight_challenges WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("spotlight admin: delete challenge: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "spotlight.admin.challenge.delete", "spotlight_challenge", id, nil, nil)
	return nil
}

// ───────────────────────── Campaigns ─────────────────────────

func (s *AdminService) CreateCampaign(ctx context.Context, actor string, in AdminCampaignInput) (*Campaign, error) {
	id := in.ID
	if id == "" {
		id = newID("cmp")
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const ins = `INSERT INTO spotlight_campaigns (id, title, description, icon_color, cta, sort_order, published)
	             VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := s.db.Exec(ctx, ins, id, in.Title, in.Description, in.IconColor, in.CTA, in.SortOrder, published); err != nil {
		return nil, fmt.Errorf("spotlight admin: create campaign: %w", err)
	}
	s.log(actor, "spotlight.admin.campaign.create", "spotlight_campaign", id, nil, map[string]any{"title": in.Title})
	return &Campaign{ID: id, Title: in.Title, Description: in.Description, IconColor: in.IconColor, CTA: in.CTA}, nil
}

func (s *AdminService) UpdateCampaign(ctx context.Context, actor, id string, in AdminCampaignInput) (*Campaign, error) {
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const upd = `UPDATE spotlight_campaigns SET title=$2, description=$3, icon_color=$4, cta=$5, sort_order=$6, published=$7 WHERE id=$1`
	ct, err := s.db.Exec(ctx, upd, id, in.Title, in.Description, in.IconColor, in.CTA, in.SortOrder, published)
	if err != nil {
		return nil, fmt.Errorf("spotlight admin: update campaign: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	s.log(actor, "spotlight.admin.campaign.update", "spotlight_campaign", id, nil, map[string]any{"title": in.Title})
	return &Campaign{ID: id, Title: in.Title, Description: in.Description, IconColor: in.IconColor, CTA: in.CTA}, nil
}

func (s *AdminService) DeleteCampaign(ctx context.Context, actor, id string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM spotlight_campaigns WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("spotlight admin: delete campaign: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "spotlight.admin.campaign.delete", "spotlight_campaign", id, nil, nil)
	return nil
}

// ───────────────────────── Admin handler ─────────────────────────

type AdminHandler struct {
	svc *AdminService
}

func NewAdminHandler(svc *AdminService) *AdminHandler { return &AdminHandler{svc: svc} }

func adminActor(c *gin.Context) string { return c.GetString("user_id") }

// RegisterSpotlightwealthAdmin mounts the Spotlight Wealth CONTENT ADMIN routes
// on the provided group. The caller is responsible for RBAC-gating each route
// (see backend/internal/app/spotlightwealth_routes.go) — this function only
// wires paths to handlers, matching the learn admin convention of leaving
// permission middleware to the app registration layer.
//
//	POST   /admin/videos             — create a video
//	PUT    /admin/videos/:id         — update a video
//	DELETE /admin/videos/:id         — delete a video
//	POST   /admin/challenges         — create a challenge
//	PUT    /admin/challenges/:id     — update a challenge
//	DELETE /admin/challenges/:id     — delete a challenge
//	POST   /admin/campaigns          — create a campaign
//	PUT    /admin/campaigns/:id      — update a campaign
//	DELETE /admin/campaigns/:id      — delete a campaign
func RegisterSpotlightwealthAdmin(g *gin.RouterGroup, h *AdminHandler) {
	g.POST("/videos", h.CreateVideo)
	g.PUT("/videos/:id", h.UpdateVideo)
	g.DELETE("/videos/:id", h.DeleteVideo)

	g.POST("/challenges", h.CreateChallenge)
	g.PUT("/challenges/:id", h.UpdateChallenge)
	g.DELETE("/challenges/:id", h.DeleteChallenge)

	g.POST("/campaigns", h.CreateCampaign)
	g.PUT("/campaigns/:id", h.UpdateCampaign)
	g.DELETE("/campaigns/:id", h.DeleteCampaign)
}

func (h *AdminHandler) CreateVideo(c *gin.Context) {
	var in AdminVideoInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	v, err := h.svc.CreateVideo(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(201, v)
}

func (h *AdminHandler) UpdateVideo(c *gin.Context) {
	var in AdminVideoInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	v, err := h.svc.UpdateVideo(c.Request.Context(), adminActor(c), c.Param("id"), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(200, v)
}

func (h *AdminHandler) DeleteVideo(c *gin.Context) {
	if err := h.svc.DeleteVideo(c.Request.Context(), adminActor(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (h *AdminHandler) CreateChallenge(c *gin.Context) {
	var in AdminChallengeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	ch, err := h.svc.CreateChallenge(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(201, ch)
}

func (h *AdminHandler) UpdateChallenge(c *gin.Context) {
	var in AdminChallengeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	ch, err := h.svc.UpdateChallenge(c.Request.Context(), adminActor(c), c.Param("id"), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(200, ch)
}

func (h *AdminHandler) DeleteChallenge(c *gin.Context) {
	if err := h.svc.DeleteChallenge(c.Request.Context(), adminActor(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (h *AdminHandler) CreateCampaign(c *gin.Context) {
	var in AdminCampaignInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	cmp, err := h.svc.CreateCampaign(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(201, cmp)
}

func (h *AdminHandler) UpdateCampaign(c *gin.Context) {
	var in AdminCampaignInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": "invalid body"})
		return
	}
	cmp, err := h.svc.UpdateCampaign(c.Request.Context(), adminActor(c), c.Param("id"), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(200, cmp)
}

func (h *AdminHandler) DeleteCampaign(c *gin.Context) {
	if err := h.svc.DeleteCampaign(c.Request.Context(), adminActor(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}
