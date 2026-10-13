package connectconsole

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// UnderageFlag mirrors frontend-admin UnderageFlag. The declared DOB is masked to century and day only.
type UnderageFlag struct {
	ID             string  `json:"id"`
	UserID         string  `json:"user_id"`
	Handle         string  `json:"handle"`
	Signal         string  `json:"signal"`
	DeclaredDOBMsk string  `json:"declared_dob_masked"`
	Status         string  `json:"status"`
	CaseID         *string `json:"case_id"` // flags are not linked to cases in the data model: always null
	CreatedAt      string  `json:"created_at"`
}

// MediaReviewItem mirrors frontend-admin MediaReviewItem. The media URL is never returned. AI reason codes and
// confidence are not stored: an empty list and 0, never invented.
type MediaReviewItem struct {
	ID            string   `json:"id"`
	UserID        string   `json:"user_id"`
	Handle        string   `json:"handle"`
	MediaKind     string   `json:"media_kind"`
	AIReasonCodes []string `json:"ai_reason_codes"`
	AIConfidence  float64  `json:"ai_confidence"`
	State         string   `json:"state"`
	SubmittedAt   string   `json:"submitted_at"`
}

type mediaRow struct {
	ID, UserID string
	Handle     *string
	Kind       string
	SortOrder  int
	Status     string
	CreatedAt  time.Time
}

// underageState maps the stored status (queued/cleared/banned) to the console's; "" excludes the row.
func underageState(s string) string {
	switch s {
	case "queued":
		return "open"
	case "banned":
		return "confirmed_minor"
	case "cleared":
		return "cleared"
	}
	return ""
}

// underageSignal maps the stored reason to a console signal. Only the age-gate reason exists today;
// anything unrecognised is shown as a generic report rather than guessed.
func underageSignal(reason string) string {
	switch reason {
	case "under_18_at_age_gate":
		return "dob_under_18"
	case "age_estimation", "report", "document_mismatch":
		return reason
	}
	return "report"
}

// maskDOB keeps only the century and the day of month ("20••-••-14"), which identifies nothing on its own.
func maskDOB(d *time.Time) string {
	if d == nil {
		return ""
	}
	return fmt.Sprintf("%02d••-••-%02d", d.Year()/100, d.Day())
}

func mediaKind(kind string, sort int) string {
	if kind == "photo" && sort == 0 {
		return "profile_photo"
	}
	return "gallery"
}

func handleOf(name *string, userID string) string {
	if h := strings.TrimSpace(str(name)); h != "" {
		return h
	}
	return "user " + userID
}

func mediaItemOf(r mediaRow) MediaReviewItem {
	return MediaReviewItem{
		ID: r.ID, UserID: r.UserID, Handle: handleOf(r.Handle, r.UserID), MediaKind: mediaKind(r.Kind, r.SortOrder),
		AIReasonCodes: []string{}, AIConfidence: 0, State: r.Status, SubmittedAt: r.CreatedAt.UTC().Format(time.RFC3339),
	}
}

var underageStatuses = map[string][]string{
	"all": {"queued", "banned", "cleared"}, "open": {"queued"}, "confirmed_minor": {"banned"}, "cleared": {"cleared"},
}

func parseUnderageStatus(s string) (string, bool) {
	if s == "" {
		return "all", true
	}
	_, ok := underageStatuses[s]
	return s, ok
}

var mediaStates = map[string][]string{
	"all": {"pending", "approved", "rejected"}, "pending": {"pending"}, "approved": {"approved"}, "rejected": {"rejected"},
}

func parseMediaState(s string) (string, bool) {
	if s == "" {
		return "all", true
	}
	_, ok := mediaStates[s]
	return s, ok
}

// ListUnderage returns the underage flag queue (open first, then newest) plus has_more.
func (s *Service) ListUnderage(ctx context.Context, status string, limit int) ([]UnderageFlag, bool, error) {
	rows, err := s.db.Query(ctx, `SELECT f.id::text, f.user_id::text, p.display_name, f.reason, f.dob, f.status, f.created_at
		FROM connect_underage_flags f
		LEFT JOIN LATERAL (SELECT display_name FROM connect_profiles WHERE user_id = f.user_id ORDER BY created_at LIMIT 1) p ON true
		WHERE f.status = ANY($1)
		ORDER BY (f.status = 'queued') DESC, f.created_at DESC, f.id DESC LIMIT $2`, underageStatuses[status], limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("connect: list underage flags: %w", err)
	}
	defer rows.Close()
	out := make([]UnderageFlag, 0, limit)
	for rows.Next() {
		var id, uid, reason, st string
		var name *string
		var dob *time.Time
		var at time.Time
		if err := rows.Scan(&id, &uid, &name, &reason, &dob, &st, &at); err != nil {
			return nil, false, err
		}
		state := underageState(st)
		if state == "" {
			continue
		}
		out = append(out, UnderageFlag{ID: id, UserID: uid, Handle: handleOf(name, uid), Signal: underageSignal(reason),
			DeclaredDOBMsk: maskDOB(dob), Status: state, CreatedAt: at.UTC().Format(time.RFC3339)})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		return out[:limit], true, nil
	}
	return out, false, nil
}

// ListMedia returns the media moderation queue (pending first, then newest) plus has_more.
func (s *Service) ListMedia(ctx context.Context, state string, limit int) ([]MediaReviewItem, bool, error) {
	rows, err := s.db.Query(ctx, `SELECT m.id::text, p.user_id::text, p.display_name, m.kind, m.sort_order, m.moderation_status, m.created_at
		FROM connect_profile_media m
		JOIN connect_profiles p ON p.id = m.profile_id AND p.deleted_at IS NULL
		WHERE m.moderation_status = ANY($1)
		ORDER BY (m.moderation_status = 'pending') DESC, m.created_at DESC, m.id DESC LIMIT $2`, mediaStates[state], limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("connect: list media: %w", err)
	}
	defer rows.Close()
	out := make([]MediaReviewItem, 0, limit)
	for rows.Next() {
		var r mediaRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Handle, &r.Kind, &r.SortOrder, &r.Status, &r.CreatedAt); err != nil {
			return nil, false, err
		}
		out = append(out, mediaItemOf(r))
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		return out[:limit], true, nil
	}
	return out, false, nil
}

// Underage — GET /api/connect/admin/underage?status=&limit=   (RBAC connect.underage.review)
func (h *Handler) Underage(c *gin.Context) {
	status, ok := parseUnderageStatus(c.Query("status"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, keyError: "invalid status"})
		return
	}
	list, more, err := h.svc.ListUnderage(c.Request.Context(), status, userLimit(c.Query("limit")))
	if err != nil {
		internalErr(c, "list underage", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "has_more": more})
}

// MediaReview — GET /api/connect/admin/media-review?state=&limit=   (RBAC connect.moderation.view)
func (h *Handler) MediaReview(c *gin.Context) {
	state, ok := parseMediaState(c.Query("state"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, keyError: "invalid state"})
		return
	}
	list, more, err := h.svc.ListMedia(c.Request.Context(), state, userLimit(c.Query("limit")))
	if err != nil {
		internalErr(c, "list media", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "has_more": more})
}
