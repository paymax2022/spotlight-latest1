/**
 * Shared fake Supabase admin client for the contest-templates admin API tests.
 *
 * Extracted verbatim from `contest-templates-admin-api.test.ts` when the P3
 * studio tests (`contest-templates-studio.test.ts`) needed the same fake: two
 * copies of a fake client drift the moment a route grows a second call, and the
 * failure mode is a route change that passes one file while the other one's fake
 * throws `Unexpected table`. The underscore prefix keeps vitest from collecting it
 * (`vitest.config.ts:16-18` includes `*.test.ts|spec.ts` only) and follows the
 * existing `_idempotency-fake.ts` precedent in this directory.
 *
 * `rpc` was added for P3: publish/duplicate/archive/versions go through
 * `security definer` functions, so the routes no longer write `status` themselves
 * and a fake without `rpc()` would fail the publish path for the wrong reason.
 * `calls` records what the route did — including whether it cleaned the object it
 * had already written when the row insert then failed, which is the difference
 * between a retryable upload and an orphan in the bucket forever.
 */
export interface StudioFakeOptions {
  templateRow?: any;
  contestantSlotExists?: boolean;
  insertedTemplate?: any;
  updatedTemplate?: any;
  /** Returned by the read that follows a successful RPC (the published row). */
  publishedRow?: any;
  uploadError?: any;
  insertError?: any;
  /** `{ [functionName]: jsonbReturn }` — what `rpc()` answers with. */
  rpcResults?: Record<string, any>;
  /** PostgREST-shaped failure from an RPC, e.g. `{ code: '22023', message: '…' }`. */
  rpcError?: any;
  /**
   * Rows `template_slots` already holds, as the PUT route's art-round-trip read
   * sees them (`select('id, image_url')`). Task 9's drop guard is only testable
   * with a stored row the payload can forget.
   */
  existingSlots?: any[];
  /**
   * Task 11. `maybeSingle()` fails before any RPC has run (the guard read that
   * slot-art and DELETE make), and `publishedReadError` fails it afterwards (the
   * read-back that publish/duplicate/archive do). Two options because a route that
   * answers 404 for a database outage would pass a one-option fake.
   */
  templateReadError?: any;
  publishedReadError?: any;
  /** PostgREST failure on the `template_slots` read, for duplicate's slot copy. */
  slotReadError?: any;
}

export interface StudioFakeCalls {
  insertPayload: any;
  updatePayload: null | Record<string, unknown>;
  deletedFrom: string[];
  uploadKeys: string[];
  removedKeys: string[];
  rpcCalls: { fn: string; args: any }[];
  /** The array a `template_slots` replace passed to `insert()` — one row per slot. */
  insertRows: any[] | null;
  /**
   * Every `.eq(column, value)` the route applied, tagged with its table. Task 11
   * needs it for one assertion in particular: after `duplicate_contest_template`
   * mints a new id, the row and slot reads have to be scoped to THAT id — a route
   * that re-reads the parent answers with the old template's slots and looks right.
   */
  eqs: { table: string; column: string; value: unknown }[];
  /** `upload(key, buffer, options)` calls, so the stored content type is pinnable. */
  uploads: { key: string; options: any }[];
}

