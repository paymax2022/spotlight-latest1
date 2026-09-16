import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';

// Matches RFC 4122-shaped UUIDs (any version/variant). The `admin_audit_logs.admin_id` and
// `.target_id` columns are both `uuid` — Postgres will reject (or, with a loosely-typed
// client, silently mishandle) any non-UUID string. Several real actor/entity values are NOT
// UUIDs by design: the server-to-server API-key auth path
// (`frontend-web/src/server/admin/auth.ts`) falls back to the literal string 'system' for
// `actorId` when no `x-actor-id` header is sent, and a number of call sites pass composite or
// non-DB-row identifiers as `entityId` (e.g. `${contestId}:${phaseKey}`, category slugs, or
// empty strings). Rather than let those break or corrupt the durable insert, we store `null`
// for any value that isn't a syntactically valid UUID — the in-memory event (consumed by
// `listAuditEvents()`) still keeps the original string untouched.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toUuidOrNull(value: string | undefined | null): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

export interface AdminAuditEvent {
  id: string;
  adminUser: string;
  role: string;
  action: string;
  module: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ipAddress?: string;
  timestamp: string;
}

type AuditStore = { events: AdminAuditEvent[] };

function getStore(): AuditStore {
  const key = '__spotlightAdminAuditStore';
  const globalObj = globalThis as unknown as Record<string, AuditStore | undefined>;
  if (!globalObj[key]) globalObj[key] = { events: [] };
  return globalObj[key] as AuditStore;
}

export function addAuditEvent(input: Omit<AdminAuditEvent, 'id' | 'timestamp'>) {
  const store = getStore();
  const event: AdminAuditEvent = {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  store.events.unshift(event);
  if (store.events.length > 2000) store.events.length = 2000;

  // Durable write, best-effort: fire-and-forget against `admin_audit_logs` so this function
  // stays synchronous and none of its 26 call sites need to change or `await` it. Any failure
  // (network, RLS, schema drift) is logged and swallowed here — it must never surface as an
  // unhandled rejection or propagate back to the caller. Mirrors the existing
  // fire-and-forget `.catch(() => {})` convention used for best-effort background writes
  // elsewhere in this codebase (e.g. `app/api/v2/votes/stream/route.ts`).
  void persistAuditEvent(event).catch((err) => {
    console.error('[admin-audit] failed to persist audit event to admin_audit_logs', {
      eventId: event.id,
      action: event.action,
      error: err instanceof Error ? err.message : err,
    });
  });

  return event;
}

async function persistAuditEvent(event: AdminAuditEvent): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('admin_audit_logs').insert({
    admin_id: toUuidOrNull(event.adminUser),
    action_type: event.action,
    target_table: event.entityType,
    target_id: toUuidOrNull(event.entityId),
    old_value: event.oldValue ?? null,
    new_value: event.newValue ?? null,
    reason: event.reason ?? null,
    ip_address: event.ipAddress ?? null,
  });
  if (error) throw error;
}

export function listAuditEvents(limit = 100) {
  return getStore().events.slice(0, Math.max(1, Math.min(limit, 500)));
}
