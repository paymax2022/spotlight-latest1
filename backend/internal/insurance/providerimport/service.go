package providerimport

import (
	"context"
	"fmt"
	"time"
)

const (
	pageSize = 100
	// maxPages bounds a sync so a provider that never reports a stable total
	// cannot loop forever; 100 x 100 = 10,000 policies, far above today's book.
	maxPages = 100
)

// Auditor records an admin action. Nil-safe.
type Auditor func(ctx context.Context, actorID, action string, detail map[string]any)

// Service syncs and reads the provider mirror.
type Service struct {
	provider string
	source   Source
	store    Store
	audit    Auditor
	now      func() time.Time
}

// NewService builds the service for one provider (the aggregator name, e.g. "mycover").
func NewService(provider string, source Source, store Store, audit Auditor) *Service {
	return &Service{provider: provider, source: source, store: store, audit: audit, now: time.Now}
}

// Sync pulls every policy the provider holds and upserts it into the mirror.
// Re-running is safe: upserts are idempotent on the provider's own policy id.
// On a mid-run failure it returns what was written so far alongside the error.
func (s *Service) Sync(ctx context.Context, actorID string) (SyncResult, error) {
	res := SyncResult{Provider: s.provider}
	if s.source == nil || !s.source.Configured() {
		return res, ErrNotConfigured
	}
	for page := 1; page <= maxPages; page++ {
		items, total, err := s.source.ListSummaries(ctx, page, pageSize)
		if err != nil {
			return res, fmt.Errorf("providerimport: list page %d: %w", page, err)
		}
		res.ProviderTotal = total
		for _, it := range items {
			inserted, uerr := s.store.Upsert(ctx, s.provider, it)
			if uerr != nil {
				return res, fmt.Errorf("providerimport: upsert %s: %w", it.ProviderPolicyRef, uerr)
			}
			res.Fetched++
			if inserted {
				res.Inserted++
			} else {
				res.Updated++
			}
		}
		if len(items) == 0 || res.Fetched >= total {
			break
		}
	}
	res.SyncedAt = s.now().UTC()
	if s.audit != nil {
		s.audit(ctx, actorID, "insurance.provider_import_sync", map[string]any{
			"provider": s.provider, "fetched": res.Fetched, "inserted": res.Inserted, "updated": res.Updated,
		})
	}
	return res, nil
}

// List returns mirrored policies plus the overview.
func (s *Service) List(ctx context.Context, inPaymax *bool, limit, offset int) ([]Row, Overview, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.store.List(ctx, s.provider, inPaymax, limit, offset)
	if err != nil {
		return nil, Overview{}, err
	}
	ov, err := s.store.Overview(ctx, s.provider)
	if err != nil {
		return nil, Overview{}, err
	}
	return rows, ov, nil
}
