package crypto

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/tiers"
)

// Eligibility is the caller's crypto gate, as the app shows it before trading. The
// trade and withdrawal routes still enforce the same tier on the server; this is the
// read-side answer so the app can explain a block before the guest tries.
type Eligibility struct {
	State         string `json:"state"`
	KYCTier       int    `json:"kycTier"`
	CryptoEnabled bool   `json:"cryptoEnabled"`
	Message       string `json:"message"`
}

// EligibilityFor derives the gate from the caller's KYC tier. Tier 0 (unverified) must
// verify before crypto opens; Tier 1 and above are cleared.
func (s *Service) EligibilityFor(ctx context.Context, userID string) (*Eligibility, error) {
	if s.db == nil {
		return nil, ErrTierGateUnwired
	}
	tier, err := tiers.NewService(s.db).GetUserTier(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("crypto: read kyc tier: %w", err)
	}
	e := &Eligibility{State: "eligible", KYCTier: int(tier), CryptoEnabled: true,
		Message: "You're verified and cleared to trade crypto."}
	if tier < tiers.Tier1 {
		e.State = "kyc_required"
		e.Message = "Verify your identity to trade crypto."
	}
	return e, nil
}

// ── Watchlist ────────────────────────────────────────────────────────────────

// ResolveActiveAsset maps an asset id or symbol to an active asset's id. Unknown or
// inactive assets are ErrNotFound so the watchlist and alerts never reference them.
func (s *Service) ResolveActiveAsset(ctx context.Context, ref string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		SELECT id::text FROM public.crypto_assets
		WHERE (id::text = $1 OR symbol = upper($1)) AND is_active
		LIMIT 1`, strings.TrimSpace(ref)).Scan(&id)
	if err != nil {
		return "", ErrNotFound
	}
	return id, nil
}

// Watchlist returns the caller's watched assets, most recently added first.
func (s *Service) Watchlist(ctx context.Context, userID string) ([]Asset, error) {
	rows, err := s.db.Query(ctx, `
		SELECT a.id::text, a.symbol, a.name, a.minor_unit_scale, a.is_active, a.created_at, a.updated_at
		FROM public.crypto_watchlist w
		JOIN public.crypto_assets a ON a.id = w.asset_id
		WHERE w.user_id = $1 AND a.is_active
		ORDER BY w.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("crypto: watchlist: %w", err)
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Symbol, &a.Name, &a.MinorUnitScale, &a.IsActive, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("crypto: watchlist scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AddToWatchlist watches an active asset. Adding an asset already watched is a no-op.
func (s *Service) AddToWatchlist(ctx context.Context, userID, assetRef string) error {
	assetID, err := s.ResolveActiveAsset(ctx, assetRef)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO public.crypto_watchlist (user_id, asset_id) VALUES ($1, $2::uuid)
		ON CONFLICT (user_id, asset_id) DO NOTHING`, userID, assetID)
	return err
}

// RemoveFromWatchlist stops watching an asset. Removing one that is not watched is a no-op.
func (s *Service) RemoveFromWatchlist(ctx context.Context, userID, assetRef string) error {
	_, err := s.db.Exec(ctx, `
		DELETE FROM public.crypto_watchlist
		WHERE user_id = $1 AND asset_id::text = $2`, userID, strings.TrimSpace(assetRef))
	return err
}

// ── Price alerts ─────────────────────────────────────────────────────────────

// PriceAlert is one fiat price alert on a crypto asset.
type PriceAlert struct {
	ID          string     `json:"id"`
	AssetID     string     `json:"assetId"`
	Symbol      string     `json:"symbol"`
	IconColor   string     `json:"iconColor"`
	Condition   string     `json:"condition"`
	TargetPrice Money      `json:"targetPrice"`
	Status      string     `json:"status"`
	TriggeredAt *time.Time `json:"triggeredAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// Money is a fiat amount in minor units (kobo for NGN, cents for USD).
type Money struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// NewPriceAlert is the body for creating an alert.
type NewPriceAlert struct {
	AssetID     string `json:"assetId"`
	Condition   string `json:"condition"`
	TargetPrice int64  `json:"targetPrice"`
	Currency    string `json:"currency"`
}

// ErrInvalidAlert is returned for an alert that cannot be stored as asked.
var ErrInvalidAlert = errors.New("crypto: invalid price alert")

// Alerts returns the caller's price alerts, newest first.
func (s *Service) Alerts(ctx context.Context, userID string) ([]PriceAlert, error) {
	rows, err := s.db.Query(ctx, alertSelect+` WHERE p.user_id = $1 ORDER BY p.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("crypto: alerts: %w", err)
	}
	defer rows.Close()
	out := []PriceAlert{}
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CreateAlert stores an alert for an active asset. The condition, target and currency
// are checked here, so a bad alert never reaches the table.
func (s *Service) CreateAlert(ctx context.Context, userID string, in NewPriceAlert) (*PriceAlert, error) {
	if in.Condition != "above" && in.Condition != "below" {
		return nil, fmt.Errorf("%w: condition must be above or below", ErrInvalidAlert)
	}
	if in.TargetPrice <= 0 {
		return nil, fmt.Errorf("%w: target price must be positive", ErrInvalidAlert)
	}
	if in.Currency != "NGN" && in.Currency != "USD" {
		return nil, fmt.Errorf("%w: currency must be NGN or USD", ErrInvalidAlert)
	}
	assetID, err := s.ResolveActiveAsset(ctx, in.AssetID)
	if err != nil {
		return nil, err
	}
	var id string
	err = s.db.QueryRow(ctx, `
		INSERT INTO public.crypto_price_alerts (user_id, asset_id, condition, target_minor, currency)
		VALUES ($1, $2::uuid, $3, $4, $5) RETURNING id::text`,
		userID, assetID, in.Condition, in.TargetPrice, in.Currency).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("crypto: create alert: %w", err)
	}
	row := s.db.QueryRow(ctx, alertSelect+` WHERE p.id = $1::uuid AND p.user_id = $2`, id, userID)
	a, err := scanAlert(row)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// DeleteAlert removes one of the caller's alerts. Another user's alert is ErrNotFound.
func (s *Service) DeleteAlert(ctx context.Context, userID, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM public.crypto_price_alerts WHERE id::text = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("crypto: delete alert: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const alertSelect = `
	SELECT p.id::text, p.asset_id::text, a.symbol, p.condition, p.target_minor, p.currency,
	       p.status, p.triggered_at, p.created_at
	FROM public.crypto_price_alerts p
	JOIN public.crypto_assets a ON a.id = p.asset_id`

// scanner is the one-row read shared by pgx.Row and pgx.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanAlert(r scanner) (PriceAlert, error) {
	var a PriceAlert
	var currency string
	if err := r.Scan(&a.ID, &a.AssetID, &a.Symbol, &a.Condition, &a.TargetPrice.Amount, &currency,
		&a.Status, &a.TriggeredAt, &a.CreatedAt); err != nil {
		return PriceAlert{}, fmt.Errorf("crypto: alert scan: %w", err)
	}
	a.TargetPrice.Currency = currency
	return a, nil
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// Eligibility GET /eligibility.
func (h *Handler) Eligibility(c *gin.Context) {
	e, err := h.svc.EligibilityFor(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "eligibility": e})
}

// Watchlist GET /watchlist.
func (h *Handler) Watchlist(c *gin.Context) {
	list, err := h.svc.Watchlist(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "watchlist": list})
}

// AddWatchlist POST /watchlist {assetId}.
func (h *Handler) AddWatchlist(c *gin.Context) {
	var b struct {
		AssetID string `json:"assetId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "assetId is required"})
		return
	}
	if err := h.svc.AddToWatchlist(c.Request.Context(), ginutil.UserID(c), b.AssetID); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RemoveWatchlist DELETE /watchlist/:assetId.
func (h *Handler) RemoveWatchlist(c *gin.Context) {
	if err := h.svc.RemoveFromWatchlist(c.Request.Context(), ginutil.UserID(c), c.Param("assetId")); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Alerts GET /alerts.
func (h *Handler) Alerts(c *gin.Context) {
	list, err := h.svc.Alerts(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "alerts": list})
}

// CreateAlert POST /alerts.
func (h *Handler) CreateAlert(c *gin.Context) {
	var in NewPriceAlert
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid alert"})
		return
	}
	a, err := h.svc.CreateAlert(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "alert": a})
}

// DeleteAlert DELETE /alerts/:id.
func (h *Handler) DeleteAlert(c *gin.Context) {
	if err := h.svc.DeleteAlert(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
