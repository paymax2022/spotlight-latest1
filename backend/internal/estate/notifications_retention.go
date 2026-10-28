// Package estate — notifications_retention.go — the inbox archive, search, pin and retention surface
// (estate-d M18: EST-UAT-0359, defect ESTD-D008). Close-out Phase 2.5a.
//
// EST-UAT-0359 asks for four things the module could not do: read, archive, search older notifications,
// and a retention policy that keeps critical notices from being lost. Before this file the Go surface
// answered only the first, and not fully — `Notifications()` selected five columns and no `read_at`, so
// even the read state that lived in the table never reached the caller, and `LIMIT 50` truncated the
// inbox with no way to page past it. A notice older than the 50th newest was unreachable while still
// existing, which is the "critical notices fall off the inbox" half of the gap.
//
// Where the rules live: the archive/purge semantics are in 20271099000070 (the sweep function and the
// BEFORE DELETE purge guard), not here. This file validates caller input, scopes reads to the caller's
// own rows, and turns what the database raises into a status. It never deletes a notification: the only
// path to a DELETE is estate_notifications_apply_retention(), and that path is refused by the trigger for
// a pinned row, a protected category or an estate under legal hold.
package estate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Notification inbox sentinels.
var (
	ErrNotificationNotFound     = errors.New("estate: no such notification in your inbox")
	ErrInvalidNotificationState = errors.New("estate: state must be active, archived or all")
	ErrInvalidNotificationQuery = errors.New("estate: a search term of at least 2 characters is required")
	ErrInvalidNotificationLimit = errors.New("estate: limit must be between 1 and 200")
	ErrInvalidNotifCategory     = errors.New("estate: unknown notification category")
	ErrInvalidRetentionPolicy   = errors.New("estate: retention days must be positive and purge cannot be scheduled before archive")
)

// notifCategories mirrors the estate_notifications.category CHECK domain in
// 20260622020001_estate_modules_38_46.sql. Duplicated deliberately: a caller asking to protect
// "emergencz" would otherwise write a policy row the database accepts (the check is on the notification,
// not on the array) and which then protects nothing.
var notifCategories = []string{
	"general", "payment", "meeting", "election", "security",
	"maintenance", "facility", "announcement", "system",
}

// NotificationFilter is the inbox read selector. Zero values mean "no filter", so the default read is the
// active inbox in its newest 50 — the shape every existing caller already expects.
type NotificationFilter struct {
	State      string // active (default) | archived | all
	UnreadOnly bool
	Category   string
	Query      string // substring over title + body
	Limit      int    // default 50, max 200
	Offset     int
}

const (
	notifDefaultLimit = 50
	notifMaxLimit     = 200
	// notifArchiveState / notifArchivedState / notifAllStates are the three views the case names:
	// "read, archive, search older notifications". Older items are not gone; they are in the other half.
	stateActive   = "active"
	stateArchived = "archived"
	stateAll      = "all"
)

// NotificationPage is a paged inbox read. Total is the count of matching rows before paging, which is
// what makes truncation visible instead of silent — the number the 50-row cap used to hide.
type NotificationPage struct {
	Items      []Notification `json:"data"`
	Total      int            `json:"total"`
	Limit      int            `json:"limit"`
	Offset     int            `json:"offset"`
	State      string         `json:"state"`
	UnreadOnly bool           `json:"unread_only"`
}

