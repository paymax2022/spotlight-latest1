// Package discovery serves lightweight stays merchandising/discovery reads that
// sit above the supply gateway (destinations autocomplete today; deals/home can
// follow). It is additive — a self-contained handler holding only a pgx pool, so
// it needs no changes to the search/reservation constructors.
package discovery

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes member discovery routes under /api/finance/stays.
type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// Destination is a normalised place suggestion for the search box.
type Destination struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Region        string `json:"region"`
	Kind          string `json:"kind"` // city | landmark | area
	PropertyCount int    `json:"property_count"`
}

// slug lowercases and dashes a city into a stable id.
func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	return s
}

// listDestinations returns distinct ACTIVE cities from the on-platform (DIRECT)
// inventory, ranked by property count. Optional `q` filters case-insensitively.
func (h *Handler) listDestinations(c *gin.Context, q string, limit int) ([]Destination, error) {
	like := "%" + q + "%"
	const sql = `
		SELECT city, count(*)::int AS n
		FROM public.stays_property
		WHERE status = 'ACTIVE'
		  AND city <> ''
		  AND ($1 = '' OR city ILIKE $2)
		GROUP BY city
		ORDER BY n DESC, city ASC
		LIMIT $3`
	rows, err := h.db.Query(c.Request.Context(), sql, q, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Destination, 0, limit)
	for rows.Next() {
		var city string
		var n int
		if err := rows.Scan(&city, &n); err != nil {
			return nil, err
		}
		out = append(out, Destination{ID: slug(city), Name: city, Region: "Nigeria", Kind: "city", PropertyCount: n})
	}
	return out, rows.Err()
}

