package engage

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/timeutil"
)

// Service is the crowdfunding engagement service (support, help, notifications,
// settings). It reads/writes through a pgx pool and returns DTOs matching the
// mobile TypeScript contract.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs an engagement service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// GetHelp returns the seeded help-center articles ordered for display.
func (s *Service) GetHelp(ctx context.Context) ([]HelpArticle, error) {
	const q = `SELECT id, topic, question, answer FROM cf_help_articles ORDER BY sort_order ASC, question ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HelpArticle{}
	for rows.Next() {
		var a HelpArticle
		if err := rows.Scan(&a.ID, &a.Topic, &a.Question, &a.Answer); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListTickets returns the caller's tickets (newest first) with their messages.
func (s *Service) ListTickets(ctx context.Context, userID string) ([]SupportTicket, error) {
	const q = `
		SELECT id, reference, subject, category, status, created_at, updated_at
		FROM cf_support_tickets
		WHERE user_id = $1
		ORDER BY updated_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupportTicket{}
	ids := []string{}
	for rows.Next() {
		var t SupportTicket
		var created, updated time.Time
		if err := rows.Scan(&t.ID, &t.Reference, &t.Subject, &t.Category, &t.Status, &created, &updated); err != nil {
			return nil, err
		}
		t.CreatedAt = timeutil.RFC3339(created)
		t.UpdatedAt = timeutil.RFC3339(updated)
		t.Messages = []TicketMessage{}
		out = append(out, t)
		ids = append(ids, t.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		msgs, err := s.ticketMessages(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Messages = msgs
	}
	return out, nil
}

// GetTicket returns a single ticket (with messages) by id.
func (s *Service) GetTicket(ctx context.Context, id string) (*SupportTicket, error) {
	const q = `
		SELECT id, reference, subject, category, status, created_at, updated_at
		FROM cf_support_tickets
		WHERE id = $1`
	var t SupportTicket
	var created, updated time.Time
	err := s.db.QueryRow(ctx, q, id).Scan(
		&t.ID, &t.Reference, &t.Subject, &t.Category, &t.Status, &created, &updated,
	)
	if err != nil {
		return nil, err
	}
	t.CreatedAt = timeutil.RFC3339(created)
	t.UpdatedAt = timeutil.RFC3339(updated)
	msgs, err := s.ticketMessages(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	t.Messages = msgs
	return &t, nil
}

func (s *Service) ticketMessages(ctx context.Context, ticketID string) ([]TicketMessage, error) {
	const q = `
		SELECT id, from_role, body, created_at
		FROM cf_ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, q, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TicketMessage{}
	for rows.Next() {
		var m TicketMessage
		var created time.Time
		if err := rows.Scan(&m.ID, &m.From, &m.Body, &created); err != nil {
			return nil, err
		}
		m.CreatedAt = timeutil.RFC3339(created)
		out = append(out, m)
	}
	return out, rows.Err()
}

// CreateTicket opens a new ticket with the first user message, transactionally.
// A human-readable reference SPL-TK-#### is generated.
func (s *Service) CreateTicket(ctx context.Context, userID string, in CreateTicketInput) (*SupportTicket, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	ticketID := uuid.New().String()
	reference := newTicketReference()
	now := time.Now()

	const insTicket = `
		INSERT INTO cf_support_tickets (id, user_id, reference, subject, category, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6)`
	if _, err := tx.Exec(ctx, insTicket, ticketID, userID, reference, in.Subject, in.Category, now); err != nil {
		return nil, err
	}

	const insMsg = `
		INSERT INTO cf_ticket_messages (id, ticket_id, from_role, body, created_at)
		VALUES ($1, $2, 'user', $3, $4)`
	if _, err := tx.Exec(ctx, insMsg, uuid.New().String(), ticketID, in.Body, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetTicket(ctx, ticketID)
}

// ReplyTicket appends a user message, sets the ticket to PENDING and bumps
// updated_at — all in a single transaction.
func (s *Service) ReplyTicket(ctx context.Context, ticketID, body string) (*SupportTicket, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := time.Now()
	const insMsg = `
		INSERT INTO cf_ticket_messages (id, ticket_id, from_role, body, created_at)
		VALUES ($1, $2, 'user', $3, $4)`
	if _, err := tx.Exec(ctx, insMsg, uuid.New().String(), ticketID, body, now); err != nil {
		return nil, err
	}

	const updTicket = `UPDATE cf_support_tickets SET status = 'PENDING', updated_at = $2 WHERE id = $1`
	tag, err := tx.Exec(ctx, updTicket, ticketID, now)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("ticket not found")
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetTicket(ctx, ticketID)
}

// GetNotifications returns the caller's notifications, newest first.
func (s *Service) GetNotifications(ctx context.Context, userID string) ([]AppNotification, error) {
	const q = `
		SELECT id, type, title, body, read, campaign_id, created_at
		FROM cf_notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AppNotification{}
	for rows.Next() {
		var n AppNotification
		var campaignID *string
		var created time.Time
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Read, &campaignID, &created); err != nil {
			return nil, err
		}
		n.CampaignID = campaignID
		n.CreatedAt = timeutil.RFC3339(created)
		out = append(out, n)
	}
	return out, rows.Err()
}

// MarkNotificationsRead flags all of the caller's unread notifications as read.
func (s *Service) MarkNotificationsRead(ctx context.Context, userID string) error {
	const q = `UPDATE cf_notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`
	_, err := s.db.Exec(ctx, q, userID)
	return err
}

// defaultPrefs is the sensible default returned when no row exists yet.
func defaultPrefs() NotificationPrefs {
	return NotificationPrefs{
		Push:               true,
		Email:              true,
		SMS:                false,
		ContributionAlerts: true,
		CampaignUpdates:    true,
		Marketing:          false,
	}
}

// GetNotificationPrefs returns the caller's preferences, or sensible defaults
// when no row has been persisted yet.
func (s *Service) GetNotificationPrefs(ctx context.Context, userID string) (NotificationPrefs, error) {
	const q = `
		SELECT push, email, sms, contribution_alerts, campaign_updates, marketing
		FROM cf_notification_prefs
		WHERE user_id = $1`
	var p NotificationPrefs
	err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.Push, &p.Email, &p.SMS, &p.ContributionAlerts, &p.CampaignUpdates, &p.Marketing,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultPrefs(), nil
	}
	if err != nil {
		return NotificationPrefs{}, err
	}
	return p, nil
}

// UpdateNotificationPrefs upserts the caller's preferences and returns them.
func (s *Service) UpdateNotificationPrefs(ctx context.Context, userID string, p NotificationPrefs) (NotificationPrefs, error) {
	const q = `
		INSERT INTO cf_notification_prefs
			(user_id, push, email, sms, contribution_alerts, campaign_updates, marketing, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			push = EXCLUDED.push,
			email = EXCLUDED.email,
			sms = EXCLUDED.sms,
			contribution_alerts = EXCLUDED.contribution_alerts,
			campaign_updates = EXCLUDED.campaign_updates,
			marketing = EXCLUDED.marketing,
			updated_at = NOW()`
	if _, err := s.db.Exec(ctx, q,
		userID, p.Push, p.Email, p.SMS, p.ContributionAlerts, p.CampaignUpdates, p.Marketing,
	); err != nil {
		return NotificationPrefs{}, err
	}
	return p, nil
}

// newTicketReference returns a human-readable reference of the form SPL-TK-####.
func newTicketReference() string {
	return fmt.Sprintf("SPL-TK-%04d", rand.Intn(10000))
}

// DTOs in this package mirror the mobile TypeScript contract
// (mobile-app/reactnative/src/features/crowdfunding/types/crowdfunding.types.ts).
// All field names are camelCase to match the client exactly.

// HelpArticle matches the client HelpArticle.
type HelpArticle struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
	Topic    string `json:"topic"`
}

