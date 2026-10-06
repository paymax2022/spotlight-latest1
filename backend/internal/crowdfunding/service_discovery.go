package crowdfunding

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/go-common/ptr"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/go-common/timeutil"
)

// selectCols is the shared projection for campaign list/detail queries.
// raised_kobo is derived from the contributions ledger (never a stored balance).
const selectCols = `
	c.id, c.title, COALESCE(c.summary,''), COALESCE(c.story,''), c.type, c.review_status,
	c.category, c.currency, c.disbursement_model, COALESCE(c.refund_policy,''), c.risk_level,
	c.cover_url, c.location, c.admin_note,
	c.goal_kobo,
	COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0) AS raised_kobo,
	c.contributor_count, c.risk_score, c.verified, c.featured, c.trending, c.urgent,
	c.deadline, COALESCE(c.submitted_at, c.created_at), c.created_at, c.creator_id,
	c.paused_at`

func scanRow(scan func(dest ...any) error) (*reviewRow, error) {
	r := &reviewRow{}
	err := scan(
		&r.id, &r.title, &r.summary, &r.story, &r.typ, &r.reviewStatus,
		&r.category, &r.currency, &r.disbursementModel, &r.refundPolicy, &r.riskLevel,
		&r.coverURL, &r.location, &r.adminNote,
		&r.goalKobo, &r.raisedKobo, &r.contributorCount, &r.riskScore,
		&r.verified, &r.featured, &r.trending, &r.urgent,
		&r.deadline, &r.submittedAt, &r.createdAt, &r.creatorID,
		&r.pausedAt,
	)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (r *reviewRow) toSummary(creatorName, creatorType, creatorVerification string) CampaignSummary {
	return CampaignSummary{
		ID:                  r.id,
		Title:               r.title,
		Summary:             r.summary,
		Type:                r.typ,
		Status:              mobileStatus(r.reviewStatus),
		Category:            r.category,
		CategoryLabel:       categoryLabel(r.category),
		CoverImage:          r.coverURL,
		GoalKobo:            r.goalKobo,
		RaisedKobo:          r.raisedKobo,
		Currency:            r.currency,
		ContributorCount:    r.contributorCount,
		Deadline:            ptr.OrNil(timeutil.RFC3339(r.deadline)),
		Verified:            r.verified,
		Featured:            r.featured,
		Trending:            r.trending,
		Urgent:              r.urgent,
		Location:            r.location,
		CreatorName:         creatorName,
		CreatorType:         creatorType,
		CreatorVerification: creatorVerification,
	}
}

// ListCampaigns runs a discovery query and returns list-card summaries.
func (s *Service) ListCampaigns(ctx context.Context, q CampaignQuery) ([]CampaignSummary, error) {
	where, args := buildDiscoveryWhere(q, 1)
	sql := fmt.Sprintf(`SELECT %s FROM campaigns c %s %s LIMIT 60`, selectCols, where, sortClause(q.Sort))
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CampaignSummary{}
	for rows.Next() {
		r, err := scanRow(rows.Scan)
		if err != nil {
			return nil, err
		}
		name, typ, verif := s.creatorMeta(ctx, r.creatorID)
		out = append(out, r.toSummary(name, typ, verif))
	}
	return out, rows.Err()
}

// GetDetail returns a single campaign's core fields. Most nested arrays are still
// served by dedicated endpoints and stay empty here; `updates` is real, because
// the updates timeline and the campaign page's Updates block both read it from
// this payload and nowhere else.
//
// Visibility mirrors public discovery (buildDiscoveryWhere): anyone may read a
// campaign only while it is publicly live — ACTIVE or COMPLETED (a finished
// fundraiser's page stays linkable) and not owner-paused. Pre-review
// (DRAFT/PENDING_REVIEW/CHANGES_REQUESTED), REJECTED, FROZEN and paused
// campaigns answer to their creator alone: a pending submission can carry
// beneficiary PII and must not be readable by anyone who happens to hold the
// ID. A soft-deleted campaign is gone from every surface, creator included —
// the row survives only to keep its contribution and ledger references
// resolvable. Non-owner views of a hidden campaign return the same
// ErrCampaignNotFound as an absent id, so the error never confirms existence.
// Admin review uses AdminCampaignDetail, a separate path.
func (s *Service) GetDetail(ctx context.Context, id, viewerID string) (map[string]any, error) {
	sql := fmt.Sprintf(`SELECT %s FROM campaigns c WHERE c.id = $1 AND c.deleted_at IS NULL`, selectCols)
	r, err := scanRow(s.db.QueryRow(ctx, sql, id).Scan)
	if err != nil {
		return nil, err
	}
	publiclyVisible := r.pausedAt == nil &&
		(r.reviewStatus == "ACTIVE" || r.reviewStatus == "COMPLETED")
	if !publiclyVisible && r.creatorID != viewerID {
		return nil, ErrCampaignNotFound
	}
	name, typ, verif := s.creatorMeta(ctx, r.creatorID)
	sum := r.toSummary(name, typ, verif)

	// Detail shape the mobile client reads (core fields + empty nested arrays).
	return map[string]any{
		"id": sum.ID, "title": sum.Title, "summary": sum.Summary, "story": r.story,
		"type": sum.Type, "status": sum.Status, "category": sum.Category, "categoryLabel": sum.CategoryLabel,
		"coverImage": sum.CoverImage, "media": []any{},
		"goalKobo": sum.GoalKobo, "raisedKobo": sum.RaisedKobo, "currency": sum.Currency,
		"contributorCount": sum.ContributorCount, "deadline": sum.Deadline, "createdAt": timeutil.RFC3339(r.createdAt),
		"creator": map[string]any{
			"id": r.creatorID, "name": name, "type": typ, "avatarUrl": nil, "verification": verif,
			"location": sum.Location, "campaignsCreated": 1, "totalRaisedKobo": sum.RaisedKobo, "bio": nil,
			"joinedAt": timeutil.RFC3339(r.createdAt), "followed": false,
		},
		"beneficiary": s.campaignBeneficiary(ctx, id), "disbursementModel": r.disbursementModel, "refundPolicy": r.refundPolicy,
		"riskDisclosure": nil, "verified": sum.Verified, "featured": sum.Featured, "trending": sum.Trending,
		"urgent": sum.Urgent, "saved": false,
		"budget": s.campaignBudget(ctx, id), "milestones": s.campaignMilestones(ctx, id), "updates": s.campaignUpdates(ctx, id), "rewardTiers": s.campaignRewardTiers(ctx, id),
		"documents": s.campaignDocuments(ctx, id), "commentCount": s.campaignCommentCount(ctx, id),
		"faqs": []any{}, "tags": []any{}, "location": sum.Location,
	}, nil
}

// campaignDocuments returns the campaign's supporting evidence.
// sizeLabel is formatted here, next to the only other place that formats it, so
// the list and the attach response cannot disagree about what a megabyte is.
func (s *Service) campaignDocuments(ctx context.Context, campaignID string) []map[string]any {
	const q = `
		SELECT id::text, label, doc_type, size_bytes, verified, url
		  FROM cf_campaign_documents
		 WHERE campaign_id = $1 AND deleted_at IS NULL
		 ORDER BY sort_order ASC, created_at ASC`
	out := []map[string]any{}
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, label, docType, url string
		var size int64
		var verified bool
		if err := rows.Scan(&id, &label, &docType, &size, &verified, &url); err != nil {
			return out
		}
		sizeLabel := "—"
		switch {
		case size >= 1024*1024:
			sizeLabel = fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
		case size >= 1024:
			sizeLabel = fmt.Sprintf("%.0f KB", float64(size)/1024)
		case size > 0:
			sizeLabel = fmt.Sprintf("%d B", size)
		}
		out = append(out, map[string]any{
			"id": id, "label": label, "type": docType,
			"sizeLabel": sizeLabel, "verified": verified, "url": url,
		})
	}
	return out
}

