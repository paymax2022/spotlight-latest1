package offlinesync

import (
	"encoding/json"
	"time"
)

// Spotlight Academy — offline-sync ingest DTOs.
//
// Wire contract mirrors the mobile offline queue's flush path:
// mobile-app/reactnative/src/features/academy/offlineQueue.ts → pushEvent(), which
// POSTs ONE event per request as a FLAT body (not wrapped) plus an Idempotency-Key
// header. A batch envelope ({"events":[...]}) is also accepted for completeness and
// to mirror commerce.SyncRequest. All amounts, if any appear inside payload, are
// integers in minor units (kobo) — this endpoint NEVER does money math on them; the
// payload is stored verbatim as an opaque jsonb reconciliation marker.

// InboundEvent is one queued client event. The client sends `kind` (the
// academy_sync_events.kind domain) AND `type` (its own raw event type); either can
// resolve the stored kind (see resolveKind).
type InboundEvent struct {
	ClientEventID string          `json:"clientEventId"` // stable across retries (idempotency key)
	Kind          string          `json:"kind"`          // progress | attempt_queued | reward_eligible
	Type          string          `json:"type"`          // client raw type (progress|attempt_answer|attempt_submit|reward_earn)
	Payload       json.RawMessage `json:"payload"`       // opaque marker; stored verbatim
	ClientTS      *time.Time      `json:"clientTs"`      // client clock (advisory; server authoritative)
}

// SyncRequest is the batch envelope form. The mobile client uses the single flat
// form; parseSyncBody normalises both into this shape.
type SyncRequest struct {
	Events []InboundEvent `json:"events"`
}

// EventResult reports the server-authoritative outcome for one event. `status` is
// acked (newly recorded), duplicate (replay — no new effect) or rejected (invalid).
// The mobile client treats any 2xx (and 409) as acknowledged, so both acked and
// duplicate let it clear the event from its queue deterministically.
type EventResult struct {
	ClientEventID string    `json:"clientEventId"`
	Kind          string    `json:"kind"`
	Status        string    `json:"status"` // acked | duplicate | rejected
	ServerTS      time.Time `json:"serverTs"`
	Note          string    `json:"note,omitempty"`
}

// SyncResponse is the reconciliation result returned under {"data": ...}.
type SyncResponse struct {
	Results []EventResult `json:"results"`
}

// clientTypeToKind maps the mobile client's raw event `type` to the
// academy_sync_events.kind domain, mirroring KIND_MAP in offlineQueue.ts.
var clientTypeToKind = map[string]string{
	"progress":       "progress",
	"attempt_answer": "progress",
	"attempt_submit": "attempt_queued",
	"reward_earn":    "reward_eligible",
}

// resolveKind picks the stored kind: the explicit `kind` when it is a known domain
// value, otherwise the mapping from the client `type`. Falls through to the raw kind
// (possibly empty/unknown) so the caller can reject it.
func resolveKind(ev InboundEvent) string {
	if isKnownKind(ev.Kind) {
		return ev.Kind
	}
	if k, ok := clientTypeToKind[ev.Type]; ok {
		return k
	}
	return ev.Kind
}

// isKnownKind reports whether kind is an accepted academy_sync_events.kind value.
func isKnownKind(kind string) bool {
	switch kind {
	case "progress", "attempt_queued", "reward_eligible":
		return true
	default:
		return false
	}
}