// TicketMessage matches the client TicketMessage.
type TicketMessage struct {
	ID        string `json:"id"`
	From      string `json:"from"` // 'user' | 'support'
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

// SupportTicket matches the client SupportTicket.
type SupportTicket struct {
	ID        string          `json:"id"`
	Reference string          `json:"reference"`
	Subject   string          `json:"subject"`
	Category  string          `json:"category"` // TicketCategory
	Status    string          `json:"status"`   // TicketStatus
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	Messages  []TicketMessage `json:"messages"`
}

// CreateTicketInput matches the client CreateTicketInput.
type CreateTicketInput struct {
	Category string `json:"category" binding:"required"`
	Subject  string `json:"subject" binding:"required,min=2,max=200"`
	Body     string `json:"body" binding:"required,min=1"`
}

// AppNotification matches the client AppNotification.
type AppNotification struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"` // AppNotificationType
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	CreatedAt  string  `json:"createdAt"`
	Read       bool    `json:"read"`
	CampaignID *string `json:"campaignId"`
}

// NotificationPrefs matches the client NotificationPrefs.
type NotificationPrefs struct {
	Push               bool `json:"push"`
	Email              bool `json:"email"`
	SMS                bool `json:"sms"`
	ContributionAlerts bool `json:"contributionAlerts"`
	CampaignUpdates    bool `json:"campaignUpdates"`
	Marketing          bool `json:"marketing"`
}

