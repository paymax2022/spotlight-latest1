package adminext

// Platform-configuration admin slice: campaign categories, fee schedule and the
// feature-flag registry. These back the still-mock "settings" surfaces in
// frontend-admin/src/services/crowdfundingAdminService.ts:
//
//	GET   /config/categories          → category list with live campaign counts
//	PATCH /config/categories/:id      → toggle enabled / requiresEnhancedReview
//	GET   /config/fees                → singleton fee schedule
//	PUT   /config/fees                → replace fee schedule (audited)
//	GET   /config/flags               → feature-flag registry
//	PATCH /config/flags/:key          → toggle a (non-locked) flag (audited)
//
// Categories are read from the EXISTING crowdfunding_categories table; fees and
// flags live in cf_fee_config / cf_feature_flags (20260621050000_crowdfunding_live.sql).
// Every mutation is transactional and writes an immutable cf_audit_logs row.

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ─── DTOs (camelCase to match the admin web client TS shapes) ────────────────

// CategoryConfig matches CfCategoryConfig.
type CategoryConfig struct {
	ID                     string `json:"id"`
	Label                  string `json:"label"`
	Slug                   string `json:"slug"`
	Enabled                bool   `json:"enabled"`
	RequiresEnhancedReview bool   `json:"requiresEnhancedReview"`
	CampaignCount          int    `json:"campaignCount"`
}

// FeeConfig matches CfFeeConfig. All amounts are integer kobo; rates are integer
// basis points.
type FeeConfig struct {
	PlatformFeeBps      int   `json:"platformFeeBps"`
	PaymentFeeBps       int   `json:"paymentFeeBps"`
	PaymentFeeFlatKobo  int64 `json:"paymentFeeFlatKobo"`
	MinContributionKobo int64 `json:"minContributionKobo"`
	MaxContributionKobo int64 `json:"maxContributionKobo"`
}

// FeatureFlag matches CfFeatureFlag.
type FeatureFlag struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	Locked      bool   `json:"locked"`
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// CategoryPatchRequest is the PATCH body for a category toggle. Pointers so the
// caller can send exactly one field; the other stays unchanged.
type CategoryPatchRequest struct {
	Enabled                *bool `json:"enabled"`
	RequiresEnhancedReview *bool `json:"requiresEnhancedReview"`
}

// FlagPatchRequest is the PATCH body for a feature-flag toggle.
type FlagPatchRequest struct {
	Enabled *bool `json:"enabled"`
}

// ─── Service: categories ─────────────────────────────────────────────────────

// ListCategories returns the configured categories with a LIVE campaign count
// (derived from the campaigns table — never a stored counter).
func (s *Service) ListCategories(ctx context.Context) ([]CategoryConfig, error) {
	const q = `
		SELECT cat.id, cat.label, cat.slug, cat.enabled, cat.enhanced_review,
		       COALESCE((SELECT COUNT(*) FROM campaigns c WHERE c.category = cat.slug), 0)
		FROM crowdfunding_categories cat
		ORDER BY cat.sort_order ASC, cat.label ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CategoryConfig{}
	for rows.Next() {
		var c CategoryConfig
		if err := rows.Scan(&c.ID, &c.Label, &c.Slug, &c.Enabled, &c.RequiresEnhancedReview, &c.CampaignCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// PatchCategory toggles a single category field (enabled or enhanced_review) and
// writes an audit row. Exactly one field is expected per call; both are accepted.
func (s *Service) PatchCategory(ctx context.Context, id, adminID string, req CategoryPatchRequest) error {
	if req.Enabled == nil && req.RequiresEnhancedReview == nil {
		return fmt.Errorf("adminext: no category field supplied")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var slug string
	if err := tx.QueryRow(ctx, `SELECT slug FROM crowdfunding_categories WHERE id=$1 FOR UPDATE`, id).Scan(&slug); err != nil {
		return fmt.Errorf("adminext: category not found")
	}
	if req.Enabled != nil {
		if _, err := tx.Exec(ctx, `UPDATE crowdfunding_categories SET enabled=$1 WHERE id=$2`, *req.Enabled, id); err != nil {
			return err
		}
	}
	if req.RequiresEnhancedReview != nil {
		if _, err := tx.Exec(ctx, `UPDATE crowdfunding_categories SET enhanced_review=$1 WHERE id=$2`, *req.RequiresEnhancedReview, id); err != nil {
			return err
		}
	}
	if err := s.audit(ctx, tx, adminID, "config.category.update", slug); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Service: fees ───────────────────────────────────────────────────────────

// GetFees returns the singleton fee schedule (row id=1).
func (s *Service) GetFees(ctx context.Context) (*FeeConfig, error) {
	var f FeeConfig
	err := s.db.QueryRow(ctx, `
		SELECT platform_fee_bps, payment_fee_bps, payment_fee_flat_kobo,
		       min_contribution_kobo, max_contribution_kobo
		FROM cf_fee_config WHERE id=1`).Scan(
		&f.PlatformFeeBps, &f.PaymentFeeBps, &f.PaymentFeeFlatKobo,
		&f.MinContributionKobo, &f.MaxContributionKobo)
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// UpdateFees replaces the singleton fee schedule and writes an audit row. Values
// are validated fail-closed (non-negative; min <= max).
func (s *Service) UpdateFees(ctx context.Context, adminID string, f FeeConfig) (*FeeConfig, error) {
	if f.PlatformFeeBps < 0 || f.PaymentFeeBps < 0 || f.PaymentFeeFlatKobo < 0 ||
		f.MinContributionKobo < 0 || f.MaxContributionKobo < 0 {
		return nil, fmt.Errorf("adminext: fee values must be non-negative")
	}
	if f.MaxContributionKobo > 0 && f.MinContributionKobo > f.MaxContributionKobo {
		return nil, fmt.Errorf("adminext: minContributionKobo cannot exceed maxContributionKobo")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var prevPlatform int
	if err := tx.QueryRow(ctx, `SELECT platform_fee_bps FROM cf_fee_config WHERE id=1 FOR UPDATE`).Scan(&prevPlatform); err != nil {
		return nil, fmt.Errorf("adminext: fee config not found")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE cf_fee_config SET
			platform_fee_bps=$1, payment_fee_bps=$2, payment_fee_flat_kobo=$3,
			min_contribution_kobo=$4, max_contribution_kobo=$5, updated_at=NOW()
		WHERE id=1`,
		f.PlatformFeeBps, f.PaymentFeeBps, f.PaymentFeeFlatKobo,
		f.MinContributionKobo, f.MaxContributionKobo); err != nil {
		return nil, err
	}
	target := fmt.Sprintf("platformFeeBps %d->%d", prevPlatform, f.PlatformFeeBps)
	if err := s.audit(ctx, tx, adminID, "config.fees.update", target); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &f, nil
}

