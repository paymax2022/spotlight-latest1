package crowdfunding

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
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
	c.deadline, COALESCE(c.submitted_at, c.created_at), c.created_at, c.creator_id`

func scanRow(scan func(dest ...any) error) (*reviewRow, error) {
	r := &reviewRow{}
	err := scan(
		&r.id, &r.title, &r.summary, &r.story, &r.typ, &r.reviewStatus,
		&r.category, &r.currency, &r.disbursementModel, &r.refundPolicy, &r.riskLevel,
		&r.coverURL, &r.location, &r.adminNote,
		&r.goalKobo, &r.raisedKobo, &r.contributorCount, &r.riskScore,
		&r.verified, &r.featured, &r.trending, &r.urgent,
		&r.deadline, &r.submittedAt, &r.createdAt, &r.creatorID,
	)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func deadlinePtr(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
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
		Deadline:            deadlinePtr(r.deadline),
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
func (s *Service) GetDetail(ctx context.Context, id string) (map[string]any, error) {
	sql := fmt.Sprintf(`SELECT %s FROM campaigns c WHERE c.id = $1`, selectCols)
	r, err := scanRow(s.db.QueryRow(ctx, sql, id).Scan)
	if err != nil {
		return nil, err
	}
	name, typ, verif := s.creatorMeta(ctx, r.creatorID)
	sum := r.toSummary(name, typ, verif)

	// Detail shape the mobile client reads (core fields + empty nested arrays).
	return map[string]any{
		"id": sum.ID, "title": sum.Title, "summary": sum.Summary, "story": r.story,
		"type": sum.Type, "status": sum.Status, "category": sum.Category, "categoryLabel": sum.CategoryLabel,
		"coverImage": sum.CoverImage, "media": []any{},
		"goalKobo": sum.GoalKobo, "raisedKobo": sum.RaisedKobo, "currency": sum.Currency,
		"contributorCount": sum.ContributorCount, "deadline": sum.Deadline, "createdAt": r.createdAt.UTC().Format(time.RFC3339),
		"creator": map[string]any{
			"id": r.creatorID, "name": name, "type": typ, "avatarUrl": nil, "verification": verif,
			"location": sum.Location, "campaignsCreated": 1, "totalRaisedKobo": sum.RaisedKobo, "bio": nil,
			"joinedAt": r.createdAt.UTC().Format(time.RFC3339), "followed": false,
		},
		"beneficiary": nil, "disbursementModel": r.disbursementModel, "refundPolicy": r.refundPolicy,
		"riskDisclosure": nil, "verified": sum.Verified, "featured": sum.Featured, "trending": sum.Trending,
		"urgent": sum.Urgent, "saved": false,
		"budget": []any{}, "milestones": []any{}, "updates": s.campaignUpdates(ctx, id), "rewardTiers": []any{},
		"documents": []any{}, "faqs": []any{}, "tags": []any{}, "location": sum.Location,
	}, nil
}

// campaignUpdates returns the campaign's updates newest-first for the detail
// payload. This used to be a literal empty array, which is why a published update
// never appeared: the timeline and the detail block both read it from here.
//
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
			"createdAt": created.UTC().Format(time.RFC3339), "likeCount": likes,
		})
	}
	return out
}

// creatorMeta resolves a creator's display fields. Falls back gracefully.
func (s *Service) creatorMeta(ctx context.Context, creatorID string) (name, typ, verification string) {
	name, typ, verification = "Campaign creator", "INDIVIDUAL", "KYC"
	// auth.users may expose raw_user_meta_data; tolerate absence.
	var full *string
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(raw_user_meta_data->>'full_name', email) FROM auth.users WHERE id = $1`, creatorID,
	).Scan(&full)
	if full != nil && *full != "" {
		name = *full
	}
	return
}

// creatorEmail resolves a creator's login email. Tolerates absence.
func (s *Service) creatorEmail(ctx context.Context, creatorID string) string {
	var email *string
	_ = s.db.QueryRow(ctx, `SELECT email FROM auth.users WHERE id = $1`, creatorID).Scan(&email)
	if email != nil {
		return *email
	}
	return ""
}

func strOr(p *string, fallback string) string {
	if p != nil && *p != "" {
		return *p
	}
	return fallback
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
		"createdAt":        r.createdAt.UTC().Format(time.RFC3339),
		"submittedAt":      r.submittedAt.UTC().Format(time.RFC3339),
		"creatorName":      name, "creatorType": typ, "creatorVerification": verif, "creatorEmail": email,
		"beneficiaryName": name, "beneficiaryRelationship": "Self",
		"bankLabel":         "Not on file",
		"location":          strOr(r.location, "Not specified"),
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
func (s *Service) SubmitForReview(ctx context.Context, creatorID string, req SubmitCampaignRequest) (map[string]any, error) {
	id := uuid.New().String()
	reviewStatus := "DRAFT"
	if req.SubmitForReview {
		reviewStatus = "PENDING_REVIEW"
	}
	var deadline time.Time
	if req.Deadline != nil {
		if t, err := time.Parse(time.RFC3339, *req.Deadline); err == nil {
			deadline = t
		}
	}
	if deadline.IsZero() {
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
	if _, err := s.db.Exec(ctx, ins,
		id, creatorID, req.Title, req.Summary, req.Story, req.Type, req.Category, req.GoalKobo,
		req.Location, req.RefundPolicy, nz(req.DisbursementModel, "IMMEDIATE"), req.CoverImageURL,
		reviewStatus, deadline, submittedAt,
	); err != nil {
		return nil, err
	}
	return map[string]any{"campaignId": id, "status": reviewStatus, "reference": "SPL-CFNEW-" + id[:8]}, nil
}

func nz(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