// Destinations handles GET /api/finance/stays/destinations?q= — distinct cities
// from the on-platform (DIRECT) inventory, ranked by property count. Bedbank
// supply is not indexed locally, so this reflects direct inventory only (gap).
func (h *Handler) Destinations(c *gin.Context) {
	out, err := h.listDestinations(c, strings.TrimSpace(c.Query("q")), 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// DealProperty is the denormalised property-card snapshot embedded in a deal.
type DealProperty struct {
	Rail             string  `json:"rail"`
	Supplier         string  `json:"supplier"`
	Ref              string  `json:"ref"`
	Name             string  `json:"name"`
	City             string  `json:"city"`
	Area             string  `json:"area"`
	Star             int     `json:"star"`
	PropertyType     string  `json:"property_type"`
	LeadPriceKobo    int64   `json:"lead_price_kobo"`
	WasPriceKobo     *int64  `json:"was_price_kobo,omitempty"`
	Currency         string  `json:"currency"`
	CoverURL         string  `json:"cover_url"`
	ReviewScore      float64 `json:"review_score"`
	ReviewCount      int     `json:"review_count"`
	FreeCancellation bool    `json:"free_cancellation"`
}

// Deal is a curated merchandising card for the landing feed.
type Deal struct {
	ID       string       `json:"id"`
	Kind     string       `json:"kind"`
	Title    string       `json:"title"`
	Subtitle string       `json:"subtitle"`
	Property DealProperty `json:"property"`
}

// Deals handles GET /api/finance/stays/deals — active curated deals, ranked by
// sort then recency. Reads the denormalised stays_deals table (no PostGIS join).
func (h *Handler) Deals(c *gin.Context) {
	const sql = `
		SELECT id, kind, title, subtitle,
		       property_rail, property_supplier, property_ref,
		       property_name, city, area, star, property_type,
		       lead_price_kobo, was_price_kobo, currency, cover_url,
		       review_score, review_count, free_cancellation
		FROM public.stays_deals
		WHERE active = true
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at   IS NULL OR ends_at   >= now())
		ORDER BY sort DESC, created_at DESC
		LIMIT 20`
	rows, err := h.db.Query(c.Request.Context(), sql)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]Deal, 0, 20)
	for rows.Next() {
		var d Deal
		var p DealProperty
		if err := rows.Scan(&d.ID, &d.Kind, &d.Title, &d.Subtitle,
			&p.Rail, &p.Supplier, &p.Ref,
			&p.Name, &p.City, &p.Area, &p.Star, &p.PropertyType,
			&p.LeadPriceKobo, &p.WasPriceKobo, &p.Currency, &p.CoverURL,
			&p.ReviewScore, &p.ReviewCount, &p.FreeCancellation); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		d.Property = p
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Saved handles GET /api/finance/stays/saved — the caller's wishlist as a list
// of opaque property keys (most-recent first). The client decodes each key back
// into a PropertyCard. 401 when unauthenticated.
func (h *Handler) Saved(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	const sql = `SELECT property_key FROM public.stays_saved WHERE user_id=$1 ORDER BY created_at DESC`
	rows, err := h.db.Query(c.Request.Context(), sql, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	keys := make([]string, 0)
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": keys})
}

// ToggleSaved handles POST /api/finance/stays/saved/:key/toggle — flips the
// wishlist membership of a property key for the caller. Delete-then-insert makes
// it idempotent: if the key was saved it becomes unsaved (saved=false); if it was
// not saved it becomes saved (saved=true). 401 when unauthenticated.
func (h *Handler) ToggleSaved(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	key := c.Param("key")
	ctx := c.Request.Context()
	tag, err := h.db.Exec(ctx, `DELETE FROM public.stays_saved WHERE user_id=$1 AND property_key=$2`, uid, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	saved := false
	if tag.RowsAffected() == 0 {
		if _, err := h.db.Exec(ctx,
			`INSERT INTO public.stays_saved (user_id, property_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			uid, key); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		saved = true
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"saved": saved}})
}

// staysTier is one rung of the Stays loyalty ladder: the in-window completed-stay
// threshold that unlocks it and the stays discount (in basis points) it grants. The
// discount is capped by the pricing engine's MaxStackedDiscountBps (staysMaxDiscountBps)
// so the snapshot can never advertise more than pricing will actually apply.
type staysTier struct {
	Name        string
	MinInWindow int
	DiscountBps int64
}

// staysMaxDiscountBps mirrors pricing.Config.MaxStackedDiscountBps (D-5; wired as
// 2000 = 20% in app/stays_routes.go). The discovery handler holds only a db pool
// (no pricing dependency, and its constructor is owned elsewhere), so the cap is
// duplicated here as a labelled constant rather than injected. Keep in sync with the
// pricing engine config.
const staysMaxDiscountBps int64 = 2000

// staysTiers is the read-only Stays loyalty ladder the discount snapshot is derived
// from. It matches the client's static tier table (Bronze→Platinum by in-window
// completed stays). Discounts are floored at the stacking cap.
var staysTiers = []staysTier{
	{Name: "Platinum", MinInWindow: 12, DiscountBps: 1500},
	{Name: "Gold", MinInWindow: 6, DiscountBps: 1000},
	{Name: "Silver", MinInWindow: 3, DiscountBps: 500},
	{Name: "Bronze", MinInWindow: 0, DiscountBps: 0},
}

// tierFor returns the highest Stays tier the in-window count qualifies for, with its
// stays discount capped by the stacking cap.
func tierFor(inWindow int) staysTier {
	for _, t := range staysTiers { // ordered high→low
		if inWindow >= t.MinInWindow {
			if t.DiscountBps > staysMaxDiscountBps {
				t.DiscountBps = staysMaxDiscountBps
			}
			return t
		}
	}
	return staysTiers[len(staysTiers)-1]
}

// Loyalty handles GET /api/finance/stays/loyalty — the caller's raw stay counts plus
// a read-only discount snapshot for the tier those counts unlock. The discount is
// derived from the same tier ladder + stacking cap the pricing engine uses
// (staysMaxDiscountBps); there is no wired finance-loyalty/tiers source into this
// handler, so the snapshot is computed here and labelled as such. Read-only.
// Reads the stays_reservation table (created by stays_core).
func (h *Handler) Loyalty(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	ctx := c.Request.Context()
	var completed, inWindow int
	_ = h.db.QueryRow(ctx,
		`SELECT count(*) FROM public.stays_reservation WHERE guest_user_id=$1 AND state='COMPLETED'`,
		uid).Scan(&completed)
	_ = h.db.QueryRow(ctx,
		`SELECT count(*) FROM public.stays_reservation
		 WHERE guest_user_id=$1 AND state='COMPLETED' AND check_out >= now() - interval '12 months'`,
		uid).Scan(&inWindow)

	tier := tierFor(inWindow)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"stays_completed": completed,
		"stays_in_window": inWindow,
		"window_label":    "Last 12 months",
		// Discount snapshot for the current tier. Derived read-only from the same tier
		// ladder + stacking cap the pricing engine applies (no finance-loyalty source
		// is wired into this handler).
		"tier":                  tier.Name,
		"discount_bps":          tier.DiscountBps,
		"discount_percent":      float64(tier.DiscountBps) / 100.0,
		"discount_source":       "stays_tier_ladder",
		"max_discount_bps":      staysMaxDiscountBps,
		"lifetime_savings_kobo": 0,
	}})
}

// HomeFeed is the stays landing payload. deals/recent_searches/saved are empty
// for now (no curated-deals table yet; recent searches + wishlist are client-side)
// — trending_destinations is real, from live inventory.
type HomeFeed struct {
	RecentSearches       []any         `json:"recent_searches"`
	Deals                []any         `json:"deals"`
	TrendingDestinations []Destination `json:"trending_destinations"`
	Saved                []any         `json:"saved"`
}

// Home handles GET /api/finance/stays/home — the discovery landing feed. Today it
// surfaces the top trending destinations from live inventory; deals/wishlist land
// with their own backends (see docs/stays-integration-plan.md).
func (h *Handler) Home(c *gin.Context) {
	trending, err := h.listDestinations(c, "", 8)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": HomeFeed{
		RecentSearches:       []any{},
		Deals:                []any{},
		TrendingDestinations: trending,
		Saved:                []any{},
	}})
}
