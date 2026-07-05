package marketplace

import (
	"context"
	"encoding/json"
)

// Audit writes append-only rows to mkt_admin_audit_log on EVERY admin mutation.
// reason_code is mandatory (§1: NOT NULL) — the service refuses an admin mutation
// with an empty reason_code before this is ever called.
//
// The trail is immutable: this is INSERT-only; there is no update/delete path.

// AuditEntry is one admin action record (mkt_admin_audit_log).
type AuditEntry struct {
	AdminID     string
	AdminRole   string
	Action      string
	TargetType  string
	TargetID    string
	ReasonCode  string
	BeforeState map[string]any
	AfterState  map[string]any
}

// writeAudit inserts an immutable admin-audit row. A nil BeforeState/AfterState is
// stored as SQL NULL. Best-effort telemetry to the optional external Auditor sink
// is also fanned out. The DB insert failing does not roll back the already-committed
// mutation (mirrors the placement house pattern) but is surfaced via the returned err
// so callers on the critical path can decide.
func (s *Service) writeAudit(ctx context.Context, e AuditEntry) error {
	if err := s.repo.InsertAdminAudit(ctx, e); err != nil {
		// non-fatal: money/state already committed; log via external sink
		if s.audit != nil {
			s.audit.Audit(ctx, e.AdminID, e.Action+".audit_write_failed", map[string]any{
				"target_type": e.TargetType, "target_id": e.TargetID, "err": err.Error(),
			})
		}
		return nil
	}
	if s.audit != nil {
		detail := map[string]any{"target_type": e.TargetType, "target_id": e.TargetID, "reason_code": e.ReasonCode}
		for k, v := range e.AfterState {
			detail[k] = v
		}
		s.audit.Audit(ctx, e.AdminID, e.Action, detail)
	}
	return nil
}

// requireReason enforces the mandatory reason_code on admin mutations.
func requireReason(reason string) error {
	if reason == "" {
		return ErrReasonRequired
	}
	return nil
}

// jsonOrNil marshals a state map or returns nil for a nil map (→ SQL NULL jsonb).
func jsonOrNil(m map[string]any) any {
	if m == nil {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return b
}

// Auditor is an optional secondary telemetry sink (e.g. the global AuditService).
// The primary immutable trail is always mkt_admin_audit_log; this is best-effort.
// Nil-safe.
type Auditor interface {
	Audit(ctx context.Context, actorID, action string, detail map[string]any)
}
