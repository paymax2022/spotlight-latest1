package offlinesync

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service reconciles queued offline client events into the academy_sync_events buffer.
// It is DETERMINISTIC and REPLAY-SAFE. The server is AUTHORITATIVE: money, scoring and
// timing are NOT trusted from the client — events are only buffered here for downstream
// server-side reconciliation. No ledger writes, no reward posting (golden rule: this
// endpoint records events, it does not move money).
type Service struct {
	repo *Repository
}

func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// Sync ingests a batch (or single) of queued events, returning a per-event result so
// the client can clear its queue deterministically. `headerKey` is the request-level
// Idempotency-Key header; the per-event clientEventId is preferred as the stable dedup
// key and the header is the fallback when a flat event omits it.
func (s *Service) Sync(ctx context.Context, userID, headerKey string, req SyncRequest) (*SyncResponse, error) {
	out := &SyncResponse{Results: make([]EventResult, 0, len(req.Events))}
	for _, ev := range req.Events {
		res := EventResult{ClientEventID: ev.ClientEventID, ServerTS: time.Now()}

		// Stable idempotency key: per-event clientEventId first, header key otherwise.
		key := ev.ClientEventID
		if key == "" {
			key = headerKey
		}
		if key == "" {
			res.Status = "rejected"
			res.Note = "missing_idempotency_key"
			out.Results = append(out.Results, res)
			continue
		}

		kind := resolveKind(ev)
		res.Kind = kind
		if !isKnownKind(kind) {
			res.Status = "rejected"
			res.Note = "unknown_kind"
			out.Results = append(out.Results, res)
			continue
		}

		// Ensure the per-user UNIQUE (user_id, client_event_id) has a value even when the
		// client only sent an Idempotency-Key header (flat event without clientEventId).
		if ev.ClientEventID == "" {
			ev.ClientEventID = key
			res.ClientEventID = key
		}

		status, err := s.repo.Ingest(ctx, userID, key, kind, "accepted", ev)
		if err != nil {
			return nil, err
		}
		res.Status = status
		if status == "duplicate" {
			res.Note = "replay_no_effect"
		}
		out.Results = append(out.Results, res)
	}
	return out, nil
}
