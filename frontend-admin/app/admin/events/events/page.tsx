'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listEvents, formatNaira } from '@/services/eventsAdminService';
import type { EventSummary } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate, pct } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function EventsCatalogPage() {
  const [rows, setRows] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEvents({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Event catalog" subtitle="All events across every state, with capacity sold, GMV and cashless status. Click an event for its detail and approval timeline." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="events" />
      <DisclosureNote>Catalog spans the full lifecycle (DRAFT → SUBMITTED → APPROVED → LIVE → CLOSED | SUSPENDED). Money shown in ₦ (stored as kobo).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Title, organiser or event id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="live">Live</option>
            <option value="closed">Closed</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No events match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Event</th><th style={th()}>Organiser</th><th style={th()}>Category</th><th style={th()}>City</th>
              <th style={th()}>Status</th><th style={th()}>Starts</th><th style={th()}>Sold</th><th style={th()}>GMV</th><th style={th()}>Cashless</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>
                    <Link href={`/admin/events/events/${r.id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>{r.title}</Link>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div>
                  </td>
                  <td style={td()}>{r.organiser_masked}</td>
                  <td style={td()}>{r.category}</td>
                  <td style={td()}>{r.city}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{fmtDate(r.starts_at)}</td>
                  <td style={td()}>{r.tickets_sold.toLocaleString('en-NG')} / {r.capacity.toLocaleString('en-NG')}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{pct(r.capacity ? r.tickets_sold / r.capacity : 0)}</div></td>
                  <td style={td()}>{formatNaira(r.gmv_kobo)}</td>
                  <td style={td()}>{r.cashless_enabled ? <Badge status="active" label="enabled" /> : <span style={{ color: colors.muted }}>off</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