// campaignBeneficiary returns who the campaign is for, or nil when none was
// given — which is the honest answer for a campaign raising for its own creator,
// and is what the client renders as "no beneficiary block" rather than an empty
// card.
func (s *Service) campaignBeneficiary(ctx context.Context, campaignID string) any {
	var id, name, relationship string
	var description *string
	var verified bool
	err := s.db.QueryRow(ctx, `
		SELECT id::text, name, relationship, description, verified
		  FROM cf_campaign_beneficiary WHERE campaign_id = $1`, campaignID,
	).Scan(&id, &name, &relationship, &description, &verified)
	if err != nil {
		// No row, or an unreadable one: the campaign page still renders everything
		// else. A missing beneficiary is a normal state, not a failure.
		return nil
	}
	var desc any
	if description != nil {
		desc = *description
	}
	return map[string]any{
		"id": id, "name": name, "relationship": relationship,
		"description": desc, "verified": verified,
	}
}

// campaignBudget returns the "use of funds" lines in the order the creator
// entered them. This was an empty array, so the campaign page showed
// "0 budget items" under a heading that promises to explain where the money goes.
func (s *Service) campaignBudget(ctx context.Context, campaignID string) []map[string]any {
	const q = `
		SELECT id::text, label, amount_kobo, note
		  FROM cf_campaign_budget
		 WHERE campaign_id = $1
		 ORDER BY sort_order ASC, created_at ASC`
	out := []map[string]any{}
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, label string
		var amount int64
		var note *string
		if err := rows.Scan(&id, &label, &amount, &note); err != nil {
			return out
		}
		var n any
		if note != nil {
			n = *note
		}
		out = append(out, map[string]any{"id": id, "label": label, "amountKobo": amount, "note": n})
	}
	return out
}

