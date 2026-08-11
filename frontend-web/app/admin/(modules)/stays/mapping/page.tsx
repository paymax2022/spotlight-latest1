'use client';

import { useEffect, useState } from 'react';
import { getMappingQueue, resolveMapping, formatMoney } from '@/services/staysAdminService';
import type { MappingRecord, MappingStatus } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  label,
  select,
  timeAgo,
  pct,
} from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Property mapping & dedup"
        subtitle="Resolve cross-supplier and bedbank-vs-direct duplicates before they reach search. Merge collapses candidates to one property; split keeps them distinct; ignore dismisses the conflict."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
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
        <Button variant="outline" onClick={load}>Refresh</Button>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No mapping records found.">
        {data.map((m) => (
          <Card
            key={m.id}
            title={`${m.city} · ${pct(m.confidence)} confidence`}
            right={<Badge status={m.status} />}
          >
            <p style={{ fontSize: '0.82rem', color: colors.muted, marginTop: 0 }}>{m.conflict_reason}</p>
            <p style={{ fontSize: '0.72rem', color: colors.muted }}>Flagged {timeAgo(m.created_at)} · <code>{m.id}</code></p>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={thCell}>Supplier</th>
                    <th style={thCell}>Rail</th>
                    <th style={thCell}>Name</th>
                    <th style={thCell}>Address</th>
                    <th style={thCell}>Star</th>
                    <th style={thCell}>Lowest total</th>
                  </tr>
                </thead>
                <tbody>
                  {m.candidates.map((c) => (
                    <tr key={c.supplier_property_ref}>
                      <td style={tdCell}>
                        <Badge status={c.supplier_code} />
                        <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}><code>{c.supplier_property_ref}</code></div>
                      </td>
                      <td style={tdCell}><Badge status={c.rail} /></td>
                      <td style={tdCell}>{c.name}</td>
                      <td style={tdCell}>{c.address}</td>
                      <td style={tdCell}>{c.star_rating}★</td>
                      <td style={tdCell}>{formatMoney(c.lowest_total_kobo, c.currency)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>{c.currency}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {m.status === 'pending' && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                <Button variant="primary" sm disabled={busy === m.id} onClick={() => resolve(m.id, 'merged')}>Merge</Button>
                <Button variant="outline" sm disabled={busy === m.id} onClick={() => resolve(m.id, 'split')}>Split</Button>
                <Button variant="outline" sm disabled={busy === m.id} onClick={() => resolve(m.id, 'ignored')}>Ignore</Button>
              </div>
            )}
          </Card>
        ))}
      </StateBlock>
    </Page>
  );
}