// ReplyTicketInput is the body for POST /support/tickets/:id/reply.
type ReplyTicketInput struct {
	Body string `json:"body" binding:"required,min=1"`
}

// These feed the creator performance screen's Views, Shares, Conversion and
// traffic-source figures. Before this existed those numbers were derived from a
// hash of the campaign id (see the migration header for the exact formula), so
// they looked plausible without being real.
// Writes are backend-only: cf_campaign_events grants no INSERT to
// `authenticated`, so a client cannot inflate its own counts by posting rows
// straight at PostgREST.

// ErrInvalidEvent is returned when the event type or campaign is not usable.
var ErrInvalidEvent = errors.New("engage: invalid campaign event")

// knownSources is the channel vocabulary the traffic-source breakdown groups on.
// Anything unrecognised is normalised to "other" rather than stored verbatim, so
// a typo or a spoofed value from a client cannot create a junk row in the
// creator's breakdown.
var knownSources = map[string]string{
	"direct":         "Direct",
	"whatsapp":       "WhatsApp",
	"facebook":       "Facebook",
	"instagram":      "Instagram",
	"twitter":        "Twitter/X",
	"x":              "Twitter/X",
	"telegram":       "Telegram",
	"linkedin":       "LinkedIn",
	"spotlight_feed": "Spotlight feed",
	"email":          "Email",
	"sms":            "SMS",
	"other":          "Other",
}

// NormaliseSource maps a caller-supplied channel onto the known vocabulary.
// Unknown or empty values become "other"/"direct" rather than being trusted.
func NormaliseSource(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "direct"
	}
	if _, ok := knownSources[s]; ok {
		return s
	}
	return "other"
}

// SourceLabel returns the display label for a stored source key.
func SourceLabel(key string) string {
	if label, ok := knownSources[key]; ok {
		return label
	}
	return "Other"
}

