package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/services"
)

// RegistrationAdminStore provides admin-side data access over the registration
// funnel: the reviewer's queue, single-entry lookup, and the status transitions
// that move an entry through review and — on approval — onto the voting roster.
type RegistrationAdminStore struct {
	db *pgxpool.Pool
}

func NewRegistrationAdminStore(db *pgxpool.Pool) *RegistrationAdminStore {
	return &RegistrationAdminStore{db: db}
}

// AdminRegistration is one row of the reviewer's queue.
type AdminRegistration struct {
	ID                string         `json:"id"`
	Reference         string         `json:"reference"`
	UserID            *string        `json:"userId"`
	ContestSlug       string         `json:"contestSlug"`
	Status            string         `json:"status"`
	FormData          map[string]any `json:"formData"`
	CompletionPercent int            `json:"completionPercent"`
	CreatedAt         string         `json:"createdAt"`
	UpdatedAt         string         `json:"updatedAt"`
	SubmittedAt       *string        `json:"submittedAt"`
	// ContestantID is set once the entry has been promoted onto the roster.
	ContestantID *string `json:"contestantId"`
}

// RegistrationStatusEvent is one entry of the immutable review audit trail.
type RegistrationStatusEvent struct {
	ID        string  `json:"id"`
	OldStatus *string `json:"oldStatus"`
	NewStatus string  `json:"newStatus"`
	Note      *string `json:"note"`
	ActorRole *string `json:"actorRole"`
	CreatedAt string  `json:"createdAt"`
}

// promotableStatuses are the statuses that place an entry on the voting roster.
// Reaching any of them promotes the registration to a contestant; the promotion
// is idempotent, so re-entering a promotable status is harmless.
var promotableStatuses = map[string]bool{
	"approved":                   true,
	"selected_for_public_voting": true,
	"selected_for_bootcamp":      true,
}

// terminalRemovalStatuses take an entry OFF the roster if it was ever on it.
var terminalRemovalStatuses = map[string]bool{
	"rejected":     true,
	"disqualified": true,
	"withdrawn":    true,
	"eliminated":   true,
}

const adminRegistrationColumns = `
	r.id::text, r.reference, r.user_id::text, r.contest_slug, r.status,
	COALESCE(r.form_data, '{}'::jsonb), COALESCE(r.completion_percent, 0),
	r.created_at::text, r.updated_at::text, r.submitted_at::text,
	c.id::text AS contestant_id`

func scanAdminRegistration(row pgx.Row) (*AdminRegistration, error) {
	var reg AdminRegistration
	var formRaw []byte
	err := row.Scan(&reg.ID, &reg.Reference, &reg.UserID, &reg.ContestSlug, &reg.Status,
		&formRaw, &reg.CompletionPercent, &reg.CreatedAt, &reg.UpdatedAt,
		&reg.SubmittedAt, &reg.ContestantID)
	if err != nil {
		return nil, err
	}
	if len(formRaw) > 0 {
		_ = json.Unmarshal(formRaw, &reg.FormData)
	}
	if reg.FormData == nil {
		reg.FormData = map[string]any{}
	}
	return &reg, nil
}

// List returns the review queue, newest first. status and contestSlug are
// optional filters; search matches reference, or the name/email inside form_data.
func (s *RegistrationAdminStore) List(ctx context.Context, status, contestSlug, search string, limit, offset int) ([]AdminRegistration, int64, error) {
	// $1/$2/$3 are the filters; a NULL/empty filter disables its clause, which
	// keeps this one query instead of assembling SQL by string concatenation.
	const where = `
		WHERE ($1 = '' OR r.status = $1)
		  AND ($2 = '' OR r.contest_slug = $2)
		  AND ($3 = '' OR r.reference ILIKE '%' || $3 || '%'
		       OR COALESCE(r.form_data->>'personal.firstName', '') ILIKE '%' || $3 || '%'
		       OR COALESCE(r.form_data->>'personal.lastName', '')  ILIKE '%' || $3 || '%'
		       OR COALESCE(r.form_data->>'account.email', '')      ILIKE '%' || $3 || '%')`

	var total int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM registrations r`+where,
		status, contestSlug, search).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count registrations: %w", err)
	}

	rows, err := s.db.Query(ctx, `
		SELECT`+adminRegistrationColumns+`
		FROM registrations r
		LEFT JOIN contestants c ON c.registration_id = r.id`+where+`
		ORDER BY r.created_at DESC
		LIMIT $4 OFFSET $5`,
		status, contestSlug, search, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query registrations: %w", err)
	}
	defer rows.Close()

	out := []AdminRegistration{}
	for rows.Next() {
		reg, err := scanAdminRegistration(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan registration: %w", err)
		}
		out = append(out, *reg)
	}
	return out, total, rows.Err()
}

// Get returns a single entry, or (nil, nil) when it does not exist.
func (s *RegistrationAdminStore) Get(ctx context.Context, id string) (*AdminRegistration, error) {
	reg, err := scanAdminRegistration(s.db.QueryRow(ctx, `
		SELECT`+adminRegistrationColumns+`
		FROM registrations r
		LEFT JOIN contestants c ON c.registration_id = r.id
		WHERE r.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get registration: %w", err)
	}
	return reg, nil
}

