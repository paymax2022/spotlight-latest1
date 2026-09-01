package engage

// Campaign supporting documents.
//
// The odd one out among the campaign's nested data. Milestones, budget, reward
// tiers and the beneficiary were all collected by the wizard and thrown away by
// the server; documents were never collected at all — `documentLabels` on the
// draft is initialised, reset, and never written. So this is not a persistence
// fix, it is the whole path: bytes to R2 through the upload route, a row here,
// and a list the campaign page can render.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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
//
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
//
// Creator only: the Documents screen presents this list as the campaign's own
// evidence, so a stranger attaching to it would be putting their document behind
// someone else's fundraiser.
//
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
