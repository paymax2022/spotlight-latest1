package connectverification

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IdentityReview is one row of the admin verification review queue, in the exact shape the
// admin console renders (frontend-admin IdentityReview). It is a masked, log-safe view: the
// document hash and the evidence pointer are NEVER returned, only a masked reference.
type IdentityReview struct {
	ID            string   `json:"id"`
	UserID        string   `json:"user_id"`
	Handle        string   `json:"handle"`
	DocType       string   `json:"doc_type"`
	BadgeTarget   string   `json:"badge_target"`
	State         string   `json:"state"`
	DocRefMasked  string   `json:"doc_ref_masked"`
	SubmittedAt   string   `json:"submitted_at"`
	LivenessScore *float64 `json:"liveness_score"`
}

// reviewRow is the raw database row before masking.
type reviewRow struct {
	ID        string
	UserID    string
	Handle    *string
	Level     string
	DocType   *string
	DocHash   *string
	Status    string
	CreatedAt time.Time
}

// reviewStatuses maps the console's state filter to the stored statuses. The table holds two
// vocabularies (ADR-PR735): the console states are a view over both. 'none' (never submitted)
// is excluded. 'in_review' has no stored equivalent today and always yields an empty queue.
var reviewStatuses = map[string][]string{
	"pending":   {"pending"},
	"approved":  {"l0_passed", "l1_passed", "approved"},
	"rejected":  {"failed", "rejected"},
	"resubmit":  {"expired"},
	"in_review": {},
	"all":       {"pending", "l0_passed", "l1_passed", "approved", "failed", "rejected", "expired"},
}

func parseReviewState(s string) (string, bool) {
	if s == "" {
		return "all", true
	}
	if _, ok := reviewStatuses[s]; ok {
		return s, true
	}
	return "", false
}

func parseReviewLimit(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 100
	}
	if n > 200 {
		return 200
	}
	return n
}

// mapReviewState turns a stored status into a console state; "" means the row is not a
// submission (or is a status this view does not know) and must be excluded.
func mapReviewState(status string) string {
	switch status {
	case "pending":
		return "pending"
	case "l0_passed", "l1_passed", "approved":
		return "approved"
	case "failed", "rejected":
		return "rejected"
	case "expired":
		return "resubmit"
	}
	return ""
}

func normalizeDocType(d *string) string {
	if d == nil || strings.TrimSpace(*d) == "" {
		return "selfie_liveness"
	}
	n := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(*d)), " ", "_")
	switch n {
	case "national_id", "passport", "drivers_license", "bvn", "nin", "selfie_liveness":
		return n
	}
	return "national_id"
}

func badgeTarget(level, docType string) string {
	switch docType {
	case "bvn":
		return "bvn"
	case "nin":
		return "nin"
	case "national_id", "passport", "drivers_license":
		return "id"
	}
	switch level {
	case "l3":
		return "full"
	case "l2":
		return "id"
	}
	return "selfie"
}

func isHex(s string) bool {
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return s != ""
}

// maskRef renders "NIN ••••9f3a": the document label plus the last four characters of the
// non-reversible HMAC. Never the hash itself, never the evidence pointer.
func maskRef(docType string, hash *string) string {
	label := "SELFIE"
	if docType != "selfie_liveness" {
		label = strings.ToUpper(strings.ReplaceAll(docType, "_", " "))
	}
	suffix := ""
	if hash != nil && len(*hash) >= 4 {
		if tail := (*hash)[len(*hash)-4:]; isHex(tail) {
			suffix = strings.ToLower(tail)
		}
	}
	return label + " ••••" + suffix
}

func mapReviewRow(r reviewRow) (IdentityReview, bool) {
	state := mapReviewState(r.Status)
	if state == "" {
		return IdentityReview{}, false
	}
	dt := normalizeDocType(r.DocType)
	handle := ""
	if r.Handle != nil {
		handle = strings.TrimSpace(*r.Handle)
	}
	if handle == "" {
		short := r.UserID
		if len(short) > 8 {
			short = short[:8]
		}
		handle = "user " + short
	}
	return IdentityReview{
		ID: r.ID, UserID: r.UserID, Handle: handle, DocType: dt,
		BadgeTarget:  badgeTarget(r.Level, dt),
		State:        state,
		DocRefMasked: maskRef(dt, r.DocHash),
		SubmittedAt:  r.CreatedAt.UTC().Format(time.RFC3339),
		// Liveness scores are not stored (only a pass/fail outcome), so this is null, never invented.
		LivenessScore: nil,
	}, true
}

// ReviewQueue serves the read-only admin verification review queue.
type ReviewQueue struct{ db *pgxpool.Pool }

// NewReviewQueue wraps a pool.
func NewReviewQueue(db *pgxpool.Pool) *ReviewQueue { return &ReviewQueue{db: db} }

// Handler serves GET /api/connect/admin/identity?state=&limit=. The route must be guarded
// by the connect.verification.view permission.
func (q *ReviewQueue) Handler(c *gin.Context) {
	state, ok := parseReviewState(c.Query("state"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, keyError: "invalid state"})
		return
	}
	statuses := reviewStatuses[state]
	out := []IdentityReview{} // never null
	if len(statuses) > 0 {
		rows, err := q.db.Query(c.Request.Context(), `
			SELECT v.id::text, v.user_id::text, p.display_name, v.level, v.doc_type, v.doc_hash, v.status, v.created_at
			  FROM connect_verification v
			  LEFT JOIN LATERAL (
			    SELECT display_name FROM connect_profiles
			     WHERE user_id = v.user_id AND deleted_at IS NULL
			     ORDER BY created_at LIMIT 1
			  ) p ON true
			 WHERE v.status = ANY($1)
			 ORDER BY (v.status = 'pending') DESC, v.created_at DESC
			 LIMIT $2`, statuses, parseReviewLimit(c.Query("limit")))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, keyError: "internal"})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var r reviewRow
			if err := rows.Scan(&r.ID, &r.UserID, &r.Handle, &r.Level, &r.DocType, &r.DocHash, &r.Status, &r.CreatedAt); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, keyError: "internal"})
				return
			}
			if m, ok := mapReviewRow(r); ok {
				out = append(out, m)
			}
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, keyError: "internal"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}
