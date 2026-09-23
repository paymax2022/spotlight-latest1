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
    // Carry the same id as the in-memory event so listAuditEventsDurable()'s merge
    // (see below) can dedupe an event that is present in both the in-memory store
    // (this process, since restart) and the DB (every process, ever) by id, rather
    // than by any fuzzier heuristic.
    id: event.id,
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

type AuditLogRow = {
  id: string;
  admin_id: string | null;
  action_type: string;
  target_table: string;
  target_id: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
};

function rowToEvent(row: AuditLogRow): AdminAuditEvent {
  return {
    id: row.id,
    adminUser: row.admin_id ?? 'system',
    role: '',
    action: row.action_type,
    module: row.target_table,
    entityType: row.target_table,
    entityId: row.target_id ?? undefined,
    oldValue: row.old_value ?? undefined,
    newValue: row.new_value ?? undefined,
    reason: row.reason ?? undefined,
    ipAddress: row.ip_address ?? undefined,
    timestamp: row.created_at,
  };
}

/**
 * WAL-009: `listAuditEvents()` alone only ever reflects this process's in-memory
 * events since its last restart — never any other worker process, and nothing
 * from before a restart. This reads `admin_audit_logs` (the durable store
 * `addAuditEvent()` now writes to — see WAL-005) and merges it with the
 * in-memory store, deduping by id (an event this process both wrote to memory
 * AND durably persisted appears once). Falls back to the in-memory-only view on
 * any DB read failure, so the admin console's audit page degrades rather than
 * breaking outright.
 */
export async function listAuditEventsDurable(limit = 100): Promise<AdminAuditEvent[]> {
  const capped = Math.max(1, Math.min(limit, 500));
  const inMemory = listAuditEvents(capped);

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('id, admin_id, action_type, target_table, target_id, old_value, new_value, reason, ip_address, created_at')
      .order('created_at', { ascending: false })
      .limit(capped);
    if (error) throw error;

    const byId = new Map<string, AdminAuditEvent>();
    for (const row of (data ?? []) as AuditLogRow[]) byId.set(row.id, rowToEvent(row));
    for (const event of inMemory) byId.set(event.id, event);

    return Array.from(byId.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, capped);
  } catch (err) {
    console.error('[admin-audit] failed to read admin_audit_logs, falling back to in-memory only', {
      error: err instanceof Error ? err.message : err,
    });
    return inMemory;
  }
}
