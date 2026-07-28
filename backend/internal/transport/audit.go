package transport

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// recordEvent inserts an immutable trip_events row outside a transaction.
func (s *Service) recordEvent(ctx context.Context, tripID, eventType, actorID string, from, to TripPhase, meta map[string]any) {
	var metaJSON []byte
	if meta != nil {
		metaJSON, _ = json.Marshal(meta)
	}
	const q = `
		INSERT INTO trip_events (trip_id, event_type, actor_id, from_phase, to_phase, metadata)
		VALUES ($1,$2,$3,$4,$5,$6)`
	s.db.Exec(ctx, q, tripID, eventType, nullStr(actorID), nullPhase(from), nullPhase(to), metaJSON)
}

// recordEventTx inserts a trip_events row inside a transaction (atomic with the transition).
func (s *Service) recordEventTx(ctx context.Context, tx pgx.Tx, tripID, eventType, actorID string, from, to TripPhase, meta map[string]any) error {
	var metaJSON []byte
	if meta != nil {
		metaJSON, _ = json.Marshal(meta)
	}
	const q = `
		INSERT INTO trip_events (trip_id, event_type, actor_id, from_phase, to_phase, metadata)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, tripID, eventType, nullStr(actorID), nullPhase(from), nullPhase(to), metaJSON)
	return err
}

func nullPhase(p TripPhase) any {
	if p == "" {
		return nil
	}
	return string(p)
}

// writeAudit inserts a row into transport_audit_log. Every admin mutation must
// call this. old/new are JSON-serialised; nil values are stored as SQL NULL.
func writeAudit(ctx context.Context, db *pgxpool.Pool, adminID, action, entityType, entityID string, oldVal, newVal any, reason string) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON, _ = json.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON, _ = json.Marshal(newVal)
	}
	const q = `
		INSERT INTO transport_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''))`
	_, err := db.Exec(ctx, q, adminID, action, entityType, nullStr(entityID), oldJSON, newJSON, reason)
	return err
}

// nullStr returns nil for an empty string so it stores as SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
