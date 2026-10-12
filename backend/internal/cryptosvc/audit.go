package cryptosvc

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditEvent is one immutable record of a money-relevant swap action (repo iron rule: every
// money mutation emits an audit event). Never put a PIN, secret or provider credential in it.
type AuditEvent struct {
	Actor    string // the user, or "system:*" for provider-driven transitions
	Action   string // crypto.swap.{quote,hold,executed,released,parked,failed,completed,pin_rejected}
	EntityID string // the swap id
	Reason   string
	Detail   map[string]any
}

// Auditor records audit events. Implementations must not fail the money path: a write error
// is logged loudly, not returned.
type Auditor interface {
	Audit(ctx context.Context, e AuditEvent)
}

// PGAuditor writes to the append-only crypto_audit_log.
type PGAuditor struct{ Pool *pgxpool.Pool }

var _ Auditor = (*PGAuditor)(nil)

// Audit implements Auditor.
func (a *PGAuditor) Audit(ctx context.Context, e AuditEvent) {
	if a == nil || a.Pool == nil {
		return
	}
	var detail []byte
	if e.Detail != nil {
		detail, _ = json.Marshal(e.Detail)
	}
	// Detached from request cancellation: a client that hangs up must not drop the record.
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, err := a.Pool.Exec(cctx,
		`INSERT INTO public.crypto_audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
		 VALUES ($1, $2, 'crypto_swap', $3, $4::jsonb, NULLIF($5, ''))`,
		e.Actor, e.Action, e.EntityID, nullJSON(detail), e.Reason)
	if err != nil {
		log.Printf("[crypto][ALERT] audit write failed action=%s swap=%s: %v", e.Action, e.EntityID, err)
	}
}

func nullJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

// keyedGate serialises callers per key inside one process, so a burst of identical requests
// queues in memory instead of each pinning a pooled connection while it waits on the
// distributed lock.
type keyedGate struct {
	mu sync.Mutex
	m  map[string]*gateEntry
}

type gateEntry struct {
	ch   chan struct{}
	refs int
}

func (g *keyedGate) acquire(ctx context.Context, key string) (func(), error) {
	g.mu.Lock()
	if g.m == nil {
		g.m = map[string]*gateEntry{}
	}
	e := g.m[key]
	if e == nil {
		e = &gateEntry{ch: make(chan struct{}, 1)}
		g.m[key] = e
	}
	e.refs++
	g.mu.Unlock()

	drop := func() {
		g.mu.Lock()
		e.refs--
		if e.refs == 0 {
			delete(g.m, key)
		}
		g.mu.Unlock()
	}
	select {
	case e.ch <- struct{}{}:
		return func() { <-e.ch; drop() }, nil
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}
}
