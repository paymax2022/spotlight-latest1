package catalog

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ════════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
//
// KPIs for the insurance admin console.
//
// ⚠️ NULL IS NOT ZERO, and the console renders them differently. A figure we did
// not or could not compute is emitted as null; 0 means "computed, and it is
// zero". Sending 0 for an unknown would tell an operator the module earned no
// commission when in fact nobody asked the question — the two are worlds apart
// on a money screen, and the more confident-looking answer is the wrong one.
//
// Every amount is INTEGER KOBO, summed in the database. No float ever touches a
// money figure on this path.

// Dashboard is the admin KPI payload.
type Dashboard struct {
	// Policies by lifecycle state, e.g. {"ACTIVE": 12, "BIND_FAILED": 1}.
	PoliciesByState map[string]int `json:"policies_by_state"`
	PoliciesTotal   int            `json:"policies_total"`
	PoliciesActive  int            `json:"policies_active"`

	// GrossPremiumKobo is premium on policies that actually BOUND. Quotes and
	// failed binds are excluded — money that was never taken is not revenue.
	GrossPremiumKobo int64 `json:"gross_premium_kobo"`
	// CommissionKobo is Paymax's distributor share on bound policies — the only
	// revenue in this module. Premium itself is a pass-through liability.
	CommissionKobo int64 `json:"commission_kobo"`

	ClaimsTotal      int   `json:"claims_total"`
	ClaimsOpen       int   `json:"claims_open"`
	ClaimsSettled    int   `json:"claims_settled"`
	ClaimsPaidKobo   int64 `json:"claims_paid_kobo"`
	ClaimedTotalKobo int64 `json:"claimed_total_kobo"`

	// LossRatio is claims paid / gross premium. NULL when there is no premium to
	// divide by — an undefined ratio, not a ratio of zero. Reporting 0% "loss"
	// on a book with no premium would read as excellent performance.
	LossRatio *float64 `json:"loss_ratio"`

	// Catalog health.
	ProductsTotal          int    `json:"products_total"`
	ProductsActive         int    `json:"products_active"`
	ProductsPurchasable    int    `json:"products_purchasable"`
	ProductsNotPurchasable int    `json:"products_not_purchasable"`
	LastSyncAt             string `json:"last_sync_at,omitempty"`

	ByCategory    []CategoryStat    `json:"by_category"`
	ByUnderwriter []UnderwriterStat `json:"by_underwriter"`

	// BindingPaused is the launch gate: MyCover settles from a prefunded float,
	// so when this is true no policy can be issued however healthy the rest looks.
	BindingPaused bool `json:"binding_paused"`
	// UnresolvedBinds counts outbound purchases whose outcome we never learned.
	// Each one is a member who may hold cover we cannot see, or be paying for
	// cover that does not exist. Null when the register is unreadable.
	UnresolvedBinds *int `json:"unresolved_binds"`
}

// CategoryStat is one row of the by-category breakdown.
type CategoryStat struct {
	ProductLine      string `json:"product_line"`
	Policies         int    `json:"policies"`
	GrossPremiumKobo int64  `json:"gross_premium_kobo"`
	CommissionKobo   int64  `json:"commission_kobo"`
}

// UnderwriterStat is one row of the by-underwriter breakdown.
type UnderwriterStat struct {
	Underwriter      string `json:"underwriter"`
	Policies         int    `json:"policies"`
	GrossPremiumKobo int64  `json:"gross_premium_kobo"`
	CommissionKobo   int64  `json:"commission_kobo"`
}

// boundStates are the policy states in which cover actually exists and the
// premium was actually taken. Everything else (QUOTED, PENDING_PAYMENT, BINDING,
// BIND_FAILED, PAYMENT_FAILED, VOID) represents money that either never moved or
// was reversed, and must not appear in revenue.
const boundStates = `('ACTIVE','RENEWAL_DUE','EXPIRED','CANCELLED','LAPSED')`