// RecordCampaignEvent appends one VIEW or SHARE for a campaign.
// userID may be empty — campaign pages are public and an anonymous view is still
// a view; anonymousID then carries the device/session so unique-viewer counts
// stay meaningful. The insert is deliberately not idempotent: repeat views are
// real events, and de-duplication (unique viewers vs total views) is a decision
// for the read side, not the write side.
func (s *Service) RecordCampaignEvent(ctx context.Context, campaignID, eventType, source, userID, anonymousID string) error {
	et := strings.ToUpper(strings.TrimSpace(eventType))
	if et != "VIEW" && et != "SHARE" {
		return ErrInvalidEvent
	}
	if strings.TrimSpace(campaignID) == "" {
		return ErrInvalidEvent
	}

	// A NULL actor is an anonymous viewer; an empty string would violate the FK.
	var actor any
	if strings.TrimSpace(userID) != "" {
		actor = userID
	}

	const q = `
		INSERT INTO cf_campaign_events (campaign_id, event_type, source, actor_user_id, anonymous_id)
		VALUES ($1, $2, $3, $4, $5)`
	if _, err := s.db.Exec(ctx, q, campaignID, et, NormaliseSource(source), actor, strings.TrimSpace(anonymousID)); err != nil {
		return err
	}

	// Feed the member's recently-viewed rail. cf_recently_viewed existed with a
	// read endpoint and no writer at all — an authenticated VIEW is exactly the
	// signal it was built for. Best-effort: a failed recency upsert must not
	// lose the analytics event that just committed.
	if et == "VIEW" && actor != nil {
		_, _ = s.db.Exec(ctx, `
			INSERT INTO cf_recently_viewed (user_id, campaign_id)
			VALUES ($1, $2)
			ON CONFLICT (user_id, campaign_id) DO UPDATE SET viewed_at = NOW()`,
			userID, campaignID)
	}
	return nil
}

// Broadcast — a creator's one-time message to everyone who has backed their
// campaign (the mobile "Message contributors" screen, CF-008).
// Delivery scope: this posts a REAL in-app notification (cf_notifications,
// the same table GetNotifications/MarkNotificationsRead already read/write)
// to every distinct backer, honoring each backer's own campaign_updates
// preference (cf_notification_prefs) — an opted-out backer is not messaged.
// The requested push/email channels are recorded on the notification for a
// future dispatcher, but no push or email actually leaves the platform — there
// is no APNs/FCM/Resend wiring in this module and this function does not
// fabricate one. recipients in the response is an honest count of who was
// actually notified in-app.

const (
	minBroadcastSubject = 4
	maxBroadcastSubject = 200
	minBroadcastBody    = 11
	maxBroadcastBody    = 5000
)

var (
	// ErrCannotBroadcast gates sending to the campaign owner — distinct from
	// ErrCannotPublishUpdate so the message names the right feature.
	ErrCannotBroadcast = errors.New("only the campaign creator can message contributors")
	// ErrBroadcastSubjectTooShort/TooLong mirror the mobile client's own
	// validation (subject.trim().length > 3) — enforced server-side too,
	// since client validation alone is never trustworthy.
	ErrBroadcastSubjectTooShort = errors.New("broadcast subject is too short")
	ErrBroadcastSubjectTooLong  = errors.New("broadcast subject is too long")
	// ErrBroadcastBodyTooShort/TooLong mirror body.trim().length > 10.
	ErrBroadcastBodyTooShort = errors.New("broadcast message is too short")
	ErrBroadcastBodyTooLong  = errors.New("broadcast message is too long")
	// ErrNoBroadcastChannel mirrors the client's (push || email) requirement.
	ErrNoBroadcastChannel = errors.New("select at least one channel to send via")
)

// BroadcastInput is the POST /campaigns/:id/broadcast body. Field names match
// the mobile BroadcastInput type exactly (campaignId also arrives there, but
// the path param is authoritative — mirrors PostUpdateInput's own comment).
type BroadcastInput struct {
	Subject      string `json:"subject"`
	Body         string `json:"body"`
	ChannelPush  bool   `json:"channelPush"`
	ChannelEmail bool   `json:"channelEmail"`
}

// BroadcastResult matches the mobile client's { recipients: number }.
type BroadcastResult struct {
	Recipients int `json:"recipients"`
}

