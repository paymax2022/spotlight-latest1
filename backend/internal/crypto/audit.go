package crypto

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// auditLogger writes immutable, append-only rows to crypto_audit_log. Every money
// mutation emits one (iron rule: emit an audit event on every money mutation).
type auditLogger struct {
	db *pgxpool.Pool
}

func newAuditLogger(db *pgxpool.Pool) *auditLogger { return &auditLogger{db: db} }

// log appends an audit row. oldVal/newVal may be nil. Returns the insert error so
// money paths can treat audit failure as fatal for critical mutations.
func (a *auditLogger) log(ctx context.Context, actorID, action, entityType, entityID, reason string, oldVal, newVal any) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON, _ = json.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON, _ = json.Marshal(newVal)
	}
	const q = `
		INSERT INTO crypto_audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
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