// StatusEvents returns the review trail for an entry, oldest first.
func (s *RegistrationAdminStore) StatusEvents(ctx context.Context, id string) ([]RegistrationStatusEvent, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, old_status, new_status, note, actor_role, created_at::text
		FROM registration_status_events
		WHERE registration_id = $1
		ORDER BY created_at ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("query status events: %w", err)
	}
	defer rows.Close()

	out := []RegistrationStatusEvent{}
	for rows.Next() {
		var e RegistrationStatusEvent
		if err := rows.Scan(&e.ID, &e.OldStatus, &e.NewStatus, &e.Note, &e.ActorRole, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan status event: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// StatusChangeResult reports what a transition did.
type StatusChangeResult struct {
	Registration *AdminRegistration `json:"registration"`
	OldStatus    string             `json:"oldStatus"`
	ContestantID *string            `json:"contestantId"`
	Promoted     bool               `json:"promoted"`
	Removed      bool               `json:"removed"`
}

// ErrRegistrationNotFound is returned when the target entry does not exist.
var ErrRegistrationNotFound = errors.New("registration not found")

// SetStatus moves an entry to newStatus and, in the SAME transaction, keeps the
// voting roster consistent: a promotable status puts the entry on the roster, a
// removal status deactivates it. Doing both atomically is the point — a commit
// that changed the status but failed the promotion would leave an approved
// entry that nobody can vote for, which is the bug this seam exists to fix.
func (s *RegistrationAdminStore) SetStatus(ctx context.Context, id, newStatus, note, actorRole string) (*StatusChangeResult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin status change: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the row so two reviewers acting at once serialise rather than both
	// reading the same old status and writing conflicting audit trails.
	var oldStatus string
	err = tx.QueryRow(ctx,
		`SELECT status FROM registrations WHERE id = $1 FOR UPDATE`, id).Scan(&oldStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRegistrationNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock registration: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE registrations
		SET status = $2,
		    updated_at = NOW(),
		    withdrawn_at = CASE WHEN $2 = 'withdrawn' THEN NOW() ELSE withdrawn_at END
		WHERE id = $1`, id, newStatus); err != nil {
		return nil, fmt.Errorf("update registration status: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO registration_status_events (
			id, registration_id, old_status, new_status, note, actor_role, created_at
		) VALUES (gen_random_uuid(), $1, $2, $3, NULLIF($4, ''), $5, NOW())`,
		id, oldStatus, newStatus, note, actorRole); err != nil {
		return nil, fmt.Errorf("record status event: %w", err)
	}

	result := &StatusChangeResult{OldStatus: oldStatus}

	switch {
	case promotableStatuses[newStatus]:
		var contestantID string
		if err := tx.QueryRow(ctx,
			`SELECT promote_registration_to_contestant($1)::text`, id).Scan(&contestantID); err != nil {
			return nil, fmt.Errorf("promote to contestant: %w", err)
		}
		result.ContestantID = &contestantID
		result.Promoted = true

	case terminalRemovalStatuses[newStatus]:
		// Deactivate rather than delete: votes already cast reference this
		// contestant, and the ledger of who competed must stay intact.
		ct, err := tx.Exec(ctx, `
			UPDATE contestants
			SET status = 'rejected', is_active = FALSE, updated_at = NOW()
			WHERE registration_id = $1`, id)
		if err != nil {
			return nil, fmt.Errorf("deactivate contestant: %w", err)
		}
		result.Removed = ct.RowsAffected() > 0
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit status change: %w", err)
	}

	reg, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	result.Registration = reg
	return result, nil
}

// RegistrationAdminHandler serves the admin console's participants queue:
// listing entries, opening one, and moving it through review. Approving an
// entry promotes it onto the voting roster in the same transaction.
// Every route is mounted behind an RBAC permission guard (see the registration
// admin group in router.go) — these handlers do not check permissions
// themselves and must never be mounted on an unguarded group.
type RegistrationAdminHandler struct {
	store    *RegistrationAdminStore
	rbac     services.RBACService
	auditSvc services.AuditService
}

func NewRegistrationAdminHandler(store *RegistrationAdminStore, rbac services.RBACService, auditSvc services.AuditService) *RegistrationAdminHandler {
	return &RegistrationAdminHandler{store: store, rbac: rbac, auditSvc: auditSvc}
}

// permissionForStatus maps a target status to the permission it requires.
// Approving and rejecting are separate capabilities in the RBAC model, so a
// single blanket guard on the route would hand every reviewer both. The route
// guard covers contestant.view; this second check covers the specific action.
func permissionForStatus(status string) string {
	if terminalRemovalStatuses[status] {
		return "contestant.reject"
	}
	return "contestant.approve"
}

// allowedStatuses mirrors the registrations.status CHECK constraint. Validating
// here turns a rejected transition into a 400 with the valid set, rather than a
// 500 from the database.
var allowedStatuses = map[string]bool{
	"draft": true, "submitted": true, "awaiting_payment": true,
	"under_review": true, "more_information_requested": true,
	"shortlisted": true, "callback_invited": true, "approved": true,
	"rejected": true, "waitlisted": true, "disqualified": true,
	"audition_scheduled": true, "selected_for_bootcamp": true,
	"selected_for_public_voting": true, "eliminated": true,
	"winner": true, "withdrawn": true,
}

func allowedStatusList() []string {
	out := make([]string, 0, len(allowedStatuses))
	for s := range allowedStatuses {
		out = append(out, s)
	}
	return out
}

// List — GET /api/v1/admin/registrations
func (h *RegistrationAdminHandler) List(c *gin.Context) {
	limit := 50
	offset := 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		offset = v
	}

	status := c.Query("status")
	if status != "" && !allowedStatuses[status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown status filter"})
		return
	}

	items, total, err := h.store.List(c.Request.Context(), status, c.Query("contestSlug"), c.Query("search"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load registrations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": limit, "offset": offset})
}

// Get — GET /api/v1/admin/registrations/:id
func (h *RegistrationAdminHandler) Get(c *gin.Context) {
	reg, err := h.store.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load registration"})
		return
	}
	if reg == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "registration not found"})
		return
	}

	events, err := h.store.StatusEvents(c.Request.Context(), reg.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load review history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"registration": reg, "statusEvents": events}})
}

