'use client';

import { useEffect, useState } from 'react';
import { getMappingQueue, resolveMapping, formatMoney } from '@/services/staysAdminService';
import type { MappingRecord, MappingStatus } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  btn,
  btnPrimary,
  th,
  td,
  label,
  select,
  timeAgo,
  pct,
} from '../_ui';

const STATUSES: MappingStatus[] = ['pending', 'merged', 'split', 'ignored'];

export default function StaysMappingPage() {
  const [data, setData] = useState<MappingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('pending');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getMappingQueue({ status: status || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function resolve(id: string, next: MappingStatus) {
    if (!window.confirm(`Mark mapping ${id} as "${next}"?`)) return;
    setBusy(id); setError(null);
    try { await resolveMapping(id, { status: next }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Property mapping & dedup"
        subtitle="Resolve cross-supplier and bedbank-vs-direct duplicates before they reach search. Merge collapses candidates to one property; split keeps them distinct; ignore dismisses the conflict."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="supply" />

      <DisclosureNote>
        Merging combines inventory from multiple suppliers under one property — the cheapest live
        rate wins at search, and the winning supplier&apos;s source rail is still disclosed to the
        guest. Mis-merges can hide a valid offer, so confirm geo + name + star alignment first.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={load} style={btn()}>Refresh</button>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No mapping records found.">
        {data.map((m) => (
          <Card
            key={m.id}
            title={`${m.city} · ${pct(m.confidence)} confidence`}
            right={<Badge status={m.status} />}
          >
            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 0 }}>{m.conflict_reason}</p>
            <p style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Flagged {timeAgo(m.created_at)} · <code>{m.id}</code></p>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={th()}>Supplier</th>
                    <th style={th()}>Rail</th>
                    <th style={th()}>Name</th>
                    <th style={th()}>Address</th>
                    <th style={th()}>Star</th>
                    <th style={th()}>Lowest total</th>
                  </tr>
                </thead>
                <tbody>
                  {m.candidates.map((c) => (
                    <tr key={c.supplier_property_ref}>
                      <td style={td()}>
                        <Badge status={c.supplier_code} />
                        <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}><code>{c.supplier_property_ref}</code></div>
                      </td>
                      <td style={td()}><Badge status={c.rail} /></td>
                      <td style={td()}>{c.name}</td>
                      <td style={td()}>{c.address}</td>
                      <td style={td()}>{c.star_rating}★</td>
                      <td style={td()}>{formatMoney(c.lowest_total_kobo, c.currency)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{c.currency}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {m.status === 'pending' && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                <button style={btnPrimary()} disabled={busy === m.id} onClick={() => resolve(m.id, 'merged')}>Merge</button>
                <button style={btn()} disabled={busy === m.id} onClick={() => resolve(m.id, 'split')}>Split</button>
                <button style={btn()} disabled={busy === m.id} onClick={() => resolve(m.id, 'ignored')}>Ignore</button>
              </div>
            )}
          </Card>
        ))}
      </StateBlock>
    </div>
  );
}
