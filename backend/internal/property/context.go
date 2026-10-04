// Package property is the Property Management suite unification glue. It turns the
// existing estate (visitor access) module and the realtor agency/portfolio plane
// into sub-modules of a single Property Management umbrella, exposing read-mostly
// cross-module aggregations (role context, rent passport) under /api/finance/property.
// It owns NO money path. Context + rent passport are read/computed aggregations;
// active-context switching is metadata only. The stay→gate-pass moat flow lives in
// the realtor module and reuses the estate pass-issuance seam.
package property

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Service is the Property Management suite aggregation service. All reads are
// scoped to the authenticated user id passed by the handler.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ContextRef is a {type,id} pointer to an entity the user can act within.
// Type is one of: estate | property | agency | org.
type ContextRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// ContextEntity is one entity the caller has a role in, with that role set.
// Type is one of estate | property | agency | org; Roles holds the merged role set
// (e.g. tenant, landlord, estate_admin, resident, agency_owner).
type ContextEntity struct {
	Type  string   `json:"type"`
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Roles []string `json:"roles"`
}

// ContextResponse is the payload for GET /property/context.
type ContextResponse struct {
	ActiveContext *ContextRef     `json:"activeContext"`
	Contexts      []ContextEntity `json:"contexts"`
}

// GetContext aggregates the caller's role assignments across the property graph by
// reading existing tables only (no new writes):
//   - estate_residents      → estate membership + role (resident | estate_admin)
//   - estates.admin_id       → estate ownership (estate_admin)
//   - estate_properties      → per-property landlord / tenant assignments
//   - realtor_portfolios     → agency/portfolio ownership (agency_owner)
//
// Roles are merged per entity (a user may be both landlord and estate_admin). The
// caller's persisted active context (if any) is returned alongside.
func (s *Service) GetContext(ctx context.Context, userID string) (*ContextResponse, error) {
	// entity key "type:id" -> aggregated entity.
	idx := map[string]*ContextEntity{}
	add := func(typ, id, name, role string) {
		if id == "" {
			return
		}
		key := typ + ":" + id
		e, ok := idx[key]
		if !ok {
			e = &ContextEntity{Type: typ, ID: id, Name: name}
			idx[key] = e
		}
		if name != "" && e.Name == "" {
			e.Name = name
		}
		if slices.Contains(e.Roles, role) {
			return
		}
		e.Roles = append(e.Roles, role)
	}

	// Estate membership (resident / estate_admin) joined to the estate name.
	rows, err := s.db.Query(ctx, `
		SELECT r.estate_id::TEXT, COALESCE(e.name,''), r.role
		FROM estate_residents r
		JOIN estates e ON e.id = r.estate_id
		WHERE r.user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: estate memberships: %w", err)
	}
	for rows.Next() {
		var eid, name, role string
		if err := rows.Scan(&eid, &name, &role); err != nil {
			rows.Close()
			return nil, err
		}
		add("estate", eid, name, role)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Estate ownership (admin_id) — guarantees the estate_admin role even when the
	// admin has no estate_residents row.
	rows, err = s.db.Query(ctx, `SELECT id::TEXT, COALESCE(name,'') FROM estates WHERE admin_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: estate ownership: %w", err)
	}
	for rows.Next() {
		var eid, name string
		if err := rows.Scan(&eid, &name); err != nil {
			rows.Close()
			return nil, err
		}
		add("estate", eid, name, "estate_admin")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Per-property landlord / tenant assignments (estate_properties).
	rows, err = s.db.Query(ctx, `
		SELECT id::TEXT, unit_label,
		       COALESCE(landlord_id = $1, FALSE) AS is_landlord,
		       COALESCE(tenant_id   = $1, FALSE) AS is_tenant
		FROM estate_properties
		WHERE landlord_id = $1 OR tenant_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: property assignments: %w", err)
	}
	for rows.Next() {
		var pid, label string
		var isLandlord, isTenant bool
		if err := rows.Scan(&pid, &label, &isLandlord, &isTenant); err != nil {
			rows.Close()
			return nil, err
		}
		if isLandlord {
			add("property", pid, label, "landlord")
		}
		if isTenant {
			add("property", pid, label, "tenant")
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Agency / portfolio ownership (realtor_portfolios).
	rows, err = s.db.Query(ctx, `SELECT id::TEXT, COALESCE(name,'') FROM realtor_portfolios WHERE owner_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: agency portfolios: %w", err)
	}
	for rows.Next() {
		var aid, name string
		if err := rows.Scan(&aid, &name); err != nil {
			rows.Close()
			return nil, err
		}
		add("agency", aid, name, "agency_owner")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := &ContextResponse{Contexts: make([]ContextEntity, 0, len(idx))}
	for _, e := range idx {
		out.Contexts = append(out.Contexts, *e)
	}

	// Active context (best-effort; absence is not an error).
	out.ActiveContext = s.activeContext(ctx, userID)
	return out, nil
}

// activeContext returns the user's persisted active context, or nil.
func (s *Service) activeContext(ctx context.Context, userID string) *ContextRef {
	var typ, id string
	err := s.db.QueryRow(ctx,
		`SELECT context_type, context_id::TEXT FROM property_active_context WHERE user_id=$1`, userID).
		Scan(&typ, &id)
	if err != nil {
		return nil
	}
	return &ContextRef{Type: typ, ID: id}
}

var validContextTypes = map[string]bool{"estate": true, "property": true, "agency": true, "org": true}

// SwitchContext upserts the caller's active context after validating that the
// caller actually holds a role in the target entity (fail-closed: a user cannot
// switch into a context they are not a member of). Returns the new active context.
func (s *Service) SwitchContext(ctx context.Context, userID, contextType, contextID string) (*ContextRef, error) {
	if !validContextTypes[contextType] {
		return nil, fmt.Errorf("property: invalid context_type %q", contextType)
	}
	if contextID == "" {
		return nil, errors.New("property: context_id required")
	}

	// Membership check against the aggregated context (reuses the same derivation
	// so the rule stays in one place).
	cur, err := s.GetContext(ctx, userID)
	if err != nil {
		return nil, err
	}
	allowed := false
	for _, e := range cur.Contexts {
		if e.Type == contextType && e.ID == contextID {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, fmt.Errorf("property: caller has no role in %s %s", contextType, contextID)
	}

	const up = `
		INSERT INTO property_active_context (user_id, context_type, context_id, updated_at)
		VALUES ($1,$2,$3, NOW())
		ON CONFLICT (user_id) DO UPDATE
		   SET context_type = EXCLUDED.context_type,
		       context_id   = EXCLUDED.context_id,
		       updated_at   = NOW()`
	if _, err := s.db.Exec(ctx, up, userID, contextType, contextID); err != nil {
		return nil, fmt.Errorf("property: persist active context: %w", err)
	}
	return &ContextRef{Type: contextType, ID: contextID}, nil
}

// RecentPayment is one normalized rent/dues payment in the passport history.
// AmountKobo is an integer in minor units (kobo) — never a float. OnTime is true
// when the payment landed on/before the invoice due date. Category is e.g. rent,
// service_charge, or lease.
type RecentPayment struct {
	Source     string    `json:"source"` // estate | realtor
	AmountKobo int64     `json:"amountKobo"`
	Category   string    `json:"category"`
	OnTime     bool      `json:"onTime"`
	PaidAt     time.Time `json:"paidAt"`
}

// RentPassport is a portable, read-only trust profile derived from a user's
// historical rent/dues payment behaviour. It is shareable to a prospective
// landlord/agency for tenant screening.
// Score is 0-100 (see the scoring formula on GetRentPassport). OnTimeRate is the
// 0.0-1.0 ratio of on-time payments. TotalPaidKobo is lifetime successful payments
// in kobo.
type RentPassport struct {
	UserID         string          `json:"userId"`
	Score          int             `json:"score"`
	OnTimeRate     float64         `json:"onTimeRate"`
	TotalPaidKobo  int64           `json:"totalPaidKobo"`
	PaymentsCount  int             `json:"paymentsCount"`
	OldestTenancy  *time.Time      `json:"oldestTenancy,omitempty"`
	RecentPayments []RecentPayment `json:"recentPayments"`
}

// rentPassportRecentLimit caps the recentPayments slice (most recent first).
const rentPassportRecentLimit = 20

// GetRentPassport builds the portable trust profile for userID from successful
// rent/dues payments across the estate dues money path (estate_payments +
// estate_dues_invoices) and the realtor lease money path (realtor_payments +
// realtor_invoices + realtor_leases). It is a pure read + computed score — it
// performs no writes and touches no money path.
// Let R = on-time ratio = (# payments made on/before the invoice due date) /
//
//	(# payments that had a due date to compare against).
//
// Payments with no comparable due date are excluded from R (neither help nor hurt)
// but still count toward TotalPaidKobo / PaymentsCount.
// A brand-new user with no comparable payments scores 0 (fail-closed: absence of a
// positive track record is NOT treated as good credit). The formula is intentionally
// simple, transparent, and explainable to the user being screened.
func (s *Service) GetRentPassport(ctx context.Context, userID string) (*RentPassport, error) {
	rp := &RentPassport{UserID: userID, RecentPayments: []RecentPayment{}}

	var onTimeComparable, onTimeMet int

	// estate_payments(status='successful') joined to its invoice for due-date and
	// category. invoice_id may be NULL → no comparable due date.
	estRows, err := s.db.Query(ctx, `
		SELECT p.amount_kobo, p.created_at,
		       COALESCE(i.category,'other') AS category,
		       i.due_date
		FROM estate_payments p
		LEFT JOIN estate_dues_invoices i ON i.id = p.invoice_id
		WHERE p.payer_id = $1 AND p.status = 'successful'
		ORDER BY p.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: estate payments: %w", err)
	}
	for estRows.Next() {
		var amount int64
		var paidAt time.Time
		var category string
		var due *time.Time
		if err := estRows.Scan(&amount, &paidAt, &category, &due); err != nil {
			estRows.Close()
			return nil, err
		}
		rp.TotalPaidKobo += amount
		rp.PaymentsCount++
		onTime := false
		if due != nil {
			onTimeComparable++
			if !paidAt.After(*due) {
				onTimeMet++
				onTime = true
			}
		}
		if len(rp.RecentPayments) < rentPassportRecentLimit {
			rp.RecentPayments = append(rp.RecentPayments, RecentPayment{
				Source: "estate", AmountKobo: amount, Category: category, OnTime: onTime, PaidAt: paidAt,
			})
		}
		if rp.OldestTenancy == nil || paidAt.Before(*rp.OldestTenancy) {
			t := paidAt
			rp.OldestTenancy = &t
		}
	}
	estRows.Close()
	if err := estRows.Err(); err != nil {
		return nil, err
	}

	// realtor_payments(status='paid') → realtor_invoices(due_date) → realtor_leases
	// (start_date as a tenancy anchor). Tolerant of a missing realtor schema: a
	// query error here is treated as "no realtor history" rather than fatal, so the
	// passport still works on estate-only deployments.
	relRows, err := s.db.Query(ctx, `
		SELECT pay.amount_kobo, COALESCE(pay.paid_at, pay.created_at) AS paid_at,
		       inv.due_date, l.start_date
		FROM realtor_payments pay
		JOIN realtor_invoices inv ON inv.id = pay.invoice_id
		JOIN realtor_leases   l   ON l.id   = inv.lease_id
		WHERE pay.user_id = $1 AND pay.status = 'paid'
		ORDER BY paid_at DESC`, userID)
	if err == nil {
		for relRows.Next() {
			var amount int64
			var paidAt time.Time
			var due *time.Time
			var startDate *time.Time
			if err := relRows.Scan(&amount, &paidAt, &due, &startDate); err != nil {
				relRows.Close()
				return nil, err
			}
			rp.TotalPaidKobo += amount
			rp.PaymentsCount++
			onTime := false
			if due != nil {
				onTimeComparable++
				if !paidAt.After(*due) {
					onTimeMet++
					onTime = true
				}
			}
			if len(rp.RecentPayments) < rentPassportRecentLimit {
				rp.RecentPayments = append(rp.RecentPayments, RecentPayment{
					Source: "realtor", AmountKobo: amount, Category: "lease", OnTime: onTime, PaidAt: paidAt,
				})
			}
			anchor := paidAt
			if startDate != nil {
				anchor = *startDate
			}
			if rp.OldestTenancy == nil || anchor.Before(*rp.OldestTenancy) {
				t := anchor
				rp.OldestTenancy = &t
			}
		}
		relRows.Close()
		if err := relRows.Err(); err != nil {
			return nil, err
		}
	}

	// On-time ratio (excludes payments with no comparable due date).
	if onTimeComparable > 0 {
		rp.OnTimeRate = float64(onTimeMet) / float64(onTimeComparable)
	}

	rp.Score = computeRentScore(rp.OnTimeRate, onTimeComparable, rp.OldestTenancy)
	return rp, nil
}

// computeRentScore implements the documented scoring formula.
func computeRentScore(onTimeRate float64, comparable int, oldest *time.Time) int {
	if comparable == 0 {
		return 0 // no positive track record → fail-closed.
	}
	base := int(onTimeRate*90 + 0.5) // round
	tenure := 0
	if oldest != nil {
		months := int(time.Since(*oldest).Hours() / (24 * 30))
		tenure = min((months/6)*2, 10)
	}
	score := min(max(base+tenure, 0), 100)
	return score
}

// Handler exposes the Property Management suite HTTP endpoints. The caller's user
// id is read from the gin context key "user_id" (set by the auth wrapper applied
// in the route registration — same convention as the estate/realtor modules).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GetContext → GET /api/finance/property/context
// Returns the caller's role assignments across estates / properties / agencies and
// their persisted active context.
func (h *Handler) GetContext(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	resp, err := h.svc.GetContext(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// SwitchContext → POST /api/finance/property/context/switch
// Persists the caller's active context after a fail-closed membership check.
func (h *Handler) SwitchContext(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req struct {
		ContextType string `json:"contextType" binding:"required"`
		ContextID   string `json:"contextId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ref, err := h.svc.SwitchContext(c.Request.Context(), userID, req.ContextType, req.ContextID)
	if err != nil {
		// Membership / validation failures are 403/400-shaped; surface as 403 since
		// the common case is "no role in that context" (fail-closed).
		c.JSON(http.StatusForbidden, gin.H{"error": httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"activeContext": ref})
}

// GetMyRentPassport → GET /api/finance/property/rent-passport/me
// Returns the caller's own portable rent/dues trust profile.
func (h *Handler) GetMyRentPassport(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	rp, err := h.svc.GetRentPassport(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, rp)
}

// LookupRentPassport → GET /api/finance/property/rent-passport/lookup/:userId
// Landlord/agency screening view of another user's passport. RBAC-gated upstream
// by RequirePermission(rbac, "property.manage").
func (h *Handler) LookupRentPassport(c *gin.Context) {
	target := c.Param("userId")
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "userId required"})
		return
	}
	rp, err := h.svc.GetRentPassport(c.Request.Context(), target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, rp)
}