// campaignRewardTiers returns the tiers a backer can pledge into, cheapest first —
// the order a backer scans them in.
// `claimed` is COUNTED from cf_reward_backers rather than read from the column of
// the same name. The column is a stored counter nothing currently maintains, and a
// count cannot drift: the number shown next to "12 claimed" is the number of
// people who actually took the tier.
func (s *Service) campaignRewardTiers(ctx context.Context, campaignID string) []map[string]any {
	const q = `
		SELECT t.id::text, t.title, t.amount_kobo, COALESCE(t.description,''), t.estimated_delivery,
		       t.tier_limit, t.requires_shipping,
		       (SELECT count(*) FROM cf_reward_backers b WHERE b.tier_id = t.id)::int
		  FROM cf_reward_tiers t
		 WHERE t.campaign_id = $1
		 ORDER BY t.amount_kobo ASC, t.created_at ASC`
	out := []map[string]any{}
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, title, desc string
		var amount int64
		var delivery *string
		var limit *int
		var shipping bool
		var claimed int
		if err := rows.Scan(&id, &title, &amount, &desc, &delivery, &limit, &shipping, &claimed); err != nil {
			return out
		}
		var d, l any
		if delivery != nil {
			d = *delivery
		}
		if limit != nil {
			l = *limit
		}
		out = append(out, map[string]any{
			"id": id, "title": title, "amountKobo": amount, "description": desc,
			"estimatedDelivery": d, "claimed": claimed, "limit": l, "requiresShipping": shipping,
		})
	}
	return out
}

// campaignMilestones returns the campaign's funding plan in display order.
// Degrades to an empty list on a read failure rather than failing the page: the
// story, goal and Contribute button do not depend on the plan rendering.
func (s *Service) campaignMilestones(ctx context.Context, campaignID string) []map[string]any {
	const q = `
		SELECT id::text, title, target_kobo, status, due_at, evidence_count
		  FROM cf_campaign_milestones
		 WHERE campaign_id = $1
		 ORDER BY sort_order ASC, created_at ASC`
	out := []map[string]any{}
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, title, status string
		var target int64
		var evidence int
		var due *time.Time
		if err := rows.Scan(&id, &title, &target, &status, &due, &evidence); err != nil {
			return out
		}
		var dueAt any
		if due != nil {
			dueAt = timeutil.RFC3339(*due)
		}
		out = append(out, map[string]any{
			"id": id, "title": title, "targetKobo": target, "status": status,
			"dueAt": dueAt, "evidenceCount": evidence,
		})
	}
	return out
}

// campaignCommentCount returns how many comments the Q&A thread holds, so the
// detail row can show a count instead of a static invitation. It counts exactly
// what ListComments returns — questions and creator replies alike, minus
// soft-deleted rows — so the number always matches the screen it links to.
// Read failures degrade to 0 rather than failing the whole campaign page, the
// same bargain the other detail helpers make.
func (s *Service) campaignCommentCount(ctx context.Context, campaignID string) int {
	var n int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*)::int FROM cf_campaign_comments
		 WHERE campaign_id = $1 AND deleted_at IS NULL`, campaignID).Scan(&n); err != nil {
		return 0
	}
	return n
}

// campaignUpdates returns the campaign's updates newest-first for the detail
// payload. This used to be a literal empty array, which is why a published update
// never appeared: the timeline and the detail block both read it from here.
// Read failures degrade to an empty list rather than failing the whole campaign
// page — a campaign with an unreadable update feed should still render its story,
// goal and Contribute button.
func (s *Service) campaignUpdates(ctx context.Context, campaignID string) []map[string]any {
	const q = `
		SELECT u.id::text, u.title, u.body, u.image_url, u.created_at,
		       (SELECT count(*) FROM cf_update_likes l WHERE l.update_id = u.id)::int
		  FROM cf_campaign_updates u
		 WHERE u.campaign_id = $1 AND u.deleted_at IS NULL
		 ORDER BY u.created_at DESC, u.id DESC`
	out := []map[string]any{}
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, title, body string
		var image *string
		var created time.Time
		var likes int
		if err := rows.Scan(&id, &title, &body, &image, &created, &likes); err != nil {
			return out
		}
		out = append(out, map[string]any{
			"id": id, "title": title, "body": body, "imageUrl": image,
			"createdAt": timeutil.RFC3339(created), "likeCount": likes,
		})
	}
	return out
}

// creatorMeta resolves a creator's display fields. Falls back gracefully.
func (s *Service) creatorMeta(ctx context.Context, creatorID string) (name, typ, verification string) {
	name, typ, verification = "Campaign creator", "INDIVIDUAL", "KYC"
	// platform_users may lack a name; tolerate absence.
	var full *string
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(NULLIF(btrim(first_name || ' ' || last_name), ''), email) FROM public.platform_users WHERE id = $1`, creatorID,
	).Scan(&full)
	if full != nil && *full != "" {
		name = *full
	}
	return
}

