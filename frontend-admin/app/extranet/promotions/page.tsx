'use client';

import { useEffect, useState } from 'react';
import { listPromotions } from '@/services/staysExtranetService';
import type { Promotion, PromotionType } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, btnPrimary, select, label, th, td, fmtDate, pct } from '../_ui';

const TYPES: (PromotionType | 'all')[] = ['all', 'early_bird', 'los', 'last_minute', 'mobile'];

export default function PromotionsPage() {
  const [rows, setRows] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPromotions()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => (type === 'all' || r.type === type) && (status === 'all' || r.status === status));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Promotions" subtitle="Early-bird, length-of-stay, last-minute and mobile-only deals. Discounts apply to the selected rate plans." action={<><button style={btnPrimary()}>New promotion</button> <button onClick={load} style={btn()}>Refresh</button></>} />
      <ExtranetTabs active="promotions" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <FilterBar>
        <div><label style={label()}>Type</label><select style={select()} value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
        <div><label style={label()}>Status</label><select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>{['all', 'active', 'scheduled', 'paused', 'ended'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </FilterBar>

      <Card title={`Promotions (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No promotions match these filters.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Type</th><th style={th()}>Discount</th><th style={th()}>Window</th><th style={th()}>Conditions</th><th style={th()}>Rate plans</th><th style={th()}>Redemptions</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.name}</td>
                  <td style={td()}><Badge status={p.type} /></td>
                  <td style={td()}>{pct(p.discount_pct)}</td>
                  <td style={td()}>{fmtDate(p.date_from)} → {fmtDate(p.date_to)}</td>
                  <td style={td()}>{p.advance_days ? `${p.advance_days}d advance` : p.min_los ? `${p.min_los}+ nights` : p.last_minute_hours ? `≤${p.last_minute_hours}h` : '—'}</td>
                  <td style={td()}>{p.applies_to_rate_plans.length}</td>
                  <td style={td()}>{p.redemptions.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
