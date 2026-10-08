/**
 * WAL-005 — `addAuditEvent()` durability.
 *
 * `addAuditEvent()` used to write ONLY to an in-process array
 * (`globalThis.__spotlightAdminAuditStore`), never to the `admin_audit_logs` table, so every
 * admin action "audited" through it vanished on restart and never reached the DB at all.
 *
 * The fix keeps the function's external contract unchanged (synchronous, no new `await` at any
 * of its 26 call sites) and fires a best-effort background insert into `admin_audit_logs`,
 * swallowing any failure so it can never throw past the caller or surface as an unhandled
 * rejection.
 *
 * What these tests protect:
 *   1. The function still returns synchronously and still pushes to the in-memory array exactly
 *      as before — `listAuditEvents()`'s two existing readers must keep working unchanged.
 *   2. The DB insert is attempted with the fields correctly mapped.
 *   3. A non-UUID actor (e.g. the `'system'` sentinel used by the server-to-server auth path)
 *      is stored as `admin_id: null`, never passed through as an invalid UUID string.
 *   4. A DB insert failure is logged and swallowed — it does not throw, and it does not affect
 *      the function's return value or the in-memory array.
 *
 * All Supabase calls are mocked — no database required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';

const mockAdmin = createAdminClient as ReturnType<typeof vi.fn>;

/** Supabase double for `admin_audit_logs`. Captures every row passed to `.insert()`. */
function makeSupabase(insertResult: { error: unknown } = { error: null }) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('admin_audit_logs');
      return {
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          inserts.push(row);
          return insertResult.error
            ? Promise.reject(insertResult.error)
            : Promise.resolve({ error: null });
        }),
      };
    }),
  };
  return { client, inserts };
}

/** Supabase double for `admin_audit_logs` reads: `.select().order().limit()` resolves to `selectResult`. */
function makeSelectSupabase(selectResult: { data: unknown; error: unknown }) {
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('admin_audit_logs');
      const builder: any = {
        select: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(selectResult),
      };
      return builder;
    }),
  };
  return { client };
}

/**
 * Wait for the fire-and-forget insert promise to settle, by polling `until`
 * rather than a fixed tick count. A fixed 2-tick `setTimeout` wait was found
 * to be genuinely flaky on a cold/first run (extra module-transform overhead
 * pushed the real settle past the 2nd tick), passing reliably on every
 * subsequent run in the same process — polling with a real timeout removes
 * that race instead of just making it statistically rarer.
 */