// notifScope builds the WHERE fragment shared by the page and the count query, so the two can never
// disagree about what "this inbox, these filters" means.
func notifScope(estateID, userID string, f NotificationFilter) (string, []any, error) {
	q := ` WHERE estate_id=$1 AND user_id=$2`
	args := []any{estateID, userID}
	add := func(cond string, val any) {
		q += fmt.Sprintf(" AND %s=$%d", cond, len(args)+1)
		args = append(args, val)
	}
	switch f.State {
	case "", stateActive:
		q += ` AND archived_at IS NULL`
	case stateArchived:
		q += ` AND archived_at IS NOT NULL`
	case stateAll:
		// both halves; no archive predicate
	default:
		return "", nil, ErrInvalidNotificationState
	}
	if f.UnreadOnly {
		q += ` AND read_at IS NULL`
	}
	if c := strings.TrimSpace(f.Category); c != "" {
		if !slices.Contains(notifCategories, c) {
			return "", nil, fmt.Errorf("%w: %s", ErrInvalidNotifCategory, c)
		}
		add("category", c)
	}
	if term := strings.TrimSpace(f.Query); term != "" {
		if len([]rune(term)) < 2 {
			return "", nil, ErrInvalidNotificationQuery
		}
		// The trigram index added by 20271099000070 accelerates exactly this shape; without pg_trgm the
		// same predicate runs as a seq scan, so search degrades in speed but never in meaning.
		q += ` AND (COALESCE(title,'') || ' ' || COALESCE(body,'')) ILIKE '%' || $` +
			fmt.Sprint(len(args)+1) + ` || '%'`
		args = append(args, term)
	}
	return q, args, nil
}

// ListNotifications reads one recipient's inbox with state, category, search and paging applied
// (EST-UAT-0359). Scoping is not a filter the caller controls: user_id is always the caller's own, and
// the estate membership assertion in front of it means a stranger cannot even learn how many rows exist.
func (s *Service) ListNotifications(ctx context.Context, estateID, userID string, f NotificationFilter) (*NotificationPage, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	if f.State == "" {
		f.State = stateActive
	}
	scope, args, err := notifScope(estateID, userID, f)
	if err != nil {
		return nil, err
	}
	page := &NotificationPage{State: f.State, UnreadOnly: f.UnreadOnly}

	const qCount = `SELECT COUNT(*) FROM estate_notifications`
	if err := s.db.QueryRow(ctx, qCount+scope, args...).Scan(&page.Total); err != nil {
		return nil, fmt.Errorf("estate: inbox count: %w", err)
	}

	limit := f.Limit
	if limit == 0 {
		limit = notifDefaultLimit
	}
	if limit < 0 || limit > notifMaxLimit {
		return nil, ErrInvalidNotificationLimit
	}
	page.Limit, page.Offset = limit, max(f.Offset, 0)

	// Pinned first, then newest: a row the recipient or the estate has marked must-not-lose sorts ahead of
	// everything, so paging past 50 items cannot walk over the one that matters.
	q := `
		SELECT id, category, title, COALESCE(body,''), COALESCE(deep_link,''),
		       created_at, read_at, archived_at, pinned
		FROM estate_notifications` + scope +
		` ORDER BY pinned DESC, created_at DESC LIMIT ` + fmt.Sprint(limit) + ` OFFSET ` + fmt.Sprint(page.Offset)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("estate: inbox read: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.DeepLink,
			&n.CreatedAt, &n.ReadAt, &n.ArchivedAt, &n.Pinned); err != nil {
			return nil, fmt.Errorf("estate: inbox scan: %w", err)
		}
		page.Items = append(page.Items, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if page.Items == nil {
		page.Items = []Notification{}
	}
	return page, nil
}

// scanInboxRow reads a single notification back after a write so the caller gets the row's true state
// rather than an echo of what it asked for.
const notifCols = `id, category, title, COALESCE(body,''), COALESCE(deep_link,''), created_at, read_at, archived_at, pinned`

func scanNotification(row interface{ Scan(dest ...any) error }) (Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.DeepLink,
		&n.CreatedAt, &n.ReadAt, &n.ArchivedAt, &n.Pinned)
	return n, err
}