// DashboardStats assembles the admin KPIs.
func (s *Service) DashboardStats(ctx context.Context) (*Dashboard, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("catalog: nil pool")
	}
	d := &Dashboard{
		PoliciesByState: map[string]int{},
		ByCategory:      []CategoryStat{},
		ByUnderwriter:   []UnderwriterStat{},
	}

	// --- Policies by state ---
	rows, err := s.db.Query(ctx, `
		SELECT state, count(*) FROM public.insurance_policy GROUP BY state`)
	if err != nil {
		return nil, fmt.Errorf("catalog: dashboard policy states: %w", err)
	}
	for rows.Next() {
		var state string
		var n int
		if err := rows.Scan(&state, &n); err != nil {
			rows.Close()
			return nil, err
		}
		d.PoliciesByState[state] = n
		d.PoliciesTotal += n
		if state == "ACTIVE" {
			d.PoliciesActive = n
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// --- Money on BOUND policies only ---
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(sum(premium_amount_kobo),0), COALESCE(sum(commission_kobo),0)
		FROM public.insurance_policy
		WHERE state IN `+boundStates).Scan(&d.GrossPremiumKobo, &d.CommissionKobo); err != nil {
		return nil, fmt.Errorf("catalog: dashboard premium: %w", err)
	}

	// --- Claims ---
	if err := s.db.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE state IN ('FNOL_SUBMITTED','UNDER_ASSESSMENT','NEEDS_MORE_INFO','APPROVED','PAYOUT_PENDING')),
		       count(*) FILTER (WHERE state = 'SETTLED'),
		       COALESCE(sum(approved_amount_kobo) FILTER (WHERE state = 'SETTLED'),0),
		       COALESCE(sum(claimed_amount_kobo),0)
		FROM public.insurance_claim`).Scan(
		&d.ClaimsTotal, &d.ClaimsOpen, &d.ClaimsSettled, &d.ClaimsPaidKobo, &d.ClaimedTotalKobo); err != nil {
		return nil, fmt.Errorf("catalog: dashboard claims: %w", err)
	}

	// --- Loss ratio: undefined with no premium, NOT zero ---
	if d.GrossPremiumKobo > 0 {
		// Integer kobo in, one ratio out. The division is the only float on this
		// path and it is a DISPLAY ratio, never an amount.
		ratio := float64(d.ClaimsPaidKobo) / float64(d.GrossPremiumKobo)
		d.LossRatio = &ratio
	}

	// --- Catalog health ---
	if err := s.db.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE active),
		       count(*) FILTER (WHERE purchasable),
		       count(*) FILTER (WHERE NOT purchasable),
		       COALESCE(to_char(max(last_synced_at), 'YYYY-MM-DD"T"HH24:MI:SSOF'),'')
		FROM public.insurance_products`).Scan(
		&d.ProductsTotal, &d.ProductsActive, &d.ProductsPurchasable,
		&d.ProductsNotPurchasable, &d.LastSyncAt); err != nil {
		return nil, fmt.Errorf("catalog: dashboard products: %w", err)
	}

	// --- By product line ---
	catRows, err := s.db.Query(ctx, `
		SELECT COALESCE(p.product_line,'other'), count(*),
		       COALESCE(sum(pol.premium_amount_kobo),0), COALESCE(sum(pol.commission_kobo),0)
		FROM public.insurance_policy pol
		LEFT JOIN public.insurance_products p ON p.code = pol.product_code
		WHERE pol.state IN `+boundStates+`
		GROUP BY 1 ORDER BY 3 DESC`)
	if err != nil {
		return nil, fmt.Errorf("catalog: dashboard by category: %w", err)
	}
	for catRows.Next() {
		var c CategoryStat
		if err := catRows.Scan(&c.ProductLine, &c.Policies, &c.GrossPremiumKobo, &c.CommissionKobo); err != nil {
			catRows.Close()
			return nil, err
		}
		d.ByCategory = append(d.ByCategory, c)
	}
	catRows.Close()
	if err := catRows.Err(); err != nil {
		return nil, err
	}

	// --- By underwriter ---
	uwRows, err := s.db.Query(ctx, `
		SELECT COALESCE(NULLIF(pol.underwriter,''),'(undisclosed)'), count(*),
		       COALESCE(sum(pol.premium_amount_kobo),0), COALESCE(sum(pol.commission_kobo),0)
		FROM public.insurance_policy pol
		WHERE pol.state IN `+boundStates+`
		GROUP BY 1 ORDER BY 3 DESC`)
	if err != nil {
		return nil, fmt.Errorf("catalog: dashboard by underwriter: %w", err)
	}
	for uwRows.Next() {
		var u UnderwriterStat
		if err := uwRows.Scan(&u.Underwriter, &u.Policies, &u.GrossPremiumKobo, &u.CommissionKobo); err != nil {
			uwRows.Close()
			return nil, err
		}
		d.ByUnderwriter = append(d.ByUnderwriter, u)
	}
	uwRows.Close()
	if err := uwRows.Err(); err != nil {
		return nil, err
	}

	// --- Provider float: the launch gate ---
	var pausedCount int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM public.insurance_provider_float WHERE state = 'exhausted'`).Scan(&pausedCount); err == nil {
		d.BindingPaused = pausedCount > 0
	}

	// --- Outbound binds with an unknown outcome ---
	var unresolved int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM public.insurance_provider_bind WHERE state = 'unknown'`).Scan(&unresolved); err == nil {
		d.UnresolvedBinds = &unresolved
	} // else: leave null — "we could not check" is not "there are none"

	return d, nil
}

// AdminDashboard (admin): GET /api/insurance/admin/dashboard
func (h *Handler) AdminDashboard(c *gin.Context) {
	stats, err := h.svc.DashboardStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{
			"code": "dashboard_failed", "message": err.Error(),
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stats})
}
