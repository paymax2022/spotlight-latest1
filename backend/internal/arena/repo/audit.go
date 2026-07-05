package repo

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// AuditRepo writes immutable arena_audit_log rows (UPDATE/DELETE blocked by the
// arena_audit_log_immutable trigger).
type AuditRepo struct{ pool *pgxpool.Pool }

// NewAuditRepo builds the audit repo.
func NewAuditRepo(pool *pgxpool.Pool) *AuditRepo { return &AuditRepo{pool: pool} }

var _ service.AuditRepo = (*AuditRepo)(nil)

// Log appends one immutable audit line. Enlists in an outer tx when present so a
// transition's audit commits atomically with the state change. before/after are
// passed as native maps (pgx encodes them to jsonb); nil → SQL NULL.
func (r *AuditRepo) Log(ctx context.Context, rec service.AuditRecord) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_audit_log
			(competition_id, actor_id, entity_type, entity_id, action, reason, before, after)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, $3, NULLIF($4,'')::uuid, $5, NULLIF($6,''), $7, $8)`,
		rec.CompetitionID, rec.ActorID, rec.EntityType, rec.EntityID, rec.Action, rec.Reason,
		jsonbOrNil(rec.Before), jsonbOrNil(rec.After))
	return err
}

// jsonbOrNil returns nil (SQL NULL) for a nil map so an absent before/after stays
// NULL rather than encoding an empty object.
func jsonbOrNil(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}