// creatorEmail resolves a creator's login email. Tolerates absence.
func (s *Service) creatorEmail(ctx context.Context, creatorID string) string {
	var email *string
	_ = s.db.QueryRow(ctx, `SELECT email FROM public.platform_users WHERE id = $1`, creatorID).Scan(&email)
	return ptr.DerefZero(email)
}

// AdminCampaignDetail returns the review-console shape (frontend-admin
// CfReviewCampaign): flat creator fields plus the raw (unmapped) review status,
// unlike GetDetail's public/mobile shape which nests creator info and collapses
// CHANGES_REQUESTED into PENDING_REVIEW. Budget/documents/risk-signal
// itemization has no backing tables yet, so those come back as empty arrays
// (never null/omitted) rather than fabricated — the console must not invent
// diligence data it doesn't have.
func (s *Service) AdminCampaignDetail(ctx context.Context, id string) (map[string]any, error) {
	sql := fmt.Sprintf(`SELECT %s FROM campaigns c WHERE c.id = $1`, selectCols)
	r, err := scanRow(s.db.QueryRow(ctx, sql, id).Scan)
	if err != nil {
		return nil, err
	}
	name, typ, verif := s.creatorMeta(ctx, r.creatorID)
	email := s.creatorEmail(ctx, r.creatorID)

	return map[string]any{
		"id": r.id, "title": r.title, "summary": r.summary, "story": r.story,
		"type": r.typ, "status": r.reviewStatus, "category": r.category,
		"coverImage": r.coverURL, "goalKobo": r.goalKobo, "raisedKobo": r.raisedKobo,
		"contributorCount": r.contributorCount,
		"createdAt":        timeutil.RFC3339(r.createdAt),
		"submittedAt":      timeutil.RFC3339(r.submittedAt),
		"creatorName":      name, "creatorType": typ, "creatorVerification": verif, "creatorEmail": email,
		"beneficiaryName": name, "beneficiaryRelationship": "Self",
		"bankLabel":         "Not on file",
		"location":          strutil.Or(ptr.DerefZero(r.location), "Not specified"),
		"disbursementModel": r.disbursementModel, "refundPolicy": r.refundPolicy,
		"budget": []any{}, "documents": []any{},
		"riskLevel": r.riskLevel, "riskScore": r.riskScore, "riskSignals": []any{},
		"adminNote": r.adminNote,
	}, nil
}

