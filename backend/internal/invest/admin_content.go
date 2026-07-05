package invest

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────────────────────
// Admin: dividend + corporate-action ingestion and provider health.
// Dividends/corporate actions are admin- or provider-sourced; every record is
// traceable to a source (iron rule: every corporate action traceable).
// ─────────────────────────────────────────────────────────────────────────────

// InsertDividend records a dividend for a symbol (resolves the asset id).
func (r *Repository) InsertDividend(ctx context.Context, symbol string, amountPerShareKobo int64, exDate, recordDate, paymentDate, source string) (string, error) {
	st, err := r.GetStockBySymbol(ctx, symbol)
	if err != nil {
		return "", err
	}
	const q = `INSERT INTO invest_dividends
		(stock_asset_id, symbol, amount_per_share_kobo, ex_date, record_date, payment_date, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`
	var id string
	err = r.db.QueryRow(ctx, q, st.ID, st.Symbol, amountPerShareKobo,
		nullDate(exDate), nullDate(recordDate), nullDate(paymentDate), nullStr(source)).Scan(&id)
	return id, err
}

func (r *Repository) ListDividends(ctx context.Context, limit, offset int) ([]Dividend, error) {
	const q = `SELECT id, stock_asset_id, symbol, amount_per_share_kobo, currency,
		ex_date::text, record_date::text, payment_date::text, status, COALESCE(source,'')
		FROM invest_dividends ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dividend{}
	for rows.Next() {
		var d Dividend
		if err := rows.Scan(&d.ID, &d.StockAssetID, &d.Symbol, &d.AmountPerShareKobo, &d.Currency,
			&d.ExDate, &d.RecordDate, &d.PaymentDate, &d.Status, &d.Source); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Repository) InsertCorporateAction(ctx context.Context, symbol, caType, title, description, effectiveDate, recordDate, paymentDate, source string) (string, error) {
	st, err := r.GetStockBySymbol(ctx, symbol)
	if err != nil {
		return "", err
	}
	const q = `INSERT INTO invest_corporate_actions
		(stock_asset_id, symbol, type, title, description, effective_date, record_date, payment_date, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`
	var id string
	err = r.db.QueryRow(ctx, q, st.ID, st.Symbol, caType, title, nullStr(description),
		nullDate(effectiveDate), nullDate(recordDate), nullDate(paymentDate), nullStr(source)).Scan(&id)
	return id, err
}

func (r *Repository) ListCorporateActions(ctx context.Context, limit, offset int) ([]CorporateAction, error) {
	const q = `SELECT id, stock_asset_id, symbol, type, title, COALESCE(description,''),
		effective_date::text, record_date::text, payment_date::text, status, COALESCE(source,'')
		FROM invest_corporate_actions ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CorporateAction{}
	for rows.Next() {
		var c CorporateAction
		if err := rows.Scan(&c.ID, &c.StockAssetID, &c.Symbol, &c.Type, &c.Title, &c.Description,
			&c.EffectiveDate, &c.RecordDate, &c.PaymentDate, &c.Status, &c.Source); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ProviderHealth reports the configured broker + market-data adapter health.
func (s *Service) ProviderHealth(ctx context.Context) []map[string]any {
	out := []map[string]any{}
	check := func(role, name string, hc any) {
		entry := map[string]any{"role": role, "provider": name, "healthy": true, "detail": "mock/no health check"}
		if checker, ok := hc.(HealthChecker); ok {
			ok2, detail := checker.Healthy(ctx)
			entry["healthy"] = ok2
			entry["detail"] = detail
		}
		out = append(out, entry)
	}
	check("broker", s.broker.Name(), s.broker)
	check("market_data", s.market.Name(), s.market)
	return out
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (h *AdminHandler) ListDividends(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	d, err := h.svc.repo.ListDividends(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

func (h *AdminHandler) CreateDividend(c *gin.Context) {
	var body struct {
		Symbol             string `json:"symbol" binding:"required"`
		AmountPerShareKobo int64  `json:"amount_per_share_kobo" binding:"required"`
		ExDate             string `json:"ex_date"`
		RecordDate         string `json:"record_date"`
		PaymentDate        string `json:"payment_date"`
		Source             string `json:"source"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.repo.InsertDividend(c.Request.Context(), body.Symbol, body.AmountPerShareKobo,
		body.ExDate, body.RecordDate, body.PaymentDate, body.Source)
	if err != nil {
		httpErr(c, err)
		return
	}
	_ = h.svc.repo.InsertAudit(c.Request.Context(), adminID(c), "dividend.create", "dividend", id, body.Source, nil, body)
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *AdminHandler) ListCorporateActions(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	a, err := h.svc.repo.ListCorporateActions(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *AdminHandler) CreateCorporateAction(c *gin.Context) {
	var body struct {
		Symbol        string `json:"symbol" binding:"required"`
		Type          string `json:"type" binding:"required"`
		Title         string `json:"title" binding:"required"`
		Description   string `json:"description"`
		EffectiveDate string `json:"effective_date"`
		RecordDate    string `json:"record_date"`
		PaymentDate   string `json:"payment_date"`
		Source        string `json:"source"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.repo.InsertCorporateAction(c.Request.Context(), body.Symbol, strings.ToLower(body.Type),
		body.Title, body.Description, body.EffectiveDate, body.RecordDate, body.PaymentDate, body.Source)
	if err != nil {
		httpErr(c, err)
		return
	}
	_ = h.svc.repo.InsertAudit(c.Request.Context(), adminID(c), "corporate_action.create", "corporate_action", id, body.Source, nil, body)
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *AdminHandler) ProviderHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": h.svc.ProviderHealth(c.Request.Context())})
}

// nullDate returns nil for empty strings so a NULL is written, else the string
// (Postgres assignment-casts 'YYYY-MM-DD' text to date).
func nullDate(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
