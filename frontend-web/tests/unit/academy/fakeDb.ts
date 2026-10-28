// A minimal chainable stand-in for the Supabase client, shared by the academy
// gate tests. Filters run in memory; a table listed in `failing` answers every
// read with an error so fail-closed paths can be exercised.
import type { createAdminClient } from '@/lib/supabase/server';

export type Row = Record<string, unknown>;

export function fakeDb(tables: Record<string, Row[]>, failing: string[] = []) {
  const updates: Array<{ table: string; patch: Row }> = [];
  const db = {
    updates,
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let countOnly = false;
      const error = failing.includes(table) ? { message: `${table} unavailable` } : null;
      const result = () => {
        if (error) return { data: null, count: null, error };
        return countOnly ? { count: rows.length, error: null } : { data: rows, error: null };
      };
      const builder = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          countOnly = !!opts?.head;
          return builder;
        },
        update(patch: Row) { updates.push({ table, patch }); return builder; },
        upsert(patch: Row) { updates.push({ table, patch }); return Promise.resolve({ error: null }); },
        eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder; },
        not(col: string, _op: string, val: unknown) { rows = rows.filter((r) => r[col] !== val); return builder; },
        in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return builder; },
        order(col: string) {
          rows.sort((a, b) => Number(a[col] ?? 0) - Number(b[col] ?? 0));
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(error ? { data: null, error } : { data: rows[0] ?? null, error: null });
        },
        then(resolve: (v: unknown) => void) { resolve(result()); },
      };
      return builder;
    },
  };
  return db as unknown as ReturnType<typeof createAdminClient> & { updates: typeof updates };
}
