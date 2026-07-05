package fractionalre

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// auditLogger writes immutable, append-only rows to fre_audit_log. Every admin
// mutation and every money-path event emits one (iron rule: emit an audit event
// on every money mutation). Failures are non-fatal to the caller but logged.
type auditLogger struct {
	db *pgxpool.Pool
}

func newAuditLogger(db *pgxpool.Pool) *auditLogger { return &auditLogger{db: db} }

// log appends an audit row. oldVal/newVal may be nil. Returns the insert error
// so money paths can decide whether to treat audit failure as fatal (they do
// for the critical mutations — see service callers).
func (a *auditLogger) log(ctx context.Context, actorID, action, entityType, entityID, reason string, oldVal, newVal any) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON, _ = json.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON, _ = json.Marshal(newVal)
	}
	const q = `
		INSERT INTO fre_audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := a.db.Exec(ctx, q, actorID, action, entityType, nullStr(entityID), oldJSON, newJSON, nullStr(reason))
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// AuditEntry is a read row from fre_audit_log.
type AuditEntry struct {
	ID         string    `json:"id"`
	ActorID    string    `json:"actor_id"`
	Action     string    `json:"action"`
	EntityType string    `json:"entity_type"`
	EntityID   *string   `json:"entity_id,omitempty"`
	Reason     *string   `json:"reason,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// ListAudit returns recent audit entries (admin read).
func (s *Service) ListAudit(ctx context.Context, limit, offset int) ([]AuditEntry, error) {
	const q = `SELECT id, actor_id, action, entity_type, entity_id, reason, created_at
		FROM fre_audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := s.repo.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.ActorID, &e.Action, &e.EntityType, &e.EntityID, &e.Reason, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