// ListCategories returns enabled categories with live campaign counts.
func (s *Service) ListCategories(ctx context.Context) ([]CategoryDTO, error) {
	const q = `
		SELECT cat.id, cat.slug, cat.label, cat.icon, cat.tint,
		       COALESCE((SELECT COUNT(*) FROM campaigns c WHERE c.category = cat.slug AND c.review_status = 'ACTIVE'), 0)
		FROM crowdfunding_categories cat
		WHERE cat.enabled = TRUE
		ORDER BY cat.sort_order ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CategoryDTO{}
	for rows.Next() {
		var d CategoryDTO
		if err := rows.Scan(&d.ID, &d.Slug, &d.Label, &d.Icon, &d.Tint, &d.CampaignCount); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// SubmitForReview creates (or updates a draft to) a campaign in PENDING_REVIEW.
// ErrInvalidSubmission marks a submission the CALLER can fix — a malformed
// milestone, a status they may not set. Without it the handler returned 500 for
// every failure, so "you sent something invalid" was indistinguishable from "the
// server is broken", and a creator whose funding plan was rejected had no way to
// know which field to correct.
var ErrInvalidSubmission = errors.New("invalid submission")

func (s *Service) SubmitForReview(ctx context.Context, creatorID string, req SubmitCampaignRequest) (map[string]any, error) {
	id := uuid.New().String()
	reviewStatus := "DRAFT"
	if req.SubmitForReview {
		reviewStatus = "PENDING_REVIEW"
	}
	// UAT CON-005: this is the only live campaign-creation path (Handler.Create /
	// Service.Create's own deadline check is unwired dead code — no route calls
	// it). A malformed or past deadline used to be silently dropped: a parse
	// failure fell through to the 60-day default with no error, and a genuinely
	// past deadline (e.g. "2020-01-01") was accepted outright, producing a
	// campaign that could never receive a contribution (Contribute() itself
	// already rejects on a past deadline) with nothing telling the creator why.
	var deadline time.Time
	if req.Deadline != nil && strings.TrimSpace(*req.Deadline) != "" {
		t, err := time.Parse(time.RFC3339, *req.Deadline)
		if err != nil {
			return nil, fmt.Errorf("%w: deadline must be RFC3339", ErrInvalidSubmission)
		}
		if t.Before(time.Now()) {
			return nil, fmt.Errorf("%w: deadline must be in the future", ErrInvalidSubmission)
		}
		deadline = t
	} else {
		deadline = time.Now().AddDate(0, 2, 0) // default 60-day window
	}
	const ins = `
		INSERT INTO campaigns
			(id, creator_id, title, summary, story, type, category, goal_kobo, currency,
			 location, refund_policy, disbursement_model, cover_url, status, review_status, deadline, submitted_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NGN',$9,$10,$11,$12,'draft',$13,$14,$15)`
	var submittedAt any
	if req.SubmitForReview {
		submittedAt = time.Now()
	}

	// One transaction for the campaign and its milestones. Separate statements
	// would let a milestone failure leave a published campaign whose funding plan
	// is silently missing — the plan is part of what backers are being asked to
	// fund, not decoration attached afterwards.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, ins,
		id, creatorID, req.Title, req.Summary, req.Story, req.Type, req.Category, req.GoalKobo,
		req.Location, req.RefundPolicy, strutil.OrBlank(req.DisbursementModel, "IMMEDIATE"), req.CoverImageURL,
		reviewStatus, deadline, submittedAt,
	); err != nil {
		return nil, err
	}

	for i, m := range req.Milestones {
		title := strings.TrimSpace(m.Title)
		if title == "" {
			return nil, fmt.Errorf("%w: milestone %d: title is required", ErrInvalidSubmission, i+1)
		}
		if m.TargetKobo < 0 {
			return nil, fmt.Errorf("%w: milestone %d: targetKobo must not be negative", ErrInvalidSubmission, i+1)
		}
		status, err := submitMilestoneStatus(m.Status, i)
		if err != nil {
			return nil, fmt.Errorf("%w: milestone %d: %w", ErrInvalidSubmission, i+1, err)
		}
		var dueAt any
		if m.DueAt != nil && strings.TrimSpace(*m.DueAt) != "" {
			t, perr := time.Parse(time.RFC3339, *m.DueAt)
			if perr != nil {
				return nil, fmt.Errorf("%w: milestone %d: dueAt must be RFC3339", ErrInvalidSubmission, i+1)
			}
			dueAt = t
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO cf_campaign_milestones (campaign_id, title, target_kobo, status, due_at, sort_order)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			id, title, m.TargetKobo, status, dueAt, i,
		); err != nil {
			return nil, err
		}
	}

	for i, b := range req.Budget {
		label := strings.TrimSpace(b.Label)
		if label == "" {
			return nil, fmt.Errorf("%w: budget line %d: label is required", ErrInvalidSubmission, i+1)
		}
		if b.AmountKobo < 0 {
			return nil, fmt.Errorf("%w: budget line %d: amountKobo must not be negative", ErrInvalidSubmission, i+1)
		}
		var note any
		if b.Note != nil && strings.TrimSpace(*b.Note) != "" {
			note = strings.TrimSpace(*b.Note)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO cf_campaign_budget (campaign_id, label, amount_kobo, note, sort_order)
			VALUES ($1,$2,$3,$4,$5)`, id, label, b.AmountKobo, note, i); err != nil {
			return nil, err
		}
	}

	for i, r := range req.RewardTiers {
		title := strings.TrimSpace(r.Title)
		if title == "" {
			return nil, fmt.Errorf("%w: reward tier %d: title is required", ErrInvalidSubmission, i+1)
		}
		if r.AmountKobo < 0 {
			return nil, fmt.Errorf("%w: reward tier %d: amountKobo must not be negative", ErrInvalidSubmission, i+1)
		}
		// A limit of zero would be a tier nobody can ever claim, which is a mistake
		// rather than an intention; unlimited is expressed by omitting it.
		if r.Limit != nil && *r.Limit <= 0 {
			return nil, fmt.Errorf("%w: reward tier %d: limit must be greater than zero, or omitted for unlimited", ErrInvalidSubmission, i+1)
		}
		var desc, delivery, limit any
		if strings.TrimSpace(r.Description) != "" {
			desc = strings.TrimSpace(r.Description)
		}
		if r.EstimatedDelivery != nil && strings.TrimSpace(*r.EstimatedDelivery) != "" {
			delivery = strings.TrimSpace(*r.EstimatedDelivery)
		}
		if r.Limit != nil {
			limit = *r.Limit
		}
		// `claimed` is not inserted: it stays at its column default of zero and the
		// read path counts cf_reward_backers instead, so the number a backer sees is
		// the number of people who actually took the tier.
		if _, err := tx.Exec(ctx, `
			INSERT INTO cf_reward_tiers (campaign_id, title, amount_kobo, description, estimated_delivery, tier_limit, requires_shipping)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			id, title, r.AmountKobo, desc, delivery, limit, r.RequiresShipping); err != nil {
			return nil, err
		}
	}

	if b := req.Beneficiary; b != nil {
		name := strings.TrimSpace(b.Name)
		rel := strings.TrimSpace(b.Relationship)
		// Only reject a beneficiary the caller actually tried to supply. An
		// entirely empty object is treated as "none given" rather than an error,
		// because a campaign raising for its own creator legitimately has none.
		if name != "" || rel != "" || (b.Description != nil && strings.TrimSpace(*b.Description) != "") {
			if len([]rune(name)) < 2 {
				return nil, fmt.Errorf("%w: beneficiary: name is required", ErrInvalidSubmission)
			}
			if rel == "" {
				return nil, fmt.Errorf("%w: beneficiary: relationship is required", ErrInvalidSubmission)
			}
			var desc any
			if b.Description != nil && strings.TrimSpace(*b.Description) != "" {
				desc = strings.TrimSpace(*b.Description)
			}
			// `verified` is never written here: it keeps its column default of false
			// until a reviewer grants it.
			if _, err := tx.Exec(ctx, `
				INSERT INTO cf_campaign_beneficiary (campaign_id, name, relationship, description)
				VALUES ($1,$2,$3,$4)
				ON CONFLICT (campaign_id) DO UPDATE
				   SET name = EXCLUDED.name, relationship = EXCLUDED.relationship,
				       description = EXCLUDED.description, updated_at = now()`,
				id, name, rel, desc); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"campaignId": id, "status": reviewStatus, "reference": "SPL-CFNEW-" + id[:8]}, nil
}

// submitMilestoneStatus decides the status a NEW milestone may carry.
// Only LOCKED and ACTIVE are a creator's to set. RELEASED means money reached
// them and PENDING_REVIEW means evidence is with a reviewer; both are earned
// through the disbursement path, and accepting either here would let a campaign
// show backers "Released" against a milestone no money ever moved for — the one
// thing this screen exists to tell them the truth about.
// An empty status defaults the way the wizard already labels them: the first
// milestone is what the campaign is working on now, the rest are locked behind it.
func submitMilestoneStatus(raw string, index int) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "":
		if index == 0 {
			return "ACTIVE", nil
		}
		return "LOCKED", nil
	case "LOCKED":
		return "LOCKED", nil
	case "ACTIVE":
		return "ACTIVE", nil
	case "RELEASED", "PENDING_REVIEW":
		return "", fmt.Errorf("status %s is earned through review and disbursement, not set at creation", strings.ToUpper(strings.TrimSpace(raw)))
	default:
		return "", fmt.Errorf("unknown status %q", raw)
	}
}