func cleanBroadcast(subject, body string) (string, string, error) {
	s := strings.TrimSpace(subject)
	if len([]rune(s)) < minBroadcastSubject {
		return "", "", ErrBroadcastSubjectTooShort
	}
	if len([]rune(s)) > maxBroadcastSubject {
		return "", "", ErrBroadcastSubjectTooLong
	}
	b := strings.TrimSpace(body)
	if len([]rune(b)) < minBroadcastBody {
		return "", "", ErrBroadcastBodyTooShort
	}
	if len([]rune(b)) > maxBroadcastBody {
		return "", "", ErrBroadcastBodyTooLong
	}
	return s, b, nil
}

// BroadcastToContributors messages every distinct, currently-opted-in backer
// of a campaign. Creator only.
func (s *Service) BroadcastToContributors(ctx context.Context, campaignID, authorID string, in BroadcastInput) (*BroadcastResult, error) {
	if authorID == "" {
		return nil, ErrUnauthenticated
	}
	if !in.ChannelPush && !in.ChannelEmail {
		return nil, ErrNoBroadcastChannel
	}
	subject, body, err := cleanBroadcast(in.Subject, in.Body)
	if err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}

	var creatorID string
	if err := s.db.QueryRow(ctx,
		`SELECT creator_id::text FROM campaigns WHERE id = $1 AND deleted_at IS NULL`, campaignID,
	).Scan(&creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	if authorID != creatorID {
		return nil, ErrCannotBroadcast
	}

	// Distinct backers who actually hold money in this campaign (same
	// allowlist — 'escrowed'/'released' — as the canonical contributor-count
	// query in tests/crowdfunding/contributor_count_live_db_test.go, so this
	// never diverges from what the campaign already reports as its backer
	// count), excluding anyone who has opted out of campaign_updates. A
	// backer with no cf_notification_prefs row yet defaults to opted-in,
	// matching defaultPrefs() below.
	const recipientsQ = `
		SELECT DISTINCT k.contributor_id::text
		  FROM contributions k
		  LEFT JOIN cf_notification_prefs p ON p.user_id = k.contributor_id
		 WHERE k.campaign_id = $1
		   AND k.status IN ('escrowed','released')
		   AND COALESCE(p.campaign_updates, TRUE) = TRUE`
	rows, err := s.db.Query(ctx, recipientsQ, campaignID)
	if err != nil {
		return nil, err
	}
	var recipients []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return nil, err
		}
		recipients = append(recipients, uid)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	if len(recipients) == 0 {
		return &BroadcastResult{Recipients: 0}, nil
	}

	batch := &pgx.Batch{}
	for _, uid := range recipients {
		batch.Queue(`
			INSERT INTO cf_notifications (user_id, type, title, body, campaign_id)
			VALUES ($1, 'campaign_broadcast', $2, $3, $4)`,
			uid, subject, body, campaignID)
	}
	br := s.db.SendBatch(ctx, batch)
	for range recipients {
		if _, err := br.Exec(); err != nil {
			_ = br.Close()
			return nil, err
		}
	}
	if err := br.Close(); err != nil {
		return nil, err
	}

	return &BroadcastResult{Recipients: len(recipients)}, nil
}

// Campaign supporting documents.
// The odd one out among the campaign's nested data. Milestones, budget, reward
// tiers and the beneficiary were all collected by the wizard and thrown away by
// the server; documents were never collected at all — `documentLabels` on the
// draft is initialised, reset, and never written. So this is not a persistence
// fix, it is the whole path: bytes to R2 through the upload route, a row here,
// and a list the campaign page can render.

