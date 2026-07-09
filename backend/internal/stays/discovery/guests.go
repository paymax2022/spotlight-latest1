package discovery

// Saved guests — a member's stored fellow-traveller profiles for fast checkout
// prefill. Non-money, per-member scoped (user_id from the auth context). Same
// Handler / pgx pool as the rest of the discovery surface; additive.

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SavedGuest is a stored traveller profile row.
type SavedGuest struct {
	ID        string `json:"id"`
	FullName  string `json:"full_name"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
	IsLead    bool   `json:"is_lead"`
	CreatedAt string `json:"created_at"`
}

// ListSavedGuests handles GET /api/finance/stays/saved-guests — the caller's
// saved guests (oldest-first). 401 when unauthenticated.
func (h *Handler) ListSavedGuests(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	const sql = `
		SELECT id::text, full_name, email, phone, is_lead, created_at
		FROM public.stays_saved_guests
		WHERE user_id=$1
		ORDER BY created_at`
	rows, err := h.db.Query(c.Request.Context(), sql, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]SavedGuest, 0)
	for rows.Next() {
		var g SavedGuest
		var createdAt any
		if err := rows.Scan(&g.ID, &g.FullName, &g.Email, &g.Phone, &g.IsLead, &createdAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		g.CreatedAt = timeString(createdAt)
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AddSavedGuest handles POST /api/finance/stays/saved-guests — creates a saved
// guest for the caller and returns the created row. 401 when unauthenticated.
func (h *Handler) AddSavedGuest(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Phone    string `json:"phone"`
		IsLead   bool   `json:"is_lead"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.FullName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "full_name required"})
		return
	}
	const sql = `
		INSERT INTO public.stays_saved_guests (user_id, full_name, email, phone, is_lead)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id::text, full_name, email, phone, is_lead, created_at`
	var g SavedGuest
	var createdAt any
	if err := h.db.QueryRow(c.Request.Context(), sql, uid, body.FullName, body.Email, body.Phone, body.IsLead).
		Scan(&g.ID, &g.FullName, &g.Email, &g.Phone, &g.IsLead, &createdAt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	g.CreatedAt = timeString(createdAt)
	c.JSON(http.StatusCreated, gin.H{"data": g})
}

// RemoveSavedGuest handles DELETE /api/finance/stays/saved-guests/:id — deletes
// one of the caller's saved guests. Idempotent. 401 when unauthenticated.
func (h *Handler) RemoveSavedGuest(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	id := c.Param("id")
	if _, err := h.db.Exec(c.Request.Context(),
		`DELETE FROM public.stays_saved_guests WHERE user_id=$1 AND id=$2`, uid, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// timeString renders a scanned timestamp value as an RFC3339 string (or "").
func timeString(v any) string {
	switch t := v.(type) {
	case interface{ Format(string) string }:
		return t.Format("2006-01-02T15:04:05Z07:00")
	case string:
		return t
	default:
		return ""
	}
}