// CampaignSummary is the list-card shape (mobile CampaignSummary).
type CampaignSummary struct {
	ID                  string  `json:"id"`
	Title               string  `json:"title"`
	Summary             string  `json:"summary"`
	Type                string  `json:"type"`
	Status              string  `json:"status"` // client CampaignStatus (review_status)
	Category            string  `json:"category"`
	CategoryLabel       string  `json:"categoryLabel"`
	CoverImage          *string `json:"coverImage"`
	GoalKobo            int64   `json:"goalKobo"`
	RaisedKobo          int64   `json:"raisedKobo"`
	Currency            string  `json:"currency"`
	ContributorCount    int     `json:"contributorCount"`
	Deadline            *string `json:"deadline"`
	Verified            bool    `json:"verified"`
	Featured            bool    `json:"featured"`
	Trending            bool    `json:"trending"`
	Urgent              bool    `json:"urgent"`
	Saved               bool    `json:"saved"`
	Location            *string `json:"location"`
	CreatorName         string  `json:"creatorName"`
	CreatorType         string  `json:"creatorType"`
	CreatorVerification string  `json:"creatorVerification"`
}

// CategoryDTO matches the client CampaignCategory.
type CategoryDTO struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	Label         string `json:"label"`
	Icon          string `json:"icon"`
	Tint          string `json:"tint"`
	CampaignCount int    `json:"campaignCount"`
}

// CategoryStat is one row of AdminStats.CategoryBreakdown.
type CategoryStat struct {
	Category   string `json:"category"`
	Count      int    `json:"count"`
	RaisedKobo int64  `json:"raisedKobo"`
}