async function flush(until: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!until()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('flush(): condition did not become true within the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('addAuditEvent — durability (WAL-005)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as Record<string, unknown>).__spotlightAdminAuditStore = undefined;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns synchronously and pushes to the in-memory array exactly as before', async () => {
    const { client, inserts } = makeSupabase();
    mockAdmin.mockReturnValue(client);
    const { addAuditEvent, listAuditEvents } = await import('@/src/server/admin/audit');

    const result = addAuditEvent({
      adminUser: 'admin-1',
      role: 'super_admin',
      action: 'settings_update',
      module: 'settings',
      entityType: 'system_setting',
      entityId: 'setting-1',
      reason: 'test',
    });

    // Synchronous: no promise, no async return value.
    expect(result).toBeTruthy();
    expect(result.id).toBeTruthy();
    expect(result.timestamp).toBeTruthy();

    const events = listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(result);

    await flush(() => inserts.length > 0);
  });

  it('attempts a DB insert with correctly mapped fields', async () => {
    const { client, inserts } = makeSupabase();
    mockAdmin.mockReturnValue(client);
    const { addAuditEvent } = await import('@/src/server/admin/audit');

    const adminId = '11111111-1111-4111-8111-111111111111';
    const entityId = '22222222-2222-4222-8222-222222222222';

    addAuditEvent({
      adminUser: adminId,
      role: 'super_admin',
      action: 'settings_update',
      module: 'settings',
      entityType: 'system_setting',
      entityId,
      oldValue: { a: 1 },
      newValue: { a: 2 },
      reason: 'Updated admin settings',
      ipAddress: '127.0.0.1',
    });

    await flush(() => inserts.length > 0);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      admin_id: adminId,
      action_type: 'settings_update',
      target_table: 'system_setting',
      target_id: entityId,
      old_value: { a: 1 },
      new_value: { a: 2 },
      reason: 'Updated admin settings',
      ip_address: '127.0.0.1',
    });
  });

  it('stores admin_id: null for a non-UUID actor like the "system" sentinel', async () => {
    const { client, inserts } = makeSupabase();
    mockAdmin.mockReturnValue(client);
    const { addAuditEvent } = await import('@/src/server/admin/audit');

    addAuditEvent({
      adminUser: 'system',
      role: 'super_admin',
      action: 'utility_provider_sync',
      module: 'utility_payments',
      entityType: 'provider',
      entityId: 'not-a-uuid-either',
    });

    await flush(() => inserts.length > 0);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].admin_id).toBeNull();
    expect(inserts[0].target_id).toBeNull();
  });

  it('swallows a DB insert failure without throwing or affecting the return value or in-memory array', async () => {
    const { client, inserts } = makeSupabase({ error: new Error('insert failed: RLS violation') });
    mockAdmin.mockReturnValue(client);
    const { addAuditEvent, listAuditEvents } = await import('@/src/server/admin/audit');

    let result: ReturnType<typeof addAuditEvent> | undefined;
    expect(() => {
      result = addAuditEvent({
        adminUser: 'admin-1',
        role: 'super_admin',
        action: 'cms_update',
        module: 'cms',
        entityType: 'cms_page',
        entityId: 'page-1',
      });
    }).not.toThrow();

    expect(result).toBeTruthy();
    expect(listAuditEvents()).toHaveLength(1);

    await flush(() => consoleErrorSpy.mock.calls.length > 0);

    expect(inserts).toHaveLength(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('listAuditEventsDurable — merged read path (WAL-009)', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as Record<string, unknown>).__spotlightAdminAuditStore = undefined;
  });

  it('merges DB rows and in-memory events, deduping by id', async () => {
    const dbOnlyRow = {
      id: 'db-only-1',
      admin_id: 'admin-1',
      action_type: 'settings_update',
      target_table: 'system_setting',
      target_id: null,
      old_value: null,
      new_value: null,
      reason: null,
      ip_address: null,
      created_at: '2026-09-10T00:00:00.000Z',
    };
    const { client: readClient } = makeSelectSupabase({ data: [dbOnlyRow], error: null });
    mockAdmin.mockReturnValue(readClient);

    const { addAuditEvent, listAuditEventsDurable } = await import('@/src/server/admin/audit');
    const memoryEvent = addAuditEvent({
      adminUser: 'admin-2',
      role: 'super_admin',
      action: 'cms_update',
      module: 'cms',
      entityType: 'cms_page',
      entityId: 'page-1',
    });

    const events = await listAuditEventsDurable(50);

    expect(events).toHaveLength(2);
    expect(events.find((e) => e.id === 'db-only-1')).toBeTruthy();
    expect(events.find((e) => e.id === memoryEvent.id)).toEqual(memoryEvent);
  });

  it('dedupes an event both durably persisted and still in memory, preferring the in-memory copy', async () => {
    const { client: readClient } = makeSelectSupabase({ data: [], error: null });
    mockAdmin.mockReturnValue(readClient);

    const { addAuditEvent, listAuditEventsDurable } = await import('@/src/server/admin/audit');
    const event = addAuditEvent({
      adminUser: 'admin-1',
      role: 'super_admin',
      action: 'settings_update',
      module: 'settings',
      entityType: 'system_setting',
      entityId: 'setting-1',
    });

    const sameRow = {
      id: event.id,
      admin_id: 'admin-1',
      action_type: 'settings_update',
      target_table: 'system_setting',
      target_id: 'setting-1',
      old_value: null,
      new_value: null,
      reason: null,
      ip_address: null,
      created_at: event.timestamp,
    };
    (readClient.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      expect(table).toBe('admin_audit_logs');
      const builder: any = {
        select: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: [sameRow], error: null }),
      };
      return builder;
    });

    const events = await listAuditEventsDurable(50);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('falls back to the in-memory-only view when the DB read fails', async () => {
    const client = {
      from: vi.fn().mockImplementation((table: string) => {
        expect(table).toBe('admin_audit_logs');
        const builder: any = {
          select: () => builder,
          order: () => builder,
          limit: () => Promise.reject(new Error('connection reset')),
        };
        return builder;
      }),
    };
    mockAdmin.mockReturnValue(client);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { addAuditEvent, listAuditEventsDurable } = await import('@/src/server/admin/audit');
    const event = addAuditEvent({
      adminUser: 'admin-1',
      role: 'super_admin',
      action: 'settings_update',
      module: 'settings',
      entityType: 'system_setting',
      entityId: 'setting-1',
    });

    const events = await listAuditEventsDurable(50);

    expect(events).toEqual([event]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
