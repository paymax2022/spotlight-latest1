package house

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes admin house-ledger views (RBAC referral.house.view).
type Handler struct {
	svc *Service
	db  *pgxpool.Pool
}

func NewHandler(svc *Service, db *pgxpool.Pool) *Handler {
	return &Handler{svc: svc, db: db}
}

// GetGlobal returns the resolved global house account (A-USR-05 header).
func (h *Handler) GetGlobal(c *gin.Context) {
	acc, err := h.svc.GetOrCreateGlobalHouse(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, acc)
}

// Ledger returns the house-captured reward ledger rows + aggregate (A-USR-05).
// House accruals are non-withdrawable notional credits, segmented from user
// payouts and excluded from override chains / K-factor.
func (h *Handler) Ledger(c *gin.Context) {
	acc, err := h.svc.GetOrCreateGlobalHouse(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()

	const aggQ = `
		SELECT COUNT(*), COALESCE(SUM(amount_kobo), 0)
		FROM referral_reward_ledger
		WHERE house_account_id = $1`
	var count int
	var totalKobo int64
	if err := h.db.QueryRow(ctx, aggQ, acc.ID).Scan(&count, &totalKobo); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	const rowsQ = `
		SELECT id, referred_user_id, kind, state, amount_kobo, currency,
		       excluded_from_override, excluded_from_kfactor, created_at
		FROM referral_reward_ledger
		WHERE house_account_id = $1
		ORDER BY created_at DESC
		LIMIT 200`
	rows, err := h.db.Query(ctx, rowsQ, acc.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	entries := make([]gin.H, 0, count)
	for rows.Next() {
		var (
			id          string
			referred    *string
			kind, state string
			amount      int64
			currency    string
			exclOv      bool
			exclK       bool
		)
		var createdAt any
		if err := rows.Scan(&id, &referred, &kind, &state, &amount, &currency, &exclOv, &exclK, &createdAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		entries = append(entries, gin.H{
			"id":                     id,
			"referred_user_id":       referred,
			"kind":                   kind,
			"state":                  state,
			"amount_kobo":            amount,
			"currency":               currency,
			"excluded_from_override": exclOv,
			"excluded_from_kfactor":  exclK,
			"created_at":             createdAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"house":            acc,
		"non_withdrawable": acc.NonWithdrawable,
		"total_count":      count,
		"total_kobo":       totalKobo,
		"entries":          entries,
	})
}
