'use client';

import { useEffect, useState } from 'react';
import { listReviews, respondReview } from '@/services/staysExtranetService';
import type { Review } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, btnPrimary, input, select, label, fmtDate } from '../_ui';

export default function ReviewsPage() {
  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReviews()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function send(id: string) {
    setBusy(id);
    try { const updated = await respondReview(id, drafts[id] ?? ''); setRows((rs) => rs.map((r) => r.id === id ? updated : r)); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  const filtered = rows.filter((r) => filter === 'all' || (filter === 'needs_response' ? !r.response : r.status === filter));
  const avg = rows.length ? (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1) : '—';
  const pending = rows.filter((r) => !r.response).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Reviews & responses" subtitle="Read guest reviews and respond. A response shows future guests you care." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="reservations" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Average score" value={`${avg} / 10`} accent="#340075" />
        <Kpi label="Total reviews" value={rows.length.toLocaleString('en-NG')} />
        <Kpi label="Awaiting response" value={pending.toLocaleString('en-NG')} accent={pending > 0 ? '#9a3412' : '#15803d'} />
      </div>

      <FilterBar>
        <div><label style={label()}>Filter</label><select style={select()} value={filter} onChange={(e) => setFilter(e.target.value)}>{['all', 'needs_response', 'published', 'pending', 'flagged'].map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}</select></div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No reviews match this filter.">
        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {filtered.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <strong>{r.title}</strong>
                  <Badge status={r.rating >= 8 ? 'completed' : r.rating >= 6 ? 'pending' : 'rejected'} label={`${r.rating}/10`} />
                  <Badge status={r.status} />
                </div>
                <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{r.guest_name} · {r.reservation_ref} · {fmtDate(r.created_at)}</span>
              </div>
              <p style={{ margin: '0.5rem 0', color: '#374151', fontSize: '0.85rem' }}>{r.body}</p>
              {r.response ? (
                <div style={{ background: '#f5f3ff', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}>
                  <strong style={{ color: '#5b21b6' }}>Your response</strong> <span style={{ color: '#9ca3af' }}>· {fmtDate(r.responded_at)}</span>
                  <p style={{ margin: '0.25rem 0 0', color: '#374151' }}>{r.response}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input style={input()} value={drafts[r.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} placeholder="Write a response…" />
                  <button style={btnPrimary()} disabled={busy === r.id || !drafts[r.id]} onClick={() => send(r.id)}>{busy === r.id ? '…' : 'Respond'}</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </StateBlock>
    </div>
  );
}
