package admin

import (
	"net/http"

	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
)

// The moderation console speaks pending_review|approved|rejected|needs_changes;
// stays_property.status is DRAFT|PENDING_REVIEW|ACTIVE|SUSPENDED (CHECK-constrained).
// This is the single translation point between the two vocabularies. Raw DB
// values are also accepted so existing callers of POST /properties/:id/status
// keep working.
var moderationToDB = map[string]string{
	"pending_review": "PENDING_REVIEW",
	"approved":       "ACTIVE",
	"rejected":       "SUSPENDED",
	"needs_changes":  "DRAFT",
	"PENDING_REVIEW": "PENDING_REVIEW",
	"ACTIVE":         "ACTIVE",
	"SUSPENDED":      "SUSPENDED",
	"DRAFT":          "DRAFT",
}

func moderationDBStatus(s string) (string, bool) {
	v, ok := moderationToDB[s]
	return v, ok
}

func moderationUIStatus(db string) string {
	switch db {
	case "ACTIVE":
		return "approved"
	case "SUSPENDED":
		return "rejected"
	case "DRAFT":
		return "needs_changes"
	default:
		return "pending_review"
	}
}

// ListModeration (admin): GET /properties?status= — direct-rail listings for the
// moderation queue. status uses the console vocabulary (or the raw DB one).
func (h *Handler) ListModeration(c *gin.Context) {
	dbStatus := ""
	if s := c.Query("status"); s != "" {
		v, ok := moderationDBStatus(s)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "unknown status filter"})
			return
		}
		dbStatus = v
	}
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT p.id, p.name, p.city, p.star_rating, p.status, p.updated_at,
		       (SELECT count(*) FROM public.stays_room_type rt WHERE rt.property_id = p.id),
		       (SELECT count(*) FROM public.stays_property_photo ph WHERE ph.property_id = p.id)
		FROM public.stays_property p
		WHERE p.source_rail = 'DIRECT' AND ($1 = '' OR p.status = $1)
		ORDER BY p.updated_at DESC
		LIMIT 200`, dbStatus)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	defer rows.Close()
	out := []gin.H{}
	for rows.Next() {
		var id, name, city, status string
		var stars, rooms, photos int
		var updated any
		if err := rows.Scan(&id, &name, &city, &stars, &status, &updated, &rooms, &photos); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		out = append(out, gin.H{
			"id": id, "property_name": name, "city": city, "star_rating": stars,
			"rooms": rooms, "photos_count": photos, "status": moderationUIStatus(status),
			"hotelier_masked": "", "flags": []string{}, "submitted_at": updated,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