// AdminStats matches the admin CfPlatformStats. Every field is derived live
// from a real table; PaymentSuccessRate is the one exception — there is no
// payment-attempt/failure log for crowdfunding contributions (only successful
// contributions are ever inserted), so it stays 0 rather than being computed
// from an unrelated proxy (e.g. refund rate) that would misrepresent it.
type AdminStats struct {
	TotalCampaigns         int            `json:"totalCampaigns"`
	ActiveCampaigns        int            `json:"activeCampaigns"`
	PendingReview          int            `json:"pendingReview"`
	RejectedCampaigns      int            `json:"rejectedCampaigns"`
	TotalRaisedKobo        int64          `json:"totalRaisedKobo"`
	PlatformRevenueKobo    int64          `json:"platformRevenueKobo"`
	EscrowKobo             int64          `json:"escrowKobo"`
	WithdrawalsPending     int            `json:"withdrawalsPending"`
	WithdrawalsPendingKobo int64          `json:"withdrawalsPendingKobo"`
	RefundRequests         int            `json:"refundRequests"`
	FraudAlerts            int            `json:"fraudAlerts"`
	OpenTickets            int            `json:"openTickets"`
	PaymentSuccessRate     float64        `json:"paymentSuccessRate"` // 0-100; see type comment
	CategoryBreakdown      []CategoryStat `json:"categoryBreakdown"`
}

// reviewRow is the internal row scanned for list/detail queries.
type reviewRow struct {
	id, title, summary, story, typ, reviewStatus, category, currency string
	disbursementModel, refundPolicy, riskLevel                       string
	coverURL, location, adminNote                                    *string
	goalKobo, raisedKobo                                             int64
	contributorCount, riskScore                                      int
	verified, featured, trending, urgent                             bool
	deadline                                                         time.Time
	submittedAt, createdAt                                           time.Time
	creatorID                                                        string
	pausedAt                                                         *time.Time
}

// SubmitCampaignRequest is the body for the full create/submit flow.
type SubmitCampaignRequest struct {
	Type              string  `json:"type" binding:"required"`
	Category          string  `json:"category" binding:"required"`
	Title             string  `json:"title" binding:"required,min=2,max=200"`
	Summary           string  `json:"summary"`
	Story             string  `json:"story"`
	GoalKobo          int64   `json:"goalKobo" binding:"required,min=100"`
	Deadline          *string `json:"deadline"`
	Location          string  `json:"location"`
	RefundPolicy      string  `json:"refundPolicy"`
	DisbursementModel string  `json:"disbursementModel"`
	CoverImageURL     *string `json:"coverImageUrl"`
	SubmitForReview   bool    `json:"submitForReview"`
	// Milestones the wizard collected. Until now the DTO accepted none of them, so
	// the creator filled in a funding plan and the server dropped it on the floor —
	// the client's own comment in crowdfunding.api.ts says exactly that.
	Milestones []SubmitMilestoneRequest `json:"milestones"`
	// Budget lines and reward tiers, the other two things the wizard collected and
	// the server used to discard.
	Budget      []SubmitBudgetItemRequest `json:"budget"`
	RewardTiers []SubmitRewardTierRequest `json:"rewardTiers"`
	// Who the campaign is for. Optional — plenty of campaigns raise for the
	// creator themselves and the wizard lets them say so explicitly.
	Beneficiary *SubmitBeneficiaryRequest `json:"beneficiary"`
}

// SubmitBeneficiaryRequest is the wizard's beneficiary step.
// `verified` is deliberately NOT a field. A backer reads that badge as "somebody
// checked who this money is for"; it is granted by review, never asserted by the
// person asking for the money — the same rule as a self-declared RELEASED
// milestone or a self-declared reward claim count.
type SubmitBeneficiaryRequest struct {
	Name         string  `json:"name"`
	Relationship string  `json:"relationship"`
	Description  *string `json:"description"`
}

// SubmitBudgetItemRequest is one "use of funds" line from the create wizard.
type SubmitBudgetItemRequest struct {
	Label      string  `json:"label"`
	AmountKobo int64   `json:"amountKobo"`
	Note       *string `json:"note"`
}

// SubmitRewardTierRequest is one reward tier from the create wizard.
// `claimed` is deliberately NOT a field. How many backers took a tier is a fact
// about what happened, derived from cf_reward_backers; letting a campaign state it
// at creation would let it advertise social proof it has not earned, the same way
// a self-declared RELEASED milestone would advertise money that never moved.
type SubmitRewardTierRequest struct {
	Title             string  `json:"title"`
	AmountKobo        int64   `json:"amountKobo"`
	Description       string  `json:"description"`
	EstimatedDelivery *string `json:"estimatedDelivery"`
	Limit             *int    `json:"limit"`
	RequiresShipping  bool    `json:"requiresShipping"`
}

// SubmitMilestoneRequest is one milestone from the create wizard.
// Status is accepted but CONSTRAINED: see submitMilestoneStatus. RELEASED and
// PENDING_REVIEW are states a milestone earns through review and disbursement,
// never states a creator may declare about their own campaign.
type SubmitMilestoneRequest struct {
	Title      string  `json:"title"`
	TargetKobo int64   `json:"targetKobo"`
	Status     string  `json:"status"`
	DueAt      *string `json:"dueAt"`
}

