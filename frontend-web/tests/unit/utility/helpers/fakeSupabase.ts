// Shared fake Supabase admin client for the card-bill vend/refund specs. It models
// exactly the query shapes the utility service issues, including CAS-guarded
// updates (eq/in/lt must ALL match), JSON-path filters (`metadata->a->>b`), the
// auth admin email lookup, and platform_users. utility_transactions is the only
// table held statefully; every other table is canned fixture data.
import { vi } from 'vitest';

export type Row = Record<string, any>;
export type EventHook = (eventType: string, tx: Map<string, Row>) => void;

export const BILLER = {
  id: 'biller-001', category: 'airtime', name: 'MTN', code: 'mtn', status: 'active',
  requires_validation: false, customer_reference_label: 'Phone number', dynamic_fields: [],
};
export const PRODUCT = {
  id: 'product-001', biller_id: 'biller-001', category: 'airtime', name: 'MTN Airtime',
  code: 'mtn-airtime', amount_type: 'variable', amount_kobo: null, min_amount_kobo: 5000,
  max_amount_kobo: 5_000_000, convenience_fee_kobo: 0, markup_bps: 0, provider_discount_bps: 0,
  status: 'active', metadata: {},
};
export const PROVIDER = {
  id: 'provider-001', name: 'VTPass', code: 'vtpass', adapter_code: 'vtpass', status: 'active',
  supported_categories: ['airtime'], priority: 1, health_status: 'healthy', credentials: {}, config: {},
};
export const MAPPING = {
  id: 'mapping-001', provider_id: 'provider-001', product_id: 'product-001',
  provider_product_code: 'mtn', provider_biller_code: 'mtn', provider_cost_kobo: 490_000,
  provider_discount_bps: 0, status: 'active',
};

export interface FakeOptions {
  transactions?: Row[];
  /** Called after every utility_transaction_events insert. */
  onEvent?: EventHook;
  /** Silently drop any update that writes metadata.vend_retry (simulates a lost write). */
  dropVendRetryWrite?: boolean;
  /** Existing provider attempts, returned by the attempts list query. */
  attempts?: Row[];
  /** platform_users rows keyed by auth user id OR lower-case email. */
  platformUsers?: Record<string, Row>;
  /** auth user emails keyed by user id. */
  authEmails?: Record<string, string>;
  /** Make the auth admin lookup fail (an admin-API blip / deleted auth user). */
  authLookupFails?: boolean;
}

/** Reads `a->b->>c` style paths (PostgREST JSON filters) from a row. */
function readPath(row: Row, col: string): unknown {
  if (!col.includes('->')) return row[col];
  const [head, ...rest] = col.split('->');
  let cur: any = row[head];
  for (const part of rest) {
    const key = part.startsWith('>') ? part.slice(1) : part;
    cur = cur == null ? undefined : cur[key];
  }
  return cur;
}

