// Package invite exposes member-facing referral invite/vanity-link endpoints
// (M-INV-05). Vanity links are NON-money UTM aliases: no ledger, no wallet.
// Responses are BARE JSON (no {data} wrapper) to match the other referral
// handlers. Reads/writes are scoped to the caller's user_id.
package invite

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes referral vanity-link endpoints on the finance member group.
type Handler struct {
	db *pgxpool.Pool
}

// NewHandler builds an invite handler bound to the shared pgx pool.
func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db}
}

// vanityRow is the bare JSON shape the mobile VanityLink type maps from.
type vanityRow struct {
	ID        string  `json:"id"`
	Alias     string  `json:"alias"`
	URL       string  `json:"url"`
	Source    *string `json:"source"`
	Campaign  *string `json:"campaign"`
	Clicks    int     `json:"clicks"`
	Signups   int     `json:"signups"`
	CreatedAt string  `json:"created_at"`
}

type createVanityInput struct {
	Alias    string `json:"alias"`
	Source   string `json:"source"`
	Campaign string `json:"campaign"`
}

const vanityBaseURL = "https://spot.ng/r/"

// ListVanity handles GET /api/finance/referral/invite/vanity — the caller's
// vanity links, newest first, as a bare JSON array.
func (h *Handler) ListVanity(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	const q = `
		SELECT id, alias, source, campaign, clicks, signups, created_at
		FROM public.referral_vanity_links
		WHERE user_id = $1
		ORDER BY created_at DESC`
	rows, err := h.db.Query(c.Request.Context(), q, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	out := make([]vanityRow, 0)
	for rows.Next() {
		vr, scanErr := scanVanity(rows)
		if scanErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": scanErr.Error()})
			return
		}
		out = append(out, vr)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// CreateVanity handles POST /api/finance/referral/invite/vanity — create (or
// return the existing) vanity link for {alias, source?, campaign?}. Alias is
// normalized (lowercase, spaces → '-'). Idempotent per (user_id, alias).
func (h *Handler) CreateVanity(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var in createVanityInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	alias := normalizeAlias(in.Alias)
	if alias == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "alias required"})
		return
	}
	source := trimToPtr(in.Source)
	campaign := trimToPtr(in.Campaign)

	ctx := c.Request.Context()
	const insertQ = `
		INSERT INTO public.referral_vanity_links (user_id, alias, source, campaign)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, alias) DO NOTHING
		RETURNING id, alias, source, campaign, clicks, signups, created_at`
	vr, err := scanVanity(h.db.QueryRow(ctx, insertQ, userID, alias, source, campaign))
	if errors.Is(err, pgx.ErrNoRows) {
		// Conflict: fetch the existing row (same shape).
		const fetchQ = `
			SELECT id, alias, source, campaign, clicks, signups, created_at
			FROM public.referral_vanity_links
			WHERE user_id = $1 AND alias = $2`
		vr, err = scanVanity(h.db.QueryRow(ctx, fetchQ, userID, alias))
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, vr)
}

// rowScanner abstracts pgx.Row / pgx.Rows so one scan helper serves both paths.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanVanity(s rowScanner) (vanityRow, error) {
	var (
		vr        vanityRow
		source    *string
		campaign  *string
		createdAt time.Time
	)
	if err := s.Scan(&vr.ID, &vr.Alias, &source, &campaign, &vr.Clicks, &vr.Signups, &createdAt); err != nil {
		return vanityRow{}, err
	}
	vr.Source = source
	vr.Campaign = campaign
	vr.URL = vanityBaseURL + vr.Alias
	vr.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return vr, nil
}

// normalizeAlias lowercases and turns runs of whitespace into single hyphens.
func normalizeAlias(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return ""
	}
	return strings.Join(strings.Fields(trimmed), "-")
}

func trimToPtr(raw string) *string {
	t := strings.TrimSpace(raw)
	if t == "" {
		return nil
	}
	return &t
}