var (
	// ErrDocumentNotFound is returned for a missing or removed document.
	ErrDocumentNotFound = errors.New("document not found")
	// ErrEmptyLabel rejects a whitespace-only label.
	ErrEmptyLabel = errors.New("document label is required")
	// ErrBadDocumentType rejects a type the list cannot render.
	ErrBadDocumentType = errors.New("document type must be pdf or image")
	// ErrMissingUpload rejects an attach with nothing uploaded behind it.
	ErrMissingUpload = errors.New("document upload is required")
	// ErrNotDocumentOwner gates attaching to the campaign's creator.
	ErrNotDocumentOwner = errors.New("only the campaign creator can attach a document")
)

// CampaignDocument matches the client CampaignDocument.
// `sizeLabel` is formatted here rather than shipped as raw bytes because the
// client renders it verbatim next to the type ("PDF · 1.2 MB"); leaving the
// formatting to each caller is how two screens end up disagreeing about what a
// megabyte is.
type CampaignDocument struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Type      string `json:"type"`
	SizeLabel string `json:"sizeLabel"`
	Verified  bool   `json:"verified"`
	URL       string `json:"url"`
}

// AttachDocumentInput is the POST /campaigns/:id/documents body. The bytes are
// already in R2 by this point; this records what was uploaded.
type AttachDocumentInput struct {
	Label      string `json:"label"`
	Type       string `json:"type"`
	URL        string `json:"url"`
	StorageKey string `json:"storageKey"`
	SizeBytes  int64  `json:"sizeBytes"`
}

// humanSize renders a byte count the way the list reads it. Deliberately 1024-based
// and one decimal: "0.1 MB" for a 100KB file would be less useful than "100 KB".
func humanSize(b int64) string {
	switch {
	case b <= 0:
		return "—"
	case b < 1024:
		return fmt.Sprintf("%d B", b)
	case b < 1024*1024:
		return fmt.Sprintf("%.0f KB", float64(b)/1024)
	default:
		return fmt.Sprintf("%.1f MB", float64(b)/(1024*1024))
	}
}

// ListDocuments returns a campaign's supporting documents in display order.
func (s *Service) ListDocuments(ctx context.Context, campaignID string) ([]CampaignDocument, error) {
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}
	const q = `
		SELECT id::text, label, doc_type, size_bytes, verified, url
		  FROM cf_campaign_documents
		 WHERE campaign_id = $1 AND deleted_at IS NULL
		 ORDER BY sort_order ASC, created_at ASC`
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CampaignDocument, 0)
	for rows.Next() {
		var d CampaignDocument
		var size int64
		if err := rows.Scan(&d.ID, &d.Label, &d.Type, &size, &d.Verified, &d.URL); err != nil {
			return nil, err
		}
		d.SizeLabel = humanSize(size)
		out = append(out, d)
	}
	return out, rows.Err()
}