// ReviewDecisionRequest is the body for admin POST /campaigns/:id/decision.
type ReviewDecisionRequest struct {
	Decision string `json:"decision" binding:"required"` // APPROVE | REJECT | REQUEST_CHANGES | FREEZE | UNFREEZE
	Note     string `json:"note"`
}

// CampaignQuery is the discovery filter parsed from request query params.
type CampaignQuery struct {
	Collection   string // featured | trending | urgent | verified | recommended | recent
	Category     string
	Type         string
	VerifiedOnly bool
	UrgentOnly   bool
	Search       string
	Sort         string // recommended | trending | newest | ending_soon | most_funded | least_funded
	Status       string // review_status filter (admin)
	// AllStatuses is the ADMIN "every status" listing. It exists because an empty
	// Status cannot mean that: empty selects the public default below
	// (review_status='ACTIVE' AND paused_at IS NULL), which is what stops public
	// discovery returning drafts and pending submissions. Overloading empty to
	// mean "no filter" would silently turn that guard off for every public
	// caller, so the admin case gets its own flag instead.
	AllStatuses bool
}

// buildDiscoveryWhere builds the WHERE clause + ordered args for a discovery query.
// startIdx is the first positional placeholder number ($1, $2, ...).
// Pure function — unit-tested without a database.
func buildDiscoveryWhere(q CampaignQuery, startIdx int) (string, []any) {
	var conds []string
	var args []any
	i := startIdx

	add := func(cond string, val any) {
		conds = append(conds, fmt.Sprintf(cond, i))
		args = append(args, val)
		i++
	}

	switch q.Collection {
	case "featured":
		conds = append(conds, "c.featured = TRUE")
	case "trending":
		conds = append(conds, "c.trending = TRUE")
	case "urgent":
		conds = append(conds, "c.urgent = TRUE")
	case "verified":
		conds = append(conds, "c.verified = TRUE")
	}

	if q.Category != "" {
		add("c.category = $%d", q.Category)
	}
	if q.Type != "" {
		add("c.type = $%d", q.Type)
	}
	if q.VerifiedOnly {
		conds = append(conds, "c.verified = TRUE")
	}
	if q.UrgentOnly {
		conds = append(conds, "c.urgent = TRUE")
	}
	// A soft-deleted campaign is gone from EVERY surface, admin listings
	// included — deleted_at is the owner's "this campaign no longer exists",
	// and the row survives only to keep its contributions/review history and
	// its ledger references resolvable.
	conds = append(conds, "c.deleted_at IS NULL")

	if q.Status != "" {
		add("c.review_status = $%d", q.Status)
	} else if q.AllStatuses {
		// Admin, every status: no review_status predicate and no paused_at term,
		// matching the explicit-status admin branch above (an operator must still
		// see paused campaigns). deleted_at is still excluded, above.
	} else {
		// Public discovery only shows live campaigns — unconditionally, so an
		// unfiltered call (no collection/category/search, i.e. "give me every
		// active campaign") doesn't fall through with no review_status guard at
		// all and return PENDING_REVIEW/DRAFT/etc. campaigns to the public.
		// Owner-paused campaigns drop out here too. The pause lives in
		// paused_at rather than review_status (see migration 20270112000000),
		// so it needs its own term — without it, pause would hide nothing.
		// The admin branch above deliberately does NOT filter on paused_at: an
		// operator listing by status must still see a paused campaign.
		conds = append(conds, "c.review_status = 'ACTIVE'", "c.paused_at IS NULL")
	}
	if q.Search != "" {
		// Two placeholders reference the same positional arg ($i) — valid in Postgres.
		conds = append(conds, fmt.Sprintf("(c.title ILIKE '%%' || $%d || '%%' OR c.summary ILIKE '%%' || $%d || '%%')", i, i))
		args = append(args, q.Search)
		i++
	}
	_ = i

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	return where, args
}

// sortClause maps a sort key to an ORDER BY clause (no user input interpolated).
func sortClause(sort string) string {
	switch sort {
	case "newest":
		return "ORDER BY c.created_at DESC"
	case "ending_soon":
		return "ORDER BY c.deadline ASC NULLS LAST"
	case "most_funded":
		return "ORDER BY raised_kobo DESC"
	case "least_funded":
		// Output-column alias used as a standalone ORDER BY term (Postgres-allowed).
		return "ORDER BY raised_kobo ASC"
	case "trending":
		return "ORDER BY c.trending DESC, c.contributor_count DESC"
	default: // recommended
		return "ORDER BY c.verified DESC, c.featured DESC, c.contributor_count DESC"
	}
}

// mobileStatus maps the internal review_status to the mobile CampaignStatus enum.
func mobileStatus(reviewStatus string) string {
	if reviewStatus == "CHANGES_REQUESTED" {
		return "PENDING_REVIEW"
	}
	return reviewStatus
}