// UpdateStatus — PATCH /api/v1/admin/registrations/:id/status
// Moves an entry through review. Approving promotes it onto the voting roster.
func (h *RegistrationAdminHandler) UpdateStatus(c *gin.Context) {
	id := c.Param("id")

	var body struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if !allowedStatuses[body.Status] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":         "invalid status",
			"allowedValues": allowedStatusList(),
		})
		return
	}

	actorID := ginutil.UserID(c)
	actorRole := c.GetString("adminRole")
	if actorRole == "" {
		actorRole = "admin"
	}

	// Fail closed: an RBAC lookup error denies the transition rather than
	// letting it through on a degraded permission service.
	required := permissionForStatus(body.Status)
	allowed, err := h.rbac.CheckPermission(actorID, required, "global", "")
	if err != nil || !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "missing permission: " + required})
		return
	}

	result, err := h.store.SetStatus(c.Request.Context(), id, body.Status, body.Note, actorRole)
	if errors.Is(err, ErrRegistrationNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "registration not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status"})
		return
	}

	if h.auditSvc != nil {
		h.auditSvc.LogAction(actorID, "", "update_registration_status", "registration", "registration",
			id, map[string]any{"status": result.OldStatus},
			map[string]any{
				"status":       body.Status,
				"note":         body.Note,
				"promoted":     result.Promoted,
				"contestantId": result.ContestantID,
			}, ginutil.ClientIP(c), c.Request.UserAgent(), "warning")
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}
