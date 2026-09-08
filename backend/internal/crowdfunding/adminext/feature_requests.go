package adminext

// Crowdfunding OWNER FEATURE-REQUEST queue (admin side).
//
// The creator surface lets a campaign owner ASK to be placed on the featured
// rail (POST /api/v1/crowdfunding/creator/campaigns/:id/feature-request), which
// writes a PENDING row to cf_feature_requests and deliberately does NOT touch
// campaigns.featured — a creator who could self-promote would be publishing
// themselves straight onto the app's most prominent public surface. This file
// is the other half: the operator queue that reads those requests and decides
// them.
//
// RULE — approval is the ONLY path from a request to a placement, and it
// re-checks the campaign is still ACTIVE under lock. A campaign can sit in the
// queue for days; if it was frozen for fraud or rejected in the meantime,
// approving the stale request would put unreviewed content on a public rail.
// This is the same ACTIVE-only promotion rule guardFlagPromotion enforces for
// the direct flags PATCH in featured.go, applied at the other entry point.
//
// Rejection is NOT status-gated: any pending request can be rejected whatever
// the campaign's state, because refusing a placement never publishes anything.
// That mirrors featured.go's rule that DEMOTION is never status-gated.
//
// No migration: cf_feature_requests (with status, note, admin_note, decided_by,
// decided_at) was added by
// supabase/migrations/20270112000000_crowdfunding_owner_selfmanage.sql.

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─── Errors ──────────────────────────────────────────────────────────────────

// ErrFeatureRequestNotFound is returned when the request id does not exist.
var ErrFeatureRequestNotFound = errors.New("adminext: feature request not found")

// ErrFeatureRequestNotPending is returned when a decision targets a request that
// has already been decided or withdrawn. Deciding twice is refused rather than
// silently re-applied: a second approve on an already-APPROVED request would
// re-set featured on a campaign an operator may since have deliberately pulled.
var ErrFeatureRequestNotPending = errors.New("adminext: feature request is not pending")

// featureRequestStatusPending is the only status a decision may act on.
const featureRequestStatusPending = "PENDING"

// ─── DTO ─────────────────────────────────────────────────────────────────────

// AdminFeatureRequest is the queue row rendered by the admin console.
//
// Note carries the ADMIN's decision note (cf_feature_requests.admin_note), not
// the owner's original request note — the console renders it as the reason a
// request was rejected. Both it and DecidedAt are pointers so an undecided
// request emits an explicit null rather than an empty string or a zero date,
// which the console distinguishes.
//
// All money is BIGINT kobo; RaisedKobo is DERIVED from contributions on every
// read, never a stored balance.
type AdminFeatureRequest struct {
	ID               string  `json:"id"`
	CampaignID       string  `json:"campaignId"`
	CampaignTitle    string  `json:"campaignTitle"`
	Status           string  `json:"status"`         // PENDING|APPROVED|REJECTED|WITHDRAWN
	CampaignStatus   string  `json:"campaignStatus"` // the campaign's review_status
	RaisedKobo       int64   `json:"raisedKobo"`
	GoalKobo         int64   `json:"goalKobo"`
	ContributorCount int     `json:"contributorCount"`
	RequestedBy      string  `json:"requestedBy"`
	RequestedAt      string  `json:"requestedAt"`
	Note             *string `json:"note"`
	DecidedAt        *string `json:"decidedAt"`
}

// ─── Queries ─────────────────────────────────────────────────────────────────

// featureRequestCols is the shared projection. raised_kobo is derived from the
// contributions ledger on every read.
const featureRequestCols = `
	fr.id::text, fr.campaign_id::text, c.title, fr.status, c.review_status,
	COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
	          WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0) AS raised_kobo,
	c.goal_kobo, c.contributor_count,
	fr.requested_by::text, fr.created_at, fr.admin_note, fr.decided_at`

// featureRequestFrom joins the campaign the request is about. Soft-deleted
// campaigns are excluded everywhere: an owner who deleted their campaign has no
// business still occupying the placement queue (DeleteCampaign already retires
// their pending request, so this is belt-and-braces against older rows).
const featureRequestFrom = `
	FROM cf_feature_requests fr
	JOIN campaigns c ON c.id = fr.campaign_id
	WHERE c.deleted_at IS NULL`

func scanFeatureRequest(scan func(dest ...any) error) (AdminFeatureRequest, error) {
	var (
		f         AdminFeatureRequest
		createdAt time.Time
		decidedAt *time.Time
	)
	err := scan(&f.ID, &f.CampaignID, &f.CampaignTitle, &f.Status, &f.CampaignStatus,
		&f.RaisedKobo, &f.GoalKobo, &f.ContributorCount,
		&f.RequestedBy, &createdAt, &f.Note, &decidedAt)
	if err != nil {
		return f, err
	}
	f.RequestedAt = rfc3339(createdAt)
	if decidedAt != nil {
		s := rfc3339(*decidedAt)
		f.DecidedAt = &s
	}
	return f, nil
}

