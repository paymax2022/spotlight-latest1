import { vi } from 'vitest';

/**
 * Minimal stateful fake of the bridge_idempotency_keys table.
 *
 * Order-independent on purpose: the mockResolvedValueOnce queues this replaces
 * answered by call sequence, which two concurrent callers cannot share — each
 * could consume the other's queued value. Keying on the row makes the unique
 * constraint (and therefore the whole guarantee) real.
 */
export function fakeIdempotencyTable() {
  const rows = new Map<string, { key: string; response: unknown }>();
  const client: Record<string, unknown> = {
    from: vi.fn(() => client),
    insert: vi.fn((row: { key: string }) => ({
      select: () => ({
        single: async () => {
          if (rows.has(row.key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          rows.set(row.key, { key: row.key, response: {} });
          return { data: { response: {} }, error: null };
        },
      }),
    })),
    select: vi.fn(() => ({
      eq: (_col: string, value: string) => ({
        single: async () => ({ data: rows.get(value) ?? null, error: null }),
      }),
    })),
    update: vi.fn((patch: { response: unknown }) => ({
      eq: async (_col: string, value: string) => {
        const row = rows.get(value);
        if (row) row.response = patch.response;
        return { error: null };
      },
    })),
    delete: vi.fn(() => ({
      eq: async (_col: string, value: string) => {
        rows.delete(value);
        return { error: null };
      },
    })),
  };
  return { client, rows };
}
