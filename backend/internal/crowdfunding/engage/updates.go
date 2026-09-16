package engage

// Campaign updates — the creator's posts to their backers.
//
// The post-update screen, the updates timeline and the "Updates" block on the
// campaign detail all existed already; GetDetail returned a literal empty array,
// so a published update vanished the moment the success screen was dismissed.
//
// One rule lives here rather than in the database, because it needs the campaign:
// only the campaign's creator may publish. An update is the campaign speaking to
// the people who funded it, and the timeline carries no author name precisely
// because everything on it is assumed to be the creator's own voice.

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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
//
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
		u.CreatedAt = rfc3339(created)
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
		CreatedAt: rfc3339(created), LikeCount: 0,
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