// AttachDocument records an already-uploaded file against a campaign.
// Creator only: the Documents screen presents this list as the campaign's own
// evidence, so a stranger attaching to it would be putting their document behind
// someone else's fundraiser.
// `verified` is never set here. A backer reads that badge as "somebody checked
// this"; it is granted by review, the same rule as the beneficiary's badge.
func (s *Service) AttachDocument(ctx context.Context, campaignID, uploaderID string, in AttachDocumentInput) (*CampaignDocument, error) {
	if uploaderID == "" {
		return nil, ErrUnauthenticated
	}
	label := strings.TrimSpace(in.Label)
	if label == "" {
		return nil, ErrEmptyLabel
	}
	docType := strings.ToLower(strings.TrimSpace(in.Type))
	if docType != "pdf" && docType != "image" {
		return nil, ErrBadDocumentType
	}
	url := strings.TrimSpace(in.URL)
	key := strings.TrimSpace(in.StorageKey)
	if url == "" || key == "" {
		return nil, ErrMissingUpload
	}
	// The key must be one the upload route produced. Without this a caller could
	// attach any string and the list would carry a URL nobody vouched for.
	if !strings.HasPrefix(key, "crowdfunding/documents/") {
		return nil, ErrMissingUpload
	}
	if in.SizeBytes < 0 {
		return nil, ErrMissingUpload
	}
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}

	var creatorID string
	if err := s.db.QueryRow(ctx,
		`SELECT creator_id::text FROM campaigns WHERE id = $1 AND deleted_at IS NULL`, campaignID,
	).Scan(&creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	if uploaderID != creatorID {
		return nil, ErrNotDocumentOwner
	}

	// Appended to the end of the list the creator already has.
	var next int
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(max(sort_order)+1, 0) FROM cf_campaign_documents WHERE campaign_id = $1`, campaignID,
	).Scan(&next); err != nil {
		return nil, err
	}

	var id string
	var created time.Time
	// Re-attaching the same object is the same document, not a second copy in the
	// list — the unique index on (campaign_id, storage_key) is what says so.
	if err := s.db.QueryRow(ctx, `
		INSERT INTO cf_campaign_documents (campaign_id, uploader_id, label, doc_type, storage_key, url, size_bytes, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (campaign_id, storage_key) DO UPDATE
		   SET label = EXCLUDED.label, doc_type = EXCLUDED.doc_type, url = EXCLUDED.url,
		       size_bytes = EXCLUDED.size_bytes, deleted_at = NULL
		RETURNING id::text, created_at`,
		campaignID, uploaderID, label, docType, key, url, in.SizeBytes, next,
	).Scan(&id, &created); err != nil {
		return nil, err
	}
	return &CampaignDocument{
		ID: id, Label: label, Type: docType, SizeLabel: humanSize(in.SizeBytes),
		Verified: false, URL: url,
	}, nil
}

// Campaign updates — the creator's posts to their backers.
// The post-update screen, the updates timeline and the "Updates" block on the
// campaign detail all existed already; GetDetail returned a literal empty array,
// so a published update vanished the moment the success screen was dismissed.
// One rule lives here rather than in the database, because it needs the campaign:
// only the campaign's creator may publish. An update is the campaign speaking to
// the people who funded it, and the timeline carries no author name precisely
// because everything on it is assumed to be the creator's own voice.

const (
	maxUpdateTitle = 140
	maxUpdateBody  = 5000
)

var (
	// ErrUpdateNotFound is returned for a missing or deleted update.
	ErrUpdateNotFound = errors.New("update not found")
	// ErrEmptyTitle rejects a whitespace-only title before it reaches the CHECK.
	ErrEmptyTitle = errors.New("update title is required")
	// ErrTitleTooLong mirrors the column limit.
	ErrTitleTooLong = errors.New("update title is too long")
	// ErrEmptyUpdateBody rejects a whitespace-only body.
	ErrEmptyUpdateBody = errors.New("update body is required")
	// ErrUpdateBodyTooLong mirrors the column limit.
	ErrUpdateBodyTooLong = errors.New("update body is too long")
	// ErrCannotPublishUpdate gates publishing to the campaign owner. Distinct from
	// ErrNotCampaignCreator, which is the comments rule: reusing that one made a
	// refused update say "only the campaign creator can REPLY", which is a message
	// about a different feature and leaves the user with nothing to act on.
	ErrCannotPublishUpdate = errors.New("only the campaign creator can publish an update")
)

// CampaignUpdate matches the client CampaignUpdate.
type CampaignUpdate struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	ImageURL  *string `json:"imageUrl"`
	CreatedAt string  `json:"createdAt"`
	LikeCount int     `json:"likeCount"`
}

// PostUpdateInput is the POST /campaigns/:id/updates body. campaignId also
// arrives in the path; the client sends it in the body too, and the path wins.
type PostUpdateInput struct {
	Title    string  `json:"title"`
	Body     string  `json:"body"`
	ImageURI *string `json:"imageUri"`
}

func cleanUpdate(title, body string) (string, string, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return "", "", ErrEmptyTitle
	}
	if len([]rune(t)) > maxUpdateTitle {
		return "", "", ErrTitleTooLong
	}
	b := strings.TrimSpace(body)
	if b == "" {
		return "", "", ErrEmptyUpdateBody
	}
	if len([]rune(b)) > maxUpdateBody {
		return "", "", ErrUpdateBodyTooLong
	}
	return t, b, nil
}

// ListUpdates returns a campaign's updates, newest first — the order the
// timeline renders, where the first card is the live one.
// No user is required by this method. The route still sits behind the finance
// group's auth, like the campaign detail that embeds the same rows, so an
// anonymous request never reaches it.
func (s *Service) ListUpdates(ctx context.Context, campaignID string) ([]CampaignUpdate, error) {
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}
	const q = `
		SELECT u.id::text, u.title, u.body, u.image_url, u.created_at,
		       (SELECT count(*) FROM cf_update_likes l WHERE l.update_id = u.id)::int
		  FROM cf_campaign_updates u
		 WHERE u.campaign_id = $1 AND u.deleted_at IS NULL
		 ORDER BY u.created_at DESC, u.id DESC`
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Never nil: the detail payload embeds this and the timeline maps over it.
	out := make([]CampaignUpdate, 0)
	for rows.Next() {
		var u CampaignUpdate
		var created time.Time
		if err := rows.Scan(&u.ID, &u.Title, &u.Body, &u.ImageURL, &created, &u.LikeCount); err != nil {
			return nil, err
		}
		u.CreatedAt = timeutil.RFC3339(created)
		out = append(out, u)
	}
	return out, rows.Err()
}

// PostUpdate publishes an update. Creator only.
func (s *Service) PostUpdate(ctx context.Context, campaignID, authorID string, in PostUpdateInput) (*CampaignUpdate, error) {
	if authorID == "" {
		return nil, ErrUnauthenticated
	}
	title, body, err := cleanUpdate(in.Title, in.Body)
	if err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}

	var creatorID string
	if err := s.db.QueryRow(ctx,
		`SELECT creator_id::text FROM campaigns WHERE id = $1 AND deleted_at IS NULL`, campaignID,
	).Scan(&creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	if authorID != creatorID {
		return nil, ErrCannotPublishUpdate
	}

	// An empty imageUri is stored as NULL, not "": the client renders the image
	// block on truthiness, and "" would produce a broken <Image> with no source.
	var image *string
	if in.ImageURI != nil && strings.TrimSpace(*in.ImageURI) != "" {
		trimmed := strings.TrimSpace(*in.ImageURI)
		image = &trimmed
	}

	var id string
	var created time.Time
	if err := s.db.QueryRow(ctx, `
		INSERT INTO cf_campaign_updates (campaign_id, author_id, title, body, image_url)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text, created_at`,
		campaignID, authorID, title, body, image,
	).Scan(&id, &created); err != nil {
		return nil, err
	}
	return &CampaignUpdate{
		ID: id, Title: title, Body: body, ImageURL: image,
		CreatedAt: timeutil.RFC3339(created), LikeCount: 0,
	}, nil
}

// LikeUpdate records that a backer found an update encouraging. Idempotent: the
// unique index means a second tap is the same as the first, and the returned
// count is read back so the caller never has to guess.
func (s *Service) LikeUpdate(ctx context.Context, updateID, userID string) (int, error) {
	if userID == "" {
		return 0, ErrUnauthenticated
	}
	if _, err := uuid.Parse(updateID); err != nil {
		return 0, ErrUpdateNotFound
	}
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT true FROM cf_campaign_updates WHERE id = $1 AND deleted_at IS NULL`, updateID,
	).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrUpdateNotFound
		}
		return 0, err
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO cf_update_likes (update_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (update_id, user_id) DO NOTHING`, updateID, userID); err != nil {
		return 0, err
	}
	var count int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*)::int FROM cf_update_likes WHERE update_id = $1`, updateID,
	).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}