// notifOwnRow is the ownership clause every notification write passes through first. A notification is
// one recipient's copy, so "not yours" and "not here" are the same answer — distinguishing them would
// leak the existence of somebody else's inbox rows.
func (s *Service) notifOwnRow(ctx context.Context, estateID, userID, notifID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM estate_notifications WHERE id=$1 AND estate_id=$2 AND user_id=$3)`,
		notifID, estateID, userID).Scan(&exists)
	return exists, err
}

// MarkNotificationRead stamps the read time once and never overwrites it — the stamp is evidence the
// recipient saw the notice, and re-reading it must not move the date the retention sweep keys on.
func (s *Service) MarkNotificationRead(ctx context.Context, estateID, userID, notifID string) (*Notification, error) {
	own, err := s.notifOwnRow(ctx, estateID, userID, notifID)
	if err != nil {
		return nil, err
	}
	if !own {
		return nil, ErrNotificationNotFound
	}
	row := s.db.QueryRow(ctx, `
		UPDATE estate_notifications SET read_at = COALESCE(read_at, NOW())
		WHERE id=$1 AND estate_id=$2 AND user_id=$3
		RETURNING `+notifCols, notifID, estateID, userID)
	n, err := scanNotification(row)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// MarkAllNotificationsRead marks the caller's unread active inbox rows read, and returns how many it
// stamped. It deliberately does not reach into the archive half: marking an archived notice read would
// change a row the recipient already put away.
func (s *Service) MarkAllNotificationsRead(ctx context.Context, estateID, userID string) (int64, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return 0, err
	}
	ct, err := s.db.Exec(ctx, `
		UPDATE estate_notifications SET read_at = NOW()
		WHERE estate_id=$1 AND user_id=$2 AND read_at IS NULL AND archived_at IS NULL`,
		estateID, userID)
	if err != nil {
		return 0, fmt.Errorf("estate: mark all read: %w", err)
	}
	return ct.RowsAffected(), nil
}

// SetNotificationArchived moves one of the caller's notices between the inbox and the archive
// (EST-UAT-0359). This is the reversible half of retention: archiving stamps a timestamp and keeps every
// column, so nothing here can be the mechanism that loses a notice.
func (s *Service) SetNotificationArchived(ctx context.Context, estateID, userID, notifID string, archived bool) (*Notification, error) {
	own, err := s.notifOwnRow(ctx, estateID, userID, notifID)
	if err != nil {
		return nil, err
	}
	if !own {
		return nil, ErrNotificationNotFound
	}
	stamp := "NULL"
	if archived {
		stamp = "NOW()"
	}
	// A notice pulled back into the inbox keeps its read state: un-archiving is not the same act as
	// making somebody forget they read it.
	row := s.db.QueryRow(ctx, fmt.Sprintf(`
		UPDATE estate_notifications SET archived_at = %s
		WHERE id=$1 AND estate_id=$2 AND user_id=$3
		RETURNING `+notifCols, stamp), notifID, estateID, userID)
	n, err := scanNotification(row)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// SetNotificationPinned marks one notice as "must not be swept". An estate admin may pin a member's copy
// because the pin is a retention decision, not a personal organisation of somebody's inbox; a member may
// pin their own.
func (s *Service) SetNotificationPinned(ctx context.Context, estateID, actorID, userID, notifID string, pinned bool) (*Notification, error) {
	target := strings.TrimSpace(userID)
	if target == "" || target == actorID {
		target = actorID
		if err := s.assertResident(ctx, estateID, actorID); err != nil {
			return nil, err
		}
	} else if err := s.assertEstateAdmin(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	own, err := s.notifOwnRow(ctx, estateID, target, notifID)
	if err != nil {
		return nil, err
	}
	if !own {
		return nil, ErrNotificationNotFound
	}
	row := s.db.QueryRow(ctx, `
		UPDATE estate_notifications SET pinned = $4
		WHERE id=$1 AND estate_id=$2 AND user_id=$3
		RETURNING `+notifCols, notifID, estateID, target, pinned)
	n, err := scanNotification(row)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// NotificationRetentionPolicy is one estate's inbox schedule, and the answer to "what is the policy?" for
// an estate that has never set one: the defaults the sweep applies, flagged as Defaulted so the console
// can say "these are the defaults" rather than implying a decision nobody made.
type NotificationRetentionPolicy struct {
	EstateID         string     `json:"estate_id"`
	Enabled          bool       `json:"enabled"`
	ArchiveAfterDays int        `json:"archive_after_days"`
	PurgeAfterDays   *int       `json:"purge_after_days,omitempty"`
	KeepCategories   []string   `json:"keep_categories"`
	Defaulted        bool       `json:"defaulted"`
	UpdatedBy        string     `json:"updated_by,omitempty"`
	UpdatedAt        *time.Time `json:"updated_at,omitempty"`
}

const notifDefaultArchiveDays = 90

// notifDefaultKeep matches the column default in 20271099000070. If the two ever diverge, the live-DB
// test that reads an absent policy back fails, which is the point of naming them here.
var notifDefaultKeep = []string{"security", "system"}

// GetNotificationRetentionPolicy reads the effective policy (estate admin only).
func (s *Service) GetNotificationRetentionPolicy(ctx context.Context, estateID, adminID string) (*NotificationRetentionPolicy, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	return s.notifRetentionPolicy(ctx, estateID)
}

func (s *Service) notifRetentionPolicy(ctx context.Context, estateID string) (*NotificationRetentionPolicy, error) {
	p := &NotificationRetentionPolicy{
		EstateID: estateID, Enabled: true, ArchiveAfterDays: notifDefaultArchiveDays,
		KeepCategories: append([]string(nil), notifDefaultKeep...),
	}
	var (
		purge *int
		keep  []string
		updBy *string
		updAt *time.Time
	)
	err := s.db.QueryRow(ctx, `
		SELECT enabled, archive_after_days, purge_after_days, keep_categories,
		       updated_by::text, updated_at
		FROM estate_notification_retention_policies WHERE estate_id=$1`, estateID).
		Scan(&p.Enabled, &p.ArchiveAfterDays, &purge, &keep, &updBy, &updAt)
	if errors.Is(err, pgx.ErrNoRows) {
		p.Defaulted = true
		return p, nil
	}
	if err != nil {
		return nil, fmt.Errorf("estate: retention policy read: %w", err)
	}
	if len(keep) > 0 {
		p.KeepCategories = keep
	}
	if purge != nil && *purge > 0 {
		v := *purge
		p.PurgeAfterDays = &v
	}
	if updBy != nil {
		p.UpdatedBy = *updBy
	}
	if updAt != nil {
		p.UpdatedAt = updAt
	}
	return p, nil
}

// SetNotificationRetentionPolicyRequest is the admin's schedule. Absent fields keep the defaults rather
// than being read as zero, so a console that PATCHes one number cannot silently set the others to 0.
type SetNotificationRetentionPolicyRequest struct {
	Enabled          *bool    `json:"enabled"`
	ArchiveAfterDays *int     `json:"archive_after_days"`
	PurgeAfterDays   *int     `json:"purge_after_days"`
	KeepCategories   []string `json:"keep_categories"`
}

// SetNotificationRetentionPolicy writes the policy (estate admin only) and audits it: this is the setting
// that decides how long a dispute's evidence stays readable, so "who shortened the window, when" is a
// question the estate will eventually ask.
func (s *Service) SetNotificationRetentionPolicy(ctx context.Context, estateID, adminID string, req SetNotificationRetentionPolicyRequest) (*NotificationRetentionPolicy, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	cur, err := s.notifRetentionPolicy(ctx, estateID)
	if err != nil {
		return nil, err
	}
	enabled := cur.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	archiveDays := cur.ArchiveAfterDays
	if req.ArchiveAfterDays != nil {
		archiveDays = *req.ArchiveAfterDays
	}
	purgeDays := cur.PurgeAfterDays
	if req.PurgeAfterDays != nil {
		if *req.PurgeAfterDays == 0 {
			purgeDays = nil // 0 is the wire spelling of "never purge"
		} else {
			v := *req.PurgeAfterDays
			purgeDays = &v
		}
	}
	keep := cur.KeepCategories
	if req.KeepCategories != nil {
		// Replace, not merge. A list is only worth sending if sending a shorter one removes something:
		// merged, an estate could add `payment` to its protected set and never take it back through this
		// API. An explicit empty list is a real answer — "protect nothing beyond what is pinned".
		keep = make([]string, 0, len(req.KeepCategories))
		for _, c := range req.KeepCategories {
			c = strings.TrimSpace(c)
			if !slices.Contains(notifCategories, c) {
				return nil, fmt.Errorf("%w: %s", ErrInvalidNotifCategory, c)
			}
			if !slices.Contains(keep, c) {
				keep = append(keep, c)
			}
		}
	}
	if archiveDays <= 0 || (purgeDays != nil && *purgeDays <= 0) ||
		(purgeDays != nil && *purgeDays < archiveDays) {
		return nil, ErrInvalidRetentionPolicy
	}

	var purgeArg any
	if purgeDays != nil {
		purgeArg = *purgeDays
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO estate_notification_retention_policies
			(estate_id, enabled, archive_after_days, purge_after_days, keep_categories, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,NOW())
		ON CONFLICT (estate_id) DO UPDATE
		SET enabled = EXCLUDED.enabled,
		    archive_after_days = EXCLUDED.archive_after_days,
		    purge_after_days = EXCLUDED.purge_after_days,
		    keep_categories = EXCLUDED.keep_categories,
		    updated_by = EXCLUDED.updated_by,
		    updated_at = NOW()`,
		estateID, enabled, archiveDays, purgeArg, keep, adminID); err != nil {
		return nil, fmt.Errorf("estate: retention policy write: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "NOTIFICATION_RETENTION_SET", "estate", estateID, map[string]any{
		"enabled": enabled, "archive_after_days": archiveDays,
		"purge_after_days": purgeArg, "keep_categories": keep,
	})
	return s.notifRetentionPolicy(ctx, estateID)
}