// ─── Service: feature flags ──────────────────────────────────────────────────

// ListFlags returns the feature-flag registry in display order.
func (s *Service) ListFlags(ctx context.Context) ([]FeatureFlag, error) {
	const q = `SELECT key, label, description, enabled, locked
	           FROM cf_feature_flags ORDER BY sort_order ASC, key ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeatureFlag{}
	for rows.Next() {
		var f FeatureFlag
		if err := rows.Scan(&f.Key, &f.Label, &f.Description, &f.Enabled, &f.Locked); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// SetFlag toggles a non-locked feature flag and writes an audit row. Locked flags
// (e.g. investment, pending licence) are rejected fail-closed.
func (s *Service) SetFlag(ctx context.Context, key, adminID string, enabled bool) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var locked bool
	if err := tx.QueryRow(ctx, `SELECT locked FROM cf_feature_flags WHERE key=$1 FOR UPDATE`, key).Scan(&locked); err != nil {
		return fmt.Errorf("adminext: feature flag not found")
	}
	if locked {
		return fmt.Errorf("adminext: feature flag %q is locked and cannot be changed", key)
	}
	if _, err := tx.Exec(ctx, `UPDATE cf_feature_flags SET enabled=$1, updated_at=NOW() WHERE key=$2`, enabled, key); err != nil {
		return err
	}
	action := "config.flag.disable"
	if enabled {
		action = "config.flag.enable"
	}
	if err := s.audit(ctx, tx, adminID, action, key); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// ListCategories — GET /config/categories.
func (h *Handler) ListCategories(c *gin.Context) {
	items, err := h.svc.ListCategories(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": items})
}

// PatchCategory — PATCH /config/categories/:id.
func (h *Handler) PatchCategory(c *gin.Context) {
	var req CategoryPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchCategory(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetFees — GET /config/fees (singleton, returned directly).
func (h *Handler) GetFees(c *gin.Context) {
	res, err := h.svc.GetFees(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// UpdateFees — PUT /config/fees.
func (h *Handler) UpdateFees(c *gin.Context) {
	var req FeeConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UpdateFees(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListFlags — GET /config/flags.
func (h *Handler) ListFlags(c *gin.Context) {
	items, err := h.svc.ListFlags(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"flags": items})
}

// PatchFlag — PATCH /config/flags/:key.
func (h *Handler) PatchFlag(c *gin.Context) {
	var req FlagPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enabled is required"})
		return
	}
	if err := h.svc.SetFlag(c.Request.Context(), strings.TrimSpace(c.Param("key")), c.GetString("user_id"), *req.Enabled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