// ListFeatureRequests returns the placement queue, PENDING first (that is the
// operator's actual work list) then newest-decided. An optional status filter
// mirrors ListRefunds.
func (s *Service) ListFeatureRequests(ctx context.Context, status string) ([]AdminFeatureRequest, error) {
	q := `SELECT ` + featureRequestCols + featureRequestFrom
	args := []any{}
	if strings.TrimSpace(status) != "" {
		q += ` AND fr.status = $1`
		args = append(args, strings.ToUpper(strings.TrimSpace(status)))
	}
	q += ` ORDER BY (fr.status = 'PENDING') DESC, fr.created_at DESC LIMIT 200`

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AdminFeatureRequest{}
	for rows.Next() {
		f, err := scanFeatureRequest(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// getFeatureRequest reads one queue row. q is a pool or a tx, so the post-decision
// read can run inside the deciding transaction.
func getFeatureRequest(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, requestID string) (*AdminFeatureRequest, error) {
	sql := `SELECT ` + featureRequestCols + featureRequestFrom + ` AND fr.id = $1`
	f, err := scanFeatureRequest(q.QueryRow(ctx, sql, requestID).Scan)
	if err != nil {
		return nil, ErrFeatureRequestNotFound
	}
	return &f, nil
}

// ─── Pure helpers (unit-tested without a database) ───────────────────────────

// guardFeatureDecision enforces the two rules a decision must satisfy.
//
// A decision may only act on a PENDING request. Approval additionally requires
// the campaign to STILL be ACTIVE — the request may have been sitting in the
// queue while a moderator froze or rejected the campaign, and approving it then
// would publish unreviewed content to a public rail. Rejection is deliberately
// not status-gated: refusing a placement publishes nothing.
func guardFeatureDecision(requestStatus, campaignReviewStatus string, approve bool) error {
	if requestStatus != featureRequestStatusPending {
		return ErrFeatureRequestNotPending
	}
	if approve && campaignReviewStatus != reviewStatusActive {
		return ErrCampaignNotActive
	}
	return nil
}

// decisionStatus maps the approve flag to the status written.
func decisionStatus(approve bool) string {
	if approve {
		return "APPROVED"
	}
	return "REJECTED"
}

// decisionAction maps the approve flag to its audit action name.
func decisionAction(approve bool) string {
	if approve {
		return "campaign.feature_request.approve"
	}
	return "campaign.feature_request.reject"
}

// nullableActor renders an admin id for a UUID column: an empty id becomes SQL
// NULL rather than the empty string, which would abort the statement on the
// uuid cast.
func nullableActor(adminID string) any {
	if strings.TrimSpace(adminID) == "" {
		return nil
	}
	return adminID
}

// ─── Decision ────────────────────────────────────────────────────────────────

// DecideFeatureRequest approves or rejects a pending feature request.
//
// ATOMICITY: setting campaigns.featured and marking the request APPROVED happen
// in ONE transaction, together with the audit row. A half-applied decision is
// the failure that matters here — a campaign flagged featured with its request
// still PENDING would be re-approved by the next operator, and a request marked
// APPROVED without the flag would never reach the rail with nothing in the queue
// to show it.
//
// LOCK ORDER — campaigns BEFORE cf_feature_requests, matching every creator-side
// path (RequestFeature, WithdrawFeatureRequest, Unfeature and DeleteCampaign all
// lock the campaign first, then touch the request). Taking them in the natural
// "look up the request, then its campaign" order would be the exact reverse and
// would ABBA-deadlock against an owner withdrawing their request at the moment
// an operator approves it. The request's campaign_id is therefore resolved with
// an UNLOCKED read first — no code path ever reassigns a request to a different
// campaign, so that id is stable — and the request's STATUS, which does change,
// is re-read under the lock afterwards and never trusted from the unlocked read.
func (s *Service) DecideFeatureRequest(ctx context.Context, requestID, adminID string, approve bool, note string) (*AdminFeatureRequest, error) {
	if strings.TrimSpace(requestID) == "" {
		return nil, ErrFeatureRequestNotFound
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// 1. Unlocked read for the campaign id ONLY (stable for the row's lifetime).
	var campaignID string
	if err := tx.QueryRow(ctx,
		`SELECT campaign_id::text FROM cf_feature_requests WHERE id = $1`, requestID).
		Scan(&campaignID); err != nil {
		return nil, ErrFeatureRequestNotFound
	}

	// 2. Campaign first — the shared lock order.
	var (
		reviewStatus string
		deletedAt    *time.Time
	)
	if err := tx.QueryRow(ctx,
		`SELECT review_status, deleted_at FROM campaigns WHERE id = $1 FOR UPDATE`, campaignID).
		Scan(&reviewStatus, &deletedAt); err != nil {
		return nil, ErrCampaignNotFound
	}
	// A campaign its owner deleted must never be promotable, whatever the queue
	// still shows.
	if deletedAt != nil {
		return nil, ErrCampaignNotFound
	}

	// 3. Then the request — and re-read the status that the guard depends on, so
	// two operators racing the same request cannot both pass the PENDING check.
	var requestStatus string
	if err := tx.QueryRow(ctx,
		`SELECT status FROM cf_feature_requests WHERE id = $1 FOR UPDATE`, requestID).
		Scan(&requestStatus); err != nil {
		return nil, ErrFeatureRequestNotFound
	}

	if err := guardFeatureDecision(requestStatus, reviewStatus, approve); err != nil {
		return nil, err
	}

	// 4. The placement itself — only on approval, and only ever TRUE here.
	// Clearing a flag stays with the flags PATCH / the owner's unfeature route.
	if approve {
		if _, err := tx.Exec(ctx,
			`UPDATE campaigns SET featured=TRUE, updated_at=NOW() WHERE id=$1`, campaignID); err != nil {
			return nil, err
		}
	}

	// 5. The decision record, in the same transaction as the flag.
	if _, err := tx.Exec(ctx, `
		UPDATE cf_feature_requests
		SET status=$1, admin_note=$2, decided_by=$3, decided_at=NOW(), updated_at=NOW()
		WHERE id=$4`,
		decisionStatus(approve), note, nullableActor(adminID), requestID); err != nil {
		return nil, err
	}

	if err := s.audit(ctx, tx, adminID, decisionAction(approve), requestID+" campaign="+campaignID); err != nil {
		return nil, err
	}

	// Read back INSIDE the tx so the response is exactly what was committed.
	out, err := getFeatureRequest(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
