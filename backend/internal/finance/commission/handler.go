package commission

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/timeutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the commission config, calculation, and reporting endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ListConfig handles GET /finance/commission/config — returns every config row
// grouped by service_category (with a flat list too for convenience).
func (h *Handler) ListConfig(c *gin.Context) {
	category := c.Query("category")
	activeOnly := c.Query("active") == "true"

	configs, err := h.svc.ListConfig(c.Request.Context(), category, activeOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	grouped := map[string][]Config{}
	for _, cfg := range configs {
		grouped[cfg.ServiceCategory] = append(grouped[cfg.ServiceCategory], cfg)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "configs": configs, "grouped": grouped, "count": len(configs)})
}

// CreateConfig handles POST /finance/commission/config.
func (h *Handler) CreateConfig(c *gin.Context) {
	var in ConfigInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if !validFeeModel(in.FeeModel) || !validFeePayer(in.FeePayer) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid fee_model or fee_payer"})
		return
	}
	saved, err := h.svc.CreateConfig(c.Request.Context(), in, ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "config": saved})
}

// UpdateConfig handles PUT /finance/commission/config/:id.
func (h *Handler) UpdateConfig(c *gin.Context) {
	id := c.Param("id")
	var in ConfigInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if !validFeeModel(in.FeeModel) || !validFeePayer(in.FeePayer) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid fee_model or fee_payer"})
		return
	}
	saved, err := h.svc.UpdateConfig(c.Request.Context(), id, in, ginutil.UserID(c))
	if err != nil {
		if errors.Is(err, ErrConfigNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "config": saved})
}

// ToggleConfig handles POST /finance/commission/config/:id/toggle.
// Body: {"active": true|false}. Absent body toggles based on ?active= query.
func (h *Handler) ToggleConfig(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Active *bool `json:"active"`
	}
	_ = c.ShouldBindJSON(&body)

	active := true
	switch {
	case body.Active != nil:
		active = *body.Active
	case c.Query("active") != "":
		active = c.Query("active") == "true"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "active flag required"})
		return
	}

	saved, err := h.svc.SetActive(c.Request.Context(), id, active, ginutil.UserID(c))
	if err != nil {
		if errors.Is(err, ErrConfigNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "config": saved})
}

// Calculate handles POST /finance/commission/calculate.
func (h *Handler) Calculate(c *gin.Context) {
	var req CalcRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	res, err := h.svc.Calculate(c.Request.Context(), req.ServiceCategory, req.Service, req.ServiceSubtype, req.AmountKobo)
	if err != nil {
		if errors.Is(err, ErrConfigNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no active config for service"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": res})
}

// Report handles GET /finance/commission/report?from&to&groupBy=category|service|day.
func (h *Handler) Report(c *gin.Context) {
	from, to, err := parseRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	groupBy := c.DefaultQuery("groupBy", "category")
	rows, err := h.svc.ProfitReport(c.Request.Context(), from, to, groupBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "groupBy": groupBy, "from": from, "to": to, "rows": rows})
}

// ListEarnings handles GET /finance/commission/earnings?from&to&category&limit.
func (h *Handler) ListEarnings(c *gin.Context) {
	from, to, err := parseRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	category := c.Query("category")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	earnings, err := h.svc.ListEarnings(c.Request.Context(), from, to, category, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "earnings": earnings, "count": len(earnings), "limit": limit})
}

// parseRange reads ?from & ?to (RFC3339 or YYYY-MM-DD). Defaults to the last 30
// days when absent. to is exclusive; a date-only "to" is bumped to end-of-day.
func parseRange(c *gin.Context) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	from := now.AddDate(0, 0, -30)
	to := now

	if v := c.Query("from"); v != "" {
		t, err := parseTime(v, false)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid 'from' date")
		}
		from = t
	}
	if v := c.Query("to"); v != "" {
		t, err := parseTime(v, true)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid 'to' date")
		}
		to = t
	}
	return from, to, nil
}

func parseTime(v string, endOfDayIfDateOnly bool) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.UTC(), nil
	}
	t, err := timeutil.ParseDate(v)
	if err != nil || t.IsZero() {
		return time.Time{}, errors.New("invalid date")
	}
	if endOfDayIfDateOnly {
		return t.Add(24 * time.Hour), nil // exclusive end-of-day
	}
	return t, nil
}

func validFeeModel(m string) bool {
	switch FeeModel(m) {
	case "", FeeModelCommission, FeeModelPlatformCharge, FeeModelFixed, FeeModelCommissionPlusFee, FeeModelNone:
		return true
	}
	return false
}

func validFeePayer(p string) bool {
	switch p {
	case "", FeePayerCustomer, FeePayerProvider, FeePayerMerchant, FeePayerNone:
		return true
	}
	return false
}

// RBAC permission strings — match the finance naming style (finance.<mod>.<verb>).
const (
	PermRead   = "finance.commission.read"
	PermManage = "finance.commission.manage"
)

// RegisterCommission wires the central Commission & Profit management module.
//   - member: mounted under the finance member group as /api/finance/commission/*
//     (auth via the finance group's RequireAuthContext + requireUserID).
//   - admin : the module's config/report surface all live under the member prefix
//     per the API contract; the admin group is accepted for signature symmetry
//     with sibling finance registrations and reserved for future ops-only routes.
//
// Every write is RBAC-guarded (finance.commission.manage) and audited; reads and
// the integration-facing calculate endpoint require finance.commission.read.
// ledgerSvc may be nil (earnings still record; revenue recognition is skipped).
func RegisterCommission(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, ledgerSvc *ledger.Service, enabled bool) {
	if !enabled {
		return
	}
	if pool == nil {
		log.Println("[commission] nil pool — skipping commission routes")
		return
	}

	// Avoid the typed-nil-interface trap: only assign a NON-nil concrete ledger so
	// the service's `!= nil` guard is meaningful.
	var ls ledgerService
	if ledgerSvc != nil {
		ls = ledgerSvc
	}

	svc := NewService(NewRepository(pool), ls)
	h := NewHandler(svc)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	grp := member.Group("/commission")
	grp.GET("/config", guard(PermRead), h.ListConfig)
	grp.POST("/config", guard(PermManage), h.CreateConfig)
	grp.PUT("/config/:id", guard(PermManage), h.UpdateConfig)
	grp.POST("/config/:id/toggle", guard(PermManage), h.ToggleConfig)
	grp.POST("/calculate", guard(PermRead), h.Calculate)
	grp.GET("/report", guard(PermRead), h.Report)
	grp.GET("/earnings", guard(PermRead), h.ListEarnings)

	log.Println("[commission] routes registered at /api/finance/commission — config / calculate / report / earnings")
}
