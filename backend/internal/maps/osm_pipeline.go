package maps

import (
	"context"
	"fmt"
	"log"
	"time"
)

// osm_pipeline.go — the MODERATED, RATE-LIMITED OSM upload pipeline (MAPSERVICE.md §7).
//
// ODbL / OSM ETIQUETTE — NON-NEGOTIABLE:
//   - Only HUMAN-REVIEWED, APPROVED, NON-PII candidates are ever uploaded. PII is
//     stripped and gated upstream (contribution.go); nothing here re-introduces it.
//   - Every upload MUST carry proper changeset attribution: a descriptive
//     `comment`, a `created_by` tag identifying this tool/version, and a `source`
//     tag. Bulk/automated edits must follow the OSM Automated Edits Code of Conduct
//     (discuss with the local community, document the import, be conservative).
//   - Uploads are RATE-LIMITED and batched small to avoid hammering the OSM API and
//     to keep changes human-moderatable. We never fire-and-forget large imports.
//   - The REAL OSM API client (changeset open/upload/close, OAuth2) is OUT OF SCOPE
//     here: this file ships an interface + a Noop implementation. When no OSM
//     credentials are configured we DO NOT fabricate changesets — we leave the
//     candidate 'approved' (staged) and log that credentials are missing.

// OSMUploader uploads one approved, PII-free candidate to OpenStreetMap and returns
// the resulting changeset id. Implementations MUST attach proper changeset
// attribution (comment / created_by / source) per ODbL + OSM etiquette.
type OSMUploader interface {
	Upload(ctx context.Context, c ContributionCandidate) (changesetID string, err error)
}

// ErrOSMNotConfigured signals that no OSM credentials are available, so the upload
// was intentionally skipped (NOT failed, NOT fabricated). The pipeline treats a
// candidate that returns this as "staged" — it stays 'approved' for a later run.
var ErrOSMNotConfigured = fmt.Errorf("maps/osm: credentials not configured — upload skipped (staged)")

// NoopOSMUploader is the default uploader used when no OSM credentials are present.
// It NEVER fabricates a changeset: it returns ErrOSMNotConfigured (with an empty
// changeset id) and logs a one-line notice. The candidate therefore remains in the
// 'approved' state and is NOT marked uploaded — there is no fake changeset id and
// no false audit trail of an upload that never happened.
type NoopOSMUploader struct{}

func (NoopOSMUploader) Upload(_ context.Context, c ContributionCandidate) (string, error) {
	log.Printf("[maps] OSM credentials not configured — staging candidate %s (type=%s), not uploading", c.ID, c.Type)
	return "", ErrOSMNotConfigured
}

// OSMPipeline drains approved candidates to OSM via the configured uploader.
type OSMPipeline struct {
	svc    *ContributionService
	client OSMUploader

	// batchSize bounds how many candidates a single RunBatch processes (small for
	// moderation + etiquette). uploadDelay is the inter-upload pause for rate-limiting.
	batchSize   int
	uploadDelay time.Duration
}

// NewOSMPipeline wires the pipeline. A nil client defaults to NoopOSMUploader so the
// pipeline is always safe to run (it will stage, never fabricate).
func NewOSMPipeline(svc *ContributionService, client OSMUploader) *OSMPipeline {
	if client == nil {
		client = NoopOSMUploader{}
	}
	return &OSMPipeline{
		svc:         svc,
		client:      client,
		batchSize:   20,
		uploadDelay: 2 * time.Second,
	}
}

// RunBatch pulls a small batch of approved candidates and uploads each via the
// configured uploader, rate-limited. On a real successful upload it records the
// changeset id (approved→uploaded). When the uploader reports ErrOSMNotConfigured
// the candidate is left staged (no MarkUploaded, no fake changeset). Returns the
// number of candidates ACTUALLY uploaded (excludes staged + failed).
func (p *OSMPipeline) RunBatch(ctx context.Context) (int, error) {
	if p == nil || p.svc == nil {
		return 0, fmt.Errorf("maps/osm: pipeline not initialised")
	}
	batch, err := p.svc.PendingApprovedForUpload(ctx, p.batchSize)
	if err != nil {
		return 0, fmt.Errorf("maps/osm: fetch approved batch: %w", err)
	}
	if len(batch) == 0 {
		return 0, nil
	}

	uploaded := 0
	for i, c := range batch {
		// Cooperative cancellation between uploads.
		if ctx.Err() != nil {
			return uploaded, ctx.Err()
		}
		// Rate-limit: pause before every upload except the first.
		if i > 0 && p.uploadDelay > 0 {
			select {
			case <-ctx.Done():
				return uploaded, ctx.Err()
			case <-time.After(p.uploadDelay):
			}
		}

		changesetID, uerr := p.client.Upload(ctx, c)
		if uerr != nil {
			if uerr == ErrOSMNotConfigured {
				// Staged, not uploaded — do NOT mark, do NOT fabricate a changeset.
				continue
			}
			log.Printf("[maps] OSM upload failed for candidate %s: %v — leaving approved for retry", c.ID, uerr)
			continue
		}
		if changesetID == "" {
			// Defensive: a real uploader must return a non-empty changeset id.
			log.Printf("[maps] OSM uploader returned empty changeset for candidate %s — not marking uploaded", c.ID)
			continue
		}
		if merr := p.svc.MarkUploaded(ctx, c.ID, changesetID); merr != nil {
			log.Printf("[maps] OSM mark-uploaded failed for candidate %s (changeset %s): %v", c.ID, changesetID, merr)
			continue
		}
		uploaded++
	}
	return uploaded, nil
}
