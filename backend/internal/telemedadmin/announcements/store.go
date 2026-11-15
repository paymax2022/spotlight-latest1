package announcements

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// querier is the read surface shared by the pool and a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// database is what the store needs: reads plus Begin, which on a pgx.Tx opens a
// savepoint — so a test can run the whole surface inside one rolled-back tx.
type database interface {
	querier
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Store publishes platform notices to the provider portal.
type Store struct{ db database }

// NewStore wraps the pgx pool.
func NewStore(db *pgxpool.Pool) *Store { return &Store{db: db} }

// NewStoreOn builds a store over any database, e.g. an open pgx.Tx in tests.
func NewStoreOn(db database) *Store { return &Store{db: db} }

const (
	// notifType is the only value the portal banner reads: the provider-side
	// query filters doctor_notifications on notif_type = 'system' and ignores
	// the 'support_response' / 'compliance' rows the support queues write.
	notifType = "system"
	// groupKey tags the fan-out rows so a campaign can be grouped back out of a
	// per-recipient table.
	groupKey = "announcement"

	auditAction = "telemedicine.admin.announcement.publish"
)

// detail is what a fan-out row carries besides title/body. campaign_id is the
// only key the provider read ignores: it is what lets the console answer "what
// has already gone out, and to how many" from the same rows the banner reads,
// rather than a second table that could disagree with the first.
type detail struct {
	Tone        string  `json:"tone"`
	Dismissible bool    `json:"dismissible"`
	CTALabel    *string `json:"ctaLabel,omitempty"`
	CTARoute    *string `json:"ctaRoute,omitempty"`
	CampaignID  string  `json:"campaign_id"`
}

// Publish writes one unread 'system' notification per provider account.
//
// The audience is the portal, so it is every doctor_profiles row — including a
// provider still in onboarding, who is exactly the reader who most needs a
// platform notice. It is deliberately not the patient-facing `doctors`
// directory: unpublishing a profile for a compliance reason must not also mute
// the operator who has to answer for it.
//
// The recipient count is the fan-out's own RowsAffected, never a second query
// that could have counted a different set.
func (s *Store) Publish(ctx context.Context, adminID string, req PublishRequest) (*Published, error) {
	title := strings.TrimSpace(req.Title)
	body := strings.TrimSpace(req.Body)
	if title == "" || body == "" {
		return nil, fmt.Errorf("%w: title and body are both required", ErrValidation)
	}
	if !validTone(req.Tone) {
		return nil, fmt.Errorf("%w: tone must be one of %s, %s, %s", ErrValidation, ToneInfo, ToneSuccess, ToneWarning)
	}
	label := strings.TrimSpace(req.CtaLabel)
	route := strings.TrimSpace(req.CtaRoute)
	if (label == "") != (route == "") {
		return nil, fmt.Errorf("%w: ctaLabel and ctaRoute go together — a button that goes nowhere is not a call to action", ErrValidation)
	}

	dismissible := true
	if req.Dismissible != nil {
		dismissible = *req.Dismissible
	}
	id := uuid.NewString()
	// One instant for the whole campaign: every recipient received this at the
	// same time, and the console orders publications by it. now() would not do —
	// it is frozen for the transaction, so two publications in one transaction
	// would tie.
	publishedAt := time.Now().UTC()

	d := detail{Tone: req.Tone, Dismissible: dismissible, CampaignID: id}
	if label != "" {
		d.CTALabel = &label
		d.CTARoute = &route
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}

	var recipients int64
	err = s.inTx(ctx, func(q querier) error {
		tag, err := q.Exec(ctx, `
			INSERT INTO doctor_notifications
				(user_id, notif_type, title, body, group_key, detail, created_at)
			SELECT p.user_id, $1, $2, $3, $4, $5::jsonb, $6::timestamptz
			FROM doctor_profiles p`,
			notifType, title, body, groupKey, raw, publishedAt)
		if err != nil {
			return fmt.Errorf("announcements: fan out to providers: %w", err)
		}
		recipients = tag.RowsAffected()

		// A platform-wide notice has no single doctor to trail against, so it goes
		// in the console's generic audit table rather than doctor_compliance_audit.
		// admin_id is resolved through user_profiles because that is where the
		// foreign key points; an operator without a profile row trails as NULL
		// rather than failing the publish.
		newValue, err := json.Marshal(map[string]any{
			"title":       title,
			"body":        body,
			"tone":        req.Tone,
			"dismissible": dismissible,
			"recipients":  recipients,
			"ctaLabel":    label,
			"ctaRoute":    route,
		})
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `
			INSERT INTO admin_audit_logs
				(admin_id, action_type, target_table, target_id, old_value, new_value, reason, ip_address)
			VALUES ((SELECT id FROM user_profiles WHERE id = $1::uuid), $2, $3, $4::uuid, '{}'::jsonb, $5::jsonb, '', '')`,
			adminID, auditAction, "doctor_notifications", id, newValue); err != nil {
			return fmt.Errorf("announcements: write admin audit trail: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return &Published{
		ID: id, Title: title, Body: body, Tone: req.Tone,
		Dismissible: dismissible, Recipients: recipients, PublishedAt: publishedAt,
	}, nil
}

// List returns published campaigns, newest first. It reads the same
// doctor_notifications rows the banner reads and groups them by campaign_id, so
// the console cannot show a notice no provider actually received.
func (s *Store) List(ctx context.Context, limit int) ([]Item, error) {
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `
		SELECT detail->>'campaign_id' AS campaign,
		       max(title) AS title,
		       max(body) AS body,
		       max(detail->>'tone') AS tone,
		       count(*) AS recipients,
		       max(created_at) AS published_at
		FROM doctor_notifications
		WHERE notif_type = $1 AND group_key = $2 AND detail ? 'campaign_id'
		GROUP BY campaign
		ORDER BY published_at DESC
		LIMIT $3`, notifType, groupKey, limit)
	if err != nil {
		return nil, fmt.Errorf("announcements: list campaigns: %w", err)
	}
	defer rows.Close()

	out := []Item{}
	for rows.Next() {
		var (
			it        Item
			title     *string
			body      *string
			published time.Time
		)
		if err := rows.Scan(&it.ID, &title, &body, &it.Tone, &it.Recipients, &published); err != nil {
			return nil, fmt.Errorf("announcements: scan campaign: %w", err)
		}
		if title != nil {
			it.Title = *title
		}
		if body != nil {
			it.Body = *body
		}
		it.PublishedAt = published.UTC()
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("announcements: read campaigns: %w", err)
	}
	return out, nil
}

func (s *Store) inTx(ctx context.Context, fn func(querier) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
