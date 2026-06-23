package invest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// ─────────────────────────────────────────────────────────────────────────────
// Admin repository methods (RBAC-gated; every mutation is audited by the service)
// ─────────────────────────────────────────────────────────────────────────────

// ListAllAssets returns every asset (including disabled/suspended) for admins.
func (r *Repository) ListAllAssets(ctx context.Context) ([]StockAsset, error) {
	rows, err := r.db.Query(ctx, "SELECT "+stockCols+" FROM invest_stock_assets ORDER BY symbol")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StockAsset{}
	for rows.Next() {
		var s StockAsset
		if err := scanStock(rows, &s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CreateAsset inserts a new tradable asset (disabled by default — safe).
func (r *Repository) CreateAsset(ctx context.Context, a StockAsset) (*StockAsset, error) {
	const q = `INSERT INTO invest_stock_assets
		(symbol, name, exchange, sector, board, asset_class, status, buy_enabled, sell_enabled,
		 risk_rating, minimum_order_amount, maximum_order_amount, kyc_tier_required,
		 country_availability, provider_symbol, settlement_days, description)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q,
		strings.ToUpper(a.Symbol), a.Name, defaultStr(a.Exchange, "NGX"), a.Sector, a.Board,
		defaultStr(a.AssetClass, "equity"), defaultStr(a.Status, "active"), a.BuyEnabled, a.SellEnabled,
		defaultStr(a.RiskRating, "medium"), a.MinimumOrderAmount, a.MaximumOrderAmount,
		defaultInt(a.KYCTierRequired, 2), defaultStr(a.CountryAvailability, "NG"),
		defaultStr(a.ProviderSymbol, strings.ToUpper(a.Symbol)), defaultInt(a.SettlementDays, 3), a.Description,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.GetStockByID(ctx, id)
}

// UpdateAssetFields applies a partial column→value update to an asset.
func (r *Repository) UpdateAssetFields(ctx context.Context, id string, fields map[string]any) (*StockAsset, error) {
	if len(fields) == 0 {
		return r.GetStockByID(ctx, id)
	}
	sets := make([]string, 0, len(fields)+1)
	args := make([]any, 0, len(fields)+1)
	i := 1
	for col, val := range fields {
		sets = append(sets, fmt.Sprintf("%s=$%d", col, i))
		args = append(args, val)
		i++
	}
	sets = append(sets, "updated_at=now()")
	args = append(args, id)
	q := fmt.Sprintf("UPDATE invest_stock_assets SET %s WHERE id=$%d", strings.Join(sets, ","), i)
	if _, err := r.db.Exec(ctx, q, args...); err != nil {
		return nil, err
	}
	return r.GetStockByID(ctx, id)
}

// ListAllOrders returns orders across all users (admin monitoring).
func (r *Repository) ListAllOrders(ctx context.Context, status string, limit, offset int) ([]Order, error) {
	sb := strings.Builder{}
	sb.WriteString("SELECT " + orderCols + " FROM invest_orders")
	args := []any{}
	i := 1
	if status != "" {
		sb.WriteString(fmt.Sprintf(" WHERE status=$%d", i))
		args = append(args, status)
		i++
	}
	sb.WriteString(fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", i, i+1))
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		var o Order
		if err := scanOrder(rows, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// OverviewCounts returns headline counts for the admin dashboard.
func (r *Repository) OverviewCounts(ctx context.Context) (map[string]any, error) {
	out := map[string]any{}
	scalar := func(q string) int64 {
		var n int64
		_ = r.db.QueryRow(ctx, q).Scan(&n)
		return n
	}
	out["assets_total"] = scalar(`SELECT COUNT(*) FROM invest_stock_assets`)
	out["assets_tradable"] = scalar(`SELECT COUNT(*) FROM invest_stock_assets WHERE status='active' AND (buy_enabled OR sell_enabled)`)
	out["orders_total"] = scalar(`SELECT COUNT(*) FROM invest_orders`)
	out["orders_pending_settlement"] = scalar(`SELECT COUNT(*) FROM invest_orders WHERE status='PendingSettlement'`)
	out["orders_failed"] = scalar(`SELECT COUNT(*) FROM invest_orders WHERE status IN ('Failed','Rejected')`)
	out["investors"] = scalar(`SELECT COUNT(*) FROM invest_profiles WHERE stock_trading_enabled=true`)
	out["open_offers"] = scalar(`SELECT COUNT(*) FROM invest_public_offers WHERE status IN ('open','closing_soon')`)
	return out, nil
}

// FeeConfig is the admin-configurable fee schedule (mirrors invest_fee_config).
type FeeConfig struct {
	CommissionBPS int   `json:"commission_bps"`
	MinFeeKobo    int64 `json:"min_fee_kobo"`
}

func (r *Repository) GetFeeConfig(ctx context.Context) (FeeConfig, error) {
	var fc FeeConfig
	err := r.db.QueryRow(ctx, `SELECT commission_bps, min_fee_kobo FROM invest_fee_config WHERE is_active=true LIMIT 1`).
		Scan(&fc.CommissionBPS, &fc.MinFeeKobo)
	if err == pgx.ErrNoRows {
		return FeeConfig{CommissionBPS: 150, MinFeeKobo: 10_000}, nil
	}
	if err != nil {
		return FeeConfig{}, err
	}
	return fc, nil
}

func (r *Repository) UpdateFeeConfig(ctx context.Context, fc FeeConfig, adminID string) error {
	const q = `UPDATE invest_fee_config SET commission_bps=$1, min_fee_kobo=$2, updated_by=$3, updated_at=now() WHERE is_active=true`
	ct, err := r.db.Exec(ctx, q, fc.CommissionBPS, fc.MinFeeKobo, adminID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		_, err = r.db.Exec(ctx, `INSERT INTO invest_fee_config (commission_bps, min_fee_kobo, updated_by) VALUES ($1,$2,$3)`,
			fc.CommissionBPS, fc.MinFeeKobo, adminID)
	}
	return err
}

// InsertAudit appends an immutable admin-audit row.
func (r *Repository) InsertAudit(ctx context.Context, adminID, action, entityType, entityID, reason string, oldVal, newVal any) error {
	ob, _ := json.Marshal(oldVal)
	nb, _ := json.Marshal(newVal)
	const q = `INSERT INTO invest_admin_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := r.db.Exec(ctx, q, adminID, action, entityType, nullStr(entityID), ob, nb, nullStr(reason))
	return err
}

func (r *Repository) ListAudit(ctx context.Context, limit, offset int) ([]map[string]any, error) {
	const q = `SELECT id, admin_id, action, entity_type, COALESCE(entity_id,''), COALESCE(reason,''), created_at
		FROM invest_admin_audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, adminID, action, entityType, entityID, reason string
		var created interface{}
		if err := rows.Scan(&id, &adminID, &action, &entityType, &entityID, &reason, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "admin_id": adminID, "action": action, "entity_type": entityType,
			"entity_id": entityID, "reason": reason, "created_at": created,
		})
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin handler (HTTP). Mounted under /api/v1/admin/invest with RBAC.
// ─────────────────────────────────────────────────────────────────────────────

type AdminHandler struct{ svc *Service }

func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

func adminID(c *gin.Context) string {
	if u, ok := getAuthUserID(c); ok {
		return u
	}
	return c.GetString("user_id")
}

// getAuthUserID reads the user id set by the auth middleware.
func getAuthUserID(c *gin.Context) (string, bool) {
	v := c.GetString("user_id")
	if v == "" {
		return "", false
	}
	return v, true
}

func (h *AdminHandler) Overview(c *gin.Context) {
	counts, err := h.svc.repo.OverviewCounts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, counts)
}

func (h *AdminHandler) ListAssets(c *gin.Context) {
	assets, err := h.svc.repo.ListAllAssets(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": assets})
}

func (h *AdminHandler) CreateAsset(c *gin.Context) {
	var a StockAsset
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if a.Symbol == "" || a.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "symbol and name are required"})
		return
	}
	created, err := h.svc.repo.CreateAsset(c.Request.Context(), a)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.svc.repo.InsertAudit(c.Request.Context(), adminID(c), "asset.create", "stock_asset", created.ID, "", nil, created)
	c.JSON(http.StatusCreated, created)
}

// UpdateAsset toggles trading flags / status / limits (every change audited).
func (h *AdminHandler) UpdateAsset(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Status             *string `json:"status"`
		BuyEnabled         *bool   `json:"buy_enabled"`
		SellEnabled        *bool   `json:"sell_enabled"`
		RiskRating         *string `json:"risk_rating"`
		MinimumOrderAmount *int64  `json:"minimum_order_amount"`
		MaximumOrderAmount *int64  `json:"maximum_order_amount"`
		KYCTierRequired    *int    `json:"kyc_tier_required"`
		Reason             string  `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	before, err := h.svc.repo.GetStockByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
		return
	}
	fields := map[string]any{}
	if body.Status != nil {
		fields["status"] = *body.Status
	}
	if body.BuyEnabled != nil {
		fields["buy_enabled"] = *body.BuyEnabled
	}
	if body.SellEnabled != nil {
		fields["sell_enabled"] = *body.SellEnabled
	}
	if body.RiskRating != nil {
		fields["risk_rating"] = *body.RiskRating
	}
	if body.MinimumOrderAmount != nil {
		fields["minimum_order_amount"] = *body.MinimumOrderAmount
	}
	if body.MaximumOrderAmount != nil {
		fields["maximum_order_amount"] = *body.MaximumOrderAmount
	}
	if body.KYCTierRequired != nil {
		fields["kyc_tier_required"] = *body.KYCTierRequired
	}
	updated, err := h.svc.repo.UpdateAssetFields(c.Request.Context(), id, fields)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.svc.repo.InsertAudit(c.Request.Context(), adminID(c), "asset.update", "stock_asset", id, body.Reason, before, updated)
	c.JSON(http.StatusOK, updated)
}

func (h *AdminHandler) ListOrders(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	orders, err := h.svc.repo.ListAllOrders(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": orders})
}

func (h *AdminHandler) FailedOrders(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	orders, err := h.svc.repo.ListAllOrders(c.Request.Context(), "Failed", limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": orders})
}

func (h *AdminHandler) PendingSettlements(c *gin.Context) {
	limit, _ := adminPage(c, 100)
	orders, err := h.svc.repo.DueSettlements(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Also surface all PendingSettlement (not just due) for visibility.
	all, _ := h.svc.repo.ListAllOrders(c.Request.Context(), "PendingSettlement", limit, 0)
	c.JSON(http.StatusOK, gin.H{"due": orders, "pending": all})
}

// RunSettlement advances due T+N settlements (trading-ops action; audited).
func (h *AdminHandler) RunSettlement(c *gin.Context) {
	n, err := h.svc.ProcessDueSettlements(c.Request.Context(), 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.svc.repo.InsertAudit(c.Request.Context(), adminID(c), "settlement.run", "settlement", "", "", nil, gin.H{"processed": n})
	c.JSON(http.StatusOK, gin.H{"processed": n})
}

func (h *AdminHandler) GetFees(c *gin.Context) {
	fc, err := h.svc.repo.GetFeeConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, fc)
}

func (h *AdminHandler) UpdateFees(c *gin.Context) {
	var body struct {
		CommissionBPS int    `json:"commission_bps"`
		MinFeeKobo    int64  `json:"min_fee_kobo"`
		Reason        string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.CommissionBPS < 0 || body.CommissionBPS > 1000 || body.MinFeeKobo < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fee out of allowed range"})
		return
	}
	before, _ := h.svc.repo.GetFeeConfig(c.Request.Context())
	fc := FeeConfig{CommissionBPS: body.CommissionBPS, MinFeeKobo: body.MinFeeKobo}
	if err := h.svc.repo.UpdateFeeConfig(c.Request.Context(), fc, adminID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.svc.repo.InsertAudit(c.Request.Context(), adminID(c), "fees.update", "fee_config", "", body.Reason, before, fc)
	c.JSON(http.StatusOK, fc)
}

func (h *AdminHandler) AuditLog(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	logs, err := h.svc.repo.ListAudit(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// ── helpers ──────────────────────────────────────────────────────────────────

func adminPage(c *gin.Context, def int) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(def)))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 200 {
		limit = def
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func defaultStr(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return v
}

func defaultInt(v, d int) int {
	if v == 0 {
		return d
	}
	return v
}