export function makeSupabase(opts: StudioFakeOptions) {
  const calls: StudioFakeCalls = {
    insertPayload: null,
    updatePayload: null,
    deletedFrom: [] as string[],
    uploadKeys: [] as string[],
    removedKeys: [] as string[],
    rpcCalls: [] as { fn: string; args: any }[],
    insertRows: null as any[] | null,
    eqs: [] as { table: string; column: string; value: unknown }[],
    uploads: [] as { key: string; options: any }[],
  };

  function templatesChain() {
    const baseRow = () => opts.insertedTemplate ?? opts.updatedTemplate ?? opts.templateRow ?? null;
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        calls.eqs.push({ table: 'contest_templates', column, value });
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        // After an RPC has run, the route re-reads the row to answer with the
        // stored truth (`published_at`, `status`), so the second read must be
        // able to differ from the guard read that came first.
        const afterRpc = calls.rpcCalls.length > 0;
        const failure = afterRpc ? opts.publishedReadError : opts.templateReadError;
        if (failure) return Promise.resolve({ data: null, error: failure });
        return Promise.resolve({
          data: afterRpc && opts.publishedRow ? opts.publishedRow : (opts.templateRow ?? null),
          error: null,
        });
      },
      single: () =>
        Promise.resolve(
          opts.insertError
            ? { data: null, error: opts.insertError }
            : {
                // `insert().select().single()` in PostgREST answers with the row that
                // was stored, so the payload's own values have to survive into the
                // read-back. Without this a route could insert the clamped
                // `blend_settings` and answer the fixture's untouched guess at it, and
                // a test asserting the response would prove nothing about the write.
                data: calls.insertPayload ? { ...baseRow(), ...calls.insertPayload } : baseRow(),
                error: null,
              },
        ),
      insert: (payload: any) => {
        calls.insertPayload = payload;
        return chain;
      },
      update: (payload: any) => {
        calls.updatePayload = payload;
        return chain;
      },
      delete: () => {
        calls.deletedFrom.push('contest_templates');
        return chain;
      },
    };
    return chain;
  }

  /**
   * Task 9 gives `template_slots` a second reader: PUT's drop guard reads the
   * stored art before it clears the table, then replaces the rows. So the chain
   * is awaitable (an unawaited `select().eq()` used to be the whole surface) and
   * `delete`/`insert` record what the route did — `deletedFrom` is how the tests
   * prove a refusal happened *before* the clear, which is the only way the guard
   * can be told apart from a route that deletes and then apologises.
   */
  function slotsChain() {
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        calls.eqs.push({ table: 'template_slots', column, value });
        return chain;
      },
      order: () => chain,
      limit: () => Promise.resolve({ data: opts.contestantSlotExists ? [{ id: 'slot-1' }] : [], error: null }),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(
          opts.slotReadError
            ? { data: null, error: opts.slotReadError }
            : { data: opts.existingSlots ?? [], error: null },
        ).then(onFulfilled, onRejected),
      delete: () => {
        calls.deletedFrom.push('template_slots');
        return {
          eq: () => ({ then: (f: any) => Promise.resolve({ data: null, error: null }).then(f) }),
        };
      },
      insert: (rows: any[]) => {
        calls.insertRows = rows;
        // `INSERT … RETURNING *`: the stored rows echo their payload plus the id
        // the database minted, so asserting the response proves the write.
        const stored = rows.map((r, i) => ({
          id: `slot-${i + 1}`,
          created_at: '2026-11-28T00:00:00Z',
          updated_at: '2026-11-28T00:00:00Z',
          ...r,
        }));
        const after: any = {
          select: () => after,
          then: (onFulfilled: any, onRejected: any) =>
            Promise.resolve({ data: stored, error: null }).then(onFulfilled, onRejected),
        };
        return after;
      },
    };
    return chain;
  }

  function overlaysChain() {
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        calls.eqs.push({ table: 'template_text_overlays', column, value });
        return chain;
      },
      order: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  }

  const client: any = {
    from: (table: string) => {
      if (table === 'contest_templates') return templatesChain();
      if (table === 'template_slots') return slotsChain();
      if (table === 'template_text_overlays') return overlaysChain();
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (fn: string, args: any) => {
      calls.rpcCalls.push({ fn, args });
      if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
      return Promise.resolve({ data: opts.rpcResults?.[fn] ?? null, error: null });
    },
    storage: {
      from: () => ({
        upload: (key: string, _buffer: unknown, options?: any) => {
          calls.uploadKeys.push(key);
          calls.uploads.push({ key, options: options ?? null });
          return Promise.resolve(
            opts.uploadError ? { data: null, error: opts.uploadError } : { data: { path: key }, error: null },
          );
        },
        remove: (keys: string[]) => {
          calls.removedKeys.push(...keys);
          return Promise.resolve({ data: keys.map((path) => ({ path })), error: null });
        },
        getPublicUrl: (key: string) => ({ data: { publicUrl: `https://cdn.test/${key}` } }),
      }),
    },
  };

  return { client, calls };
}