// ApplyNotificationRetention runs the estate's schedule now (estate admin only) and returns the counters.
// The sweep is idempotent, so an admin pressing it twice in a meeting is safe; what is not reversible is
// a purge past the horizon, which is why a policy has to opt into purging at all.
func (s *Service) ApplyNotificationRetention(ctx context.Context, estateID, adminID string) (map[string]int64, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	counts, err := s.runRetentionSweep(ctx, estateID)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, estateID, adminID, "NOTIFICATION_RETENTION_RUN", "estate", estateID, map[string]any{
		"notifications_archived": counts["notifications_archived"],
		"notifications_purged":   counts["notifications_purged"],
	})
	return counts, nil
}

// runRetentionSweep applies one estate's policy, or every estate's when estateID is "". It calls the SQL
// function rather than reproducing its predicates here: the guard that refuses a protected DELETE lives
// behind that function, and a second implementation in Go would be a second set of rules to keep true.
func (s *Service) runRetentionSweep(ctx context.Context, estateID string) (map[string]int64, error) {
	var arg any
	if strings.TrimSpace(estateID) != "" {
		arg = estateID
	}
	var raw []byte
	if err := s.db.QueryRow(ctx,
		`SELECT estate_notifications_apply_retention($1::uuid)::text`, arg).Scan(&raw); err != nil {
		return nil, fmt.Errorf("estate: retention sweep: %w", err)
	}
	out := map[string]int64{"notifications_archived": 0, "notifications_purged": 0}

	// Two shapes from one function: a single estate answers with its counters, the platform-wide call
	// answers with a by_estate map. Flatten both into the same two counters.
	var doc struct {
		Archived int64 `json:"archived"`
		Purged   int64 `json:"purged"`
		ByEstate map[string]struct {
			Archived int64 `json:"archived"`
			Purged   int64 `json:"purged"`
		} `json:"by_estate"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("estate: retention sweep result: %w", err)
	}
	out["notifications_archived"] = doc.Archived
	out["notifications_purged"] = doc.Purged
	for _, per := range doc.ByEstate {
		out["notifications_archived"] += per.Archived
		out["notifications_purged"] += per.Purged
	}
	return out, nil
}
