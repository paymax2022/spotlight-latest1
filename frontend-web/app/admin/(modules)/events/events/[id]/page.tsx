'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, formatNaira } from '@/services/eventsAdminService';
import type { EventDetail } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, fmtDate, timeAgo, pct } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [data, setData] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getEvent(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={data ? data.title : 'Event detail'}
        subtitle={data ? `${data.id} · ${data.category} · ${data.venue}` : id}
        action={<div style={{ display: 'flex', gap: '0.5rem' }}><Link href="/admin/events/events" style={{ ...btn(), textDecoration: 'none' }}>Back</Link><button onClick={load} style={btn()}>Refresh</button></div>}
      />
      <EventsTabs active="events" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Event not found.">
        {data && (
          <>
            <DisclosureNote>Status <strong>{data.status.toUpperCase()}</strong>. Cashless wallet is closed-loop; residual is refunded at close (NL-3). Timeline below is reconstructed from the immutable audit log (NL-12).</DisclosureNote>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Status" value={data.status.toUpperCase()} accent={colors.primary} />
              <Kpi label="Capacity sold" value={pct(data.capacity_sold_pct)} sub={`${data.tickets_sold.toLocaleString('en-NG')} / ${data.capacity.toLocaleString('en-NG')}`} />
              <Kpi label="GMV" value={formatNaira(data.gmv_kobo)} accent={colors.primary} />
              <Kpi label="Net revenue" value={formatNaira(data.net_revenue_kobo)} accent={colors.success} />
              <Kpi label="Cashless float" value={formatNaira(data.cashless_float_kobo)} accent={colors.info} />
              <Kpi label="Cashless liability" value={formatNaira(data.cashless_liability_kobo)} sub="Unspent — owed to customers" accent={data.cashless_liability_kobo > 0 ? colors.warning : undefined} />
            </div>

            <Card title="About">
              <p style={{ margin: 0, color: colors.text, fontSize: '0.9rem' }}>{data.description}</p>
              <p style={{ marginTop: '0.5rem', color: colors.muted, fontSize: '0.82rem' }}>Organiser {data.organiser_masked} · {data.city} · starts {fmtDate(data.starts_at)}</p>
            </Card>

            <Card title="Ticket tiers">
              {data.tiers.length === 0 ? <p style={{ color: colors.muted }}>No tiers configured.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Tier</th><th style={th()}>Price</th><th style={th()}>Sold / Qty</th><th style={th()}>Held</th><th style={th()}>Status</th><th style={th()}>Config v</th><th style={th()}>Promo</th></tr></thead>
                  <tbody>
                    {data.tiers.map((t) => (
                      <tr key={t.id}>
                        <td style={td()}>{t.name}</td>
                        <td style={td()}>{formatNaira(t.price_kobo)}</td>
                        <td style={td()}>{t.sold.toLocaleString('en-NG')} / {t.quantity.toLocaleString('en-NG')}</td>
                        <td style={td()}>{t.held.toLocaleString('en-NG')}</td>
                        <td style={td()}><Badge status={t.status} /></td>
                        <td style={td()}>v{t.config_version}</td>
                        <td style={td()}>{t.promo_codes.length ? t.promo_codes.map((p) => p.code).join(', ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Lifecycle timeline (audit-backed)">
              {data.timeline.length === 0 ? <p style={{ color: colors.muted }}>No timeline entries.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>State</th><th style={th()}>Event</th><th style={th()}>Actor</th><th style={th()}>Audit</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.timeline.map((e) => (
                      <tr key={e.id}>
                        <td style={td()}><Badge status={String(e.status)} /></td>
                        <td style={td()}>{e.label}</td>
                        <td style={td()}>{e.actor_masked ?? '—'}</td>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.audit_id ?? '—'}</code></td>
                        <td style={td()}>{timeAgo(e.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