export function makeFakeSupabase(opts: FakeOptions = {}) {
  const txs = new Map<string, Row>();
  for (const r of opts.transactions ?? []) txs.set(r.id, { ...r });
  const ledgerKeys = new Set<string>();
  const events: Array<{ transaction_id: string; event_type: string; payload: any }> = [];

  const matches = (row: Row, f: Record<string, unknown>, ins: Record<string, unknown[]>, lts: Record<string, unknown>) =>
    Object.entries(f).every(([c, v]) => readPath(row, c) === v) &&
    Object.entries(ins).every(([c, vs]) => vs.includes(readPath(row, c))) &&
    Object.entries(lts).every(([c, v]) => String(readPath(row, c)) < String(v));

  function builderFor(table: string) {
    const s: { f: Record<string, unknown>; ins: Record<string, unknown[]>; lts: Record<string, unknown>; insert?: any; update?: any } =
      { f: {}, ins: {}, lts: {} };
    const resolve = async (asList = false) => {
      switch (table) {
        case 'ledger_entries':
          return {
            data: s.ins.idempotency_key
              ? (s.ins.idempotency_key as string[]).filter((k) => ledgerKeys.has(k)).map((k) => ({ idempotency_key: k }))
              : [],
            error: null,
          };
        case 'utility_transactions': {
          if (s.f.idempotency_key !== undefined) {
            return { data: [...txs.values()].find((r) => r.idempotency_key === s.f.idempotency_key) ?? null, error: null };
          }
          const rows = [...txs.values()].filter((r) => matches(r, s.f, s.ins, s.lts));
          if (asList) return { data: rows, error: null };
          return { data: rows.length <= 1 ? (rows[0] ?? null) : rows, error: null };
        }
        case 'platform_users': {
          const key = String(s.f.id ?? s.f.email ?? '');
          const row = opts.platformUsers?.[key];
          return { data: asList ? (row ? [row] : []) : (row ?? null), error: null };
        }
        case 'utility_billers': return { data: s.f.id === BILLER.id ? BILLER : null, error: null };
        case 'utility_products': return { data: s.f.id === PRODUCT.id ? PRODUCT : null, error: null };
        case 'utility_provider_product_mappings': return { data: [{ ...MAPPING, utility_providers: PROVIDER }], error: null };
        case 'utility_routing_rules': return { data: [], error: null };
        case 'utility_provider_attempts':
          if (asList) return { data: (opts.attempts ?? []).filter((a) => !s.f.transaction_id || a.transaction_id === s.f.transaction_id), error: null };
          return { data: { id: `attempt-${Math.random()}`, started_at: new Date().toISOString() }, error: null };
        default: return { data: null, error: null };
      }
    };
    const applyUpdate = () => {
      if (table !== 'utility_transactions' || !s.update) return [];
      if (opts.dropVendRetryWrite && s.update.metadata?.vend_retry) { s.update = undefined; return []; }
      const touched: Row[] = [];
      for (const [id, row] of txs) {
        if (matches(row, s.f, s.ins, s.lts)) {
          const merged = { ...row, ...s.update };
          txs.set(id, merged);
          touched.push(merged);
        }
      }
      s.update = undefined;
      return touched;
    };
    const b: any = {
      select: vi.fn(() => {
        if (s.update) { const t = applyUpdate(); return { then: (f: any) => Promise.resolve({ data: t, error: null }).then(f) }; }
        return b;
      }),
      eq: vi.fn((c: string, v: unknown) => { s.f[c] = v; return b; }),
      in: vi.fn((c: string, vs: unknown[]) => { s.ins[c] = vs; return b; }),
      lt: vi.fn((c: string, v: unknown) => { s.lts[c] = v; return b; }),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      insert: vi.fn((p: any) => {
        s.insert = p;
        if (table === 'utility_transactions') txs.set(p.id, { ...p });
        if (table === 'utility_transaction_events') {
          events.push({ transaction_id: p.transaction_id, event_type: p.event_type, payload: p.payload });
          opts.onEvent?.(p.event_type, txs);
        }
        return b;
      }),
      update: vi.fn((p: any) => { s.update = p; return b; }),
      maybeSingle: vi.fn(() => resolve()),
      single: vi.fn(async () => (s.insert ? { data: s.insert, error: null } : resolve())),
      then: (ok: any) => (s.update ? Promise.resolve({ data: applyUpdate(), error: null }).then(ok) : resolve(true).then(ok)),
    };
    return b;
  }

  return {
    from: vi.fn((t: string) => builderFor(t)),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => {
          if (opts.authLookupFails) return { data: { user: null }, error: { message: 'auth admin unavailable' } };
          const email = opts.authEmails?.[id];
          return { data: { user: email ? { id, email } : null }, error: null };
        }),
      },
    },
    txs,
    ledgerKeys,
    events,
    opts,
  };
}

export type FakeSupabase = ReturnType<typeof makeFakeSupabase>;
