package restaurant

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Admin (ops-console) HTTP handlers for /api/restaurant/admin/*.
// Every route here is mounted behind RequireAuthContext + RequirePermission
// (restaurant.admin.{dispatch,onboarding,payouts}) in the app router; these
// handlers therefore assume an authenticated, authorized admin. Reads are thin
// projections; the two mutations (manual assign, onboarding decision) drive the
// existing idempotent state transitions. Disputes are intentionally NOT handled
// here — the console reuses the existing /api/finance/{disputes,admin/disputes}
// finance routes.

// AdminListRiders → GET /api/restaurant/admin/riders (restaurant.admin.dispatch).
// Rider roster + live status from the shared transport driver pool.
// Paged: ?status, ?vehicle, ?q, ?sort=recent|name|rating, ?limit (default 25,
// max 200), ?offset. `status_counts` spans every status under the OTHER filters
// so the board's tiles are not scoped to the page on screen.
// An unknown ?status is a 400, not a silently empty roster.
func (h *Handler) AdminListRiders(c *gin.Context) {
	if !ValidateRiderStatus(c.Query("status")) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":            "unknown rider status filter",
			"allowed_statuses": riderStatuses,
		})
		return
	}
	page, err := h.svc.AdminListRidersPage(c.Request.Context(), AdminRiderParams{
		Status:  c.Query("status"),
		Vehicle: c.Query("vehicle"),
		Query:   c.Query("q"),
		Sort:    c.Query("sort"),
		Limit:   queryInt(c, "limit"),
		Offset:  queryInt(c, "offset"),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, page)
}

// AdminDispatchQueue → GET /api/restaurant/admin/dispatch/queue
// (restaurant.admin.dispatch). Orders awaiting or in dispatch.
// Paged: ?dispatch, ?q, ?restaurant_id, ?stalled=1,
// ?sort=waiting|newest|oldest, ?limit (default 25, max 200), ?offset.
// Default order is longest-waiting first — a dispatch board is worked
// worst-first. `stalled_total` and `dispatch_counts` cover the whole filtered
// set, and `stalled_after_minutes` tells the client the SERVER's threshold so it
// does not keep its own copy.
func (h *Handler) AdminDispatchQueue(c *gin.Context) {
	if !ValidateDispatchStatus(c.Query("dispatch")) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":            "unknown dispatch status filter",
			"allowed_dispatch": dispatchStatuses,
		})
		return
	}
	stalled := c.Query("stalled")
	page, err := h.svc.AdminDispatchQueuePage(c.Request.Context(), AdminDispatchParams{
		Dispatch:     c.Query("dispatch"),
		Query:        c.Query("q"),
		RestaurantID: c.Query("restaurant_id"),
		StalledOnly:  stalled == "1" || stalled == "true",
		Sort:         c.Query("sort"),
		Limit:        queryInt(c, "limit"),
		Offset:       queryInt(c, "offset"),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, page)
}

// AdminAssignRider → POST /api/restaurant/admin/orders/:id/assign
// (restaurant.admin.dispatch)  body {rider_id}. Manual ops assignment. Reuses the
// same AssignRider service used by the owner route, but authorizes the actor as
// the restaurant owner so the ops admin can assign on the merchant's behalf.
func (h *Handler) AdminAssignRider(c *gin.Context) {
	var body struct {
		RiderID string `json:"rider_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.AdminAssignRider(c.Request.Context(), c.Param("id"), body.RiderID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminRedispatch → POST /api/restaurant/admin/orders/:id/dispatch
// (restaurant.admin.dispatch). Re-runs rider sourcing for an order still looking
// for a courier.
// WHY A SEPARATE HANDLER FROM Redispatch
// The member handler is OWNER-gated in the handler itself
// (`if actorID != owner { 403 "only the restaurant may re-dispatch" }`), and an
// operator is never the owner — so the ops console's Re-dispatch button, which
// pointed at that route, could only ever answer 403. Re-dispatching is exactly
// the intervention a dispatch operator exists to make.
// RBAC is the security boundary here, as it is for the admin store routes: this
// is mounted behind restaurant.admin.dispatch. It calls the SAME idempotent
// DispatchOrder the owner path uses — no second sourcing implementation.
func (h *Handler) AdminRedispatch(c *gin.Context) {
	if err := h.svc.DispatchOrder(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminListApplications → GET /api/restaurant/admin/onboarding?status=
// (restaurant.admin.onboarding). Restaurant merchant records awaiting KYC review.
func (h *Handler) AdminListApplications(c *gin.Context) {
	apps, err := h.svc.AdminListApplications(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	if apps == nil {
		apps = []AdminApplication{}
	}
	c.JSON(http.StatusOK, apps)
}

// AdminDecideApplication → POST /api/restaurant/admin/onboarding/:id/decision
// (restaurant.admin.onboarding)  body {decision:'approve'|'reject', note}.
// Idempotent: approve opens the restaurant, reject keeps it closed. The frontend
// also targets /onboarding/:id/approve and /onboarding/:id/reject; both are
// registered and route through here with the decision taken from the path.
func (h *Handler) AdminDecideApplication(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	// Bind is best-effort: the decision may also come from the path segment.
	_ = c.ShouldBindJSON(&body)
	// The path segment carries the decision for /onboarding/:id/{approve,reject}.
	// The literal "decision" segment (/onboarding/:id/decision) is the sentinel for
	// the body-driven form, so fall back to body.Decision in that case.
	decision := c.Param("decision")
	if decision == "" || decision == "decision" {
		decision = body.Decision
	}
	if err := h.svc.AdminDecideApplication(c.Request.Context(), c.Param("id"), adminID, decision, body.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminListPayoutRuns → GET /api/restaurant/admin/payouts (restaurant.admin.payouts).
// Real disbursement runs (restaurant + rider), newest first. Each row is an
// auditable payout run whose net was (or will be) posted to the provider wallet
// via a balanced ledger transfer.
func (h *Handler) AdminListPayoutRuns(c *gin.Context) {
	runs, err := h.svc.ListRuns(c.Request.Context(), 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	if runs == nil {
		runs = []PayoutRun{}
	}
	c.JSON(http.StatusOK, runs)
}

// AdminGetPayoutRun → GET /api/restaurant/admin/payouts/:id (restaurant.admin.payouts).
// A single run plus its append-only provenance lines.
func (h *Handler) AdminGetPayoutRun(c *gin.Context) {
	run, err := h.svc.GetRun(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, ErrPayoutRunNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": httperr.Msg(c, http.StatusNotFound, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, run)
}

// AdminBuildPayoutRun → POST /api/restaurant/admin/payouts/build
// (restaurant.admin.payouts)  body {period_key, provider_type, provider_id}.
// Aggregates settled-but-unpaid settlements for the provider/period into a draft
// run + lines. Idempotent per (provider, period). No money moves at build time.
func (h *Handler) AdminBuildPayoutRun(c *gin.Context) {
	var body struct {
		PeriodKey    string `json:"period_key" binding:"required"`
		ProviderType string `json:"provider_type" binding:"required"`
		ProviderID   string `json:"provider_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	run, err := h.svc.BuildRun(c.Request.Context(), body.PeriodKey, body.ProviderType, body.ProviderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, run)
}

// AdminProcessPayoutRun → POST /api/restaurant/admin/payouts/:id/process
// (restaurant.admin.payouts). Disburses a draft run: posts ONE balanced ledger
// transfer (DR settlement account, CR provider wallet) keyed on the run's
// idempotency_key and flips draft->processing->paid. REQUIRES an Idempotency-Key
// header (money mutation). Idempotent + fail-closed: a duplicate never double-pays.
func (h *Handler) AdminProcessPayoutRun(c *gin.Context) {
	idem := ginutil.IdempotencyKey(c)
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, ErrPayoutMissingIdem)})
		return
	}
	run, err := h.svc.ProcessRun(c.Request.Context(), c.Param("id"), idem)
	if err != nil {
		switch {
		case errors.Is(err, ErrPayoutRunNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": httperr.Msg(c, http.StatusNotFound, err)})
		case errors.Is(err, ErrPayoutMissingIdem), errors.Is(err, ErrPayoutNothingDue):
			c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		default:
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": httperr.Msg(c, http.StatusUnprocessableEntity, err)})
		}
		return
	}
	c.JSON(http.StatusOK, run)
}

// The operator's restaurant register — GET /api/restaurant/admin/restaurants.
// WHY THIS EXISTS
// The admin console listed restaurants by calling the CUSTOMER discovery
// endpoint, which is `WHERE is_open = TRUE` (and, with moderation on, approved
// listings only). So the console showed 2,016 of the 2,227 rows in `restaurants`
// and the 211 it could not see were exactly the ones an operator most needs:
// closed shops, and listings still waiting on review. The page's "Restaurants"
// KPI counted that filtered list, so it read as the platform total.
// This is a register, not a storefront: no is_open filter, no moderation gate,
// and the moderation/KYB columns are projected so the console can say WHY a shop
// is not live. It is fail-closed behind RBAC restaurant.manage at the route.

const (
	defaultAdminRestaurantLimit = 25
	maxAdminRestaurantLimit     = 200
)

// AdminRestaurantParams filters the register. The zero value returns the newest
// page of every restaurant on the platform.
type AdminRestaurantParams struct {
	Query  string // free text over name, address, cuisine
	Status string // open | closed | all (default all)
	Review string // listing_review_status filter (DRAFT|PENDING_REVIEW|APPROVED|…), "" = any
	Sort   string // newest (default) | name | rating | updated
	Limit  int
	Offset int
}

func (p AdminRestaurantParams) normalized() AdminRestaurantParams {
	out := p
	out.Query = strings.TrimSpace(p.Query)
	out.Status = strings.ToLower(strings.TrimSpace(p.Status))
	out.Review = strings.ToUpper(strings.TrimSpace(p.Review))
	if out.Status != "open" && out.Status != "closed" {
		out.Status = "all"
	}
	if out.Limit <= 0 || out.Limit > maxAdminRestaurantLimit {
		out.Limit = defaultAdminRestaurantLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	switch out.Sort {
	case "name", "rating", "updated", "newest":
	default:
		out.Sort = "newest"
	}
	return out
}

// AdminRestaurantRow is one register row: the public restaurant DTO plus the
// operational columns the storefront never exposes.
type AdminRestaurantRow struct {
	Restaurant

	KYBStatus           string    `json:"kyb_status"`
	ListingReviewStatus string    `json:"listing_review_status"`
	ListingReviewReason string    `json:"listing_review_reason,omitempty"`
	UpdatedAt           time.Time `json:"updated_at"`
	// MenuItemCount answers the first question ops asks of an unfamiliar row —
	// whether the shop was ever actually set up, or is an empty shell.
	MenuItemCount int `json:"menu_item_count"`
}

// AdminRestaurantPage is one page of the register plus the totals the console
// header reports.
type AdminRestaurantPage struct {
	Restaurants []AdminRestaurantRow `json:"restaurants"`
	Total       int                  `json:"total"`      // rows matching the current filters
	OpenTotal   int                  `json:"open_total"` // is_open across the SAME filters
	Limit       int                  `json:"limit"`
	Offset      int                  `json:"offset"`
	HasMore     bool                 `json:"has_more"`
}

func buildAdminRestaurantWhere(p AdminRestaurantParams) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	var b strings.Builder
	b.WriteString("WHERE TRUE")
	switch p.Status {
	case "open":
		b.WriteString(" AND r.is_open = TRUE")
	case "closed":
		b.WriteString(" AND r.is_open = FALSE")
	}
	if p.Review != "" {
		b.WriteString(" AND r.listing_review_status = " + ph(p.Review))
	}
	if p.Query != "" {
		like := ph("%" + p.Query + "%")
		b.WriteString(" AND (r.name ILIKE " + like +
			" OR r.address ILIKE " + like +
			" OR COALESCE(r.cuisine,'') ILIKE " + like + ")")
	}
	return b.String(), args
}

// Same unique-tiebreaker rule as discovery: without it, ties in the sort column
// let Postgres reshuffle duplicates between pages.
func adminRestaurantOrderBy(sort string) string {
	switch sort {
	case "name":
		return " ORDER BY r.name ASC, r.id ASC"
	case "rating":
		return " ORDER BY r.rating DESC, r.created_at DESC, r.id DESC"
	case "updated":
		return " ORDER BY r.updated_at DESC, r.id DESC"
	default:
		return " ORDER BY r.created_at DESC, r.id DESC"
	}
}

// AdminListRestaurants returns one page of the register. Unlike discovery it
// applies NO is_open or moderation predicate — every restaurant row is visible
// to an operator.
func (s *Service) AdminListRestaurants(ctx context.Context, params AdminRestaurantParams) (*AdminRestaurantPage, error) {
	p := params.normalized()
	where, args := buildAdminRestaurantWhere(p)

	var total, openTotal int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE r.is_open) FROM restaurants r `+where, args...,
	).Scan(&total, &openTotal); err != nil {
		return nil, err
	}

	full := append([]any{}, args...)
	full = append(full, p.Limit, p.Offset)
	q := `SELECT r.id, r.owner_id, r.name, COALESCE(r.description,''), r.address, r.logo_url, r.is_open, r.rating,
	             COALESCE(r.cuisine,''), r.created_at, r.min_order_kobo, r.packaging_fee_kobo, r.prep_time_minutes,
	             r.geo_lat, r.geo_lng, COALESCE(r.kyb_status,''), r.listing_review_status,
	             COALESCE(r.listing_review_reason,''), r.updated_at,
	             (SELECT COUNT(*) FROM menu_items mi WHERE mi.restaurant_id = r.id)
	      FROM restaurants r ` + where + adminRestaurantOrderBy(p.Sort) +
		" LIMIT $" + strconv.Itoa(len(full)-1) + " OFFSET $" + strconv.Itoa(len(full))

	rows, err := s.db.Query(ctx, q, full...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminRestaurantRow{}
	for rows.Next() {
		var a AdminRestaurantRow
		r := &a.Restaurant
		if err := rows.Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL, &r.IsOpen, &r.Rating,
			&r.Cuisine, &r.CreatedAt, &r.MinOrderKobo, &r.PackagingFeeKobo, &r.PrepTimeMinutes,
			&r.GeoLat, &r.GeoLng, &a.KYBStatus, &a.ListingReviewStatus,
			&a.ListingReviewReason, &a.UpdatedAt, &a.MenuItemCount); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &AdminRestaurantPage{
		Restaurants: out,
		Total:       total,
		OpenTotal:   openTotal,
		Limit:       p.Limit,
		Offset:      p.Offset,
		HasMore:     p.Offset+len(out) < total,
	}, nil
}
