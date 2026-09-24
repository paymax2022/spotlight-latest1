package engage

// Broadcast — a creator's one-time message to everyone who has backed their
// campaign (the mobile "Message contributors" screen).
//
// UAT finding (Crowdfunding CF-008): the mobile client has shipped this
// screen for a while (app/crowdfunding/creator/performance/[id].tsx, a real
// navigable "Message contributors" action, not behind any feature flag) and
// POSTs to /campaigns/:id/broadcast — but neither a Next.js proxy route nor
// a Go handler existed anywhere in the codebase. Every real send 404'd.
//
// Delivery scope: this posts a REAL in-app notification (cf_notifications,
// the same table GetNotifications/MarkNotificationsRead already read/write)
// to every distinct backer, honoring each backer's own campaign_updates
// preference (cf_notification_prefs) — a backer who opted out of campaign
// updates does not get messaged just because the creator chose to send one.
// The requested push/email channels are recorded on the notification so a
// future dispatcher can pick them up, but no push or email actually leaves
// the platform yet — there is no APNs/FCM/Resend wiring anywhere in this
// module to hook into, and this function does not fabricate one (see the
// project-wide "we do not fabricate a provider success" convention, e.g.
// adminext/withdraw_approve.go). recipients in the response is an honest
// count of who was actually notified in-app.

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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
			br.Close()
			return nil, err
		}
	}
	if err := br.Close(); err != nil {
		return nil, err
	}

	return &BroadcastResult{Recipients: len(recipients)}, nil
}
