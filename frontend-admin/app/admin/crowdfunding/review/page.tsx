'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listReviewCampaigns } from '@/services/crowdfundingAdminService';
import type { CfReviewCampaign, CfRiskLevel } from '@/types/crowdfunding';

const STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: '#d97706', CHANGES_REQUESTED: '#7c3aed', ACTIVE: '#16a34a',
  COMPLETED: '#1d4ed8', FROZEN: '#dc2626', REJECTED: '#6b7280',
};
const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: '#16a34a', MEDIUM: '#d97706', HIGH: '#dc2626' };

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

const FILTERS = ['PENDING_REVIEW', 'CHANGES_REQUESTED', 'ACTIVE', 'FROZEN', 'REJECTED', ''];

export default function CampaignReviewQueue() {
  const [items, setItems] = useState<CfReviewCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('PENDING_REVIEW');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listReviewCampaigns(filter || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Campaign Review</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.25rem', fontSize: '0.85rem' }}>Verify, approve, request changes, reject or freeze submitted campaigns.</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)} style={{
            padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db',
            background: filter === s ? '#1d4ed8' : '#fff', color: filter === s ? '#fff' : '#374151',
            cursor: 'pointer', fontSize: '0.8rem',
          }}>{s ? s.replace('_', ' ') : 'All'}</button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', padding: '0.3rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading campaigns…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No campaigns in this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((c) => (
            <Link key={c.id} href={`/admin/crowdfunding/review/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: '0.5rem', background: '#f3f4f6', overflow: 'hidden', flexShrink: 0 }}>
                  {c.coverImage ? <img src={c.coverImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={badge(STATUS_BADGE[c.status])}>{c.status.replace('_', ' ')}</span>
                    <span style={{ ...badge(RISK_COLOR[c.riskLevel]), background: '#fff', color: RISK_COLOR[c.riskLevel], border: `1px solid ${RISK_COLOR[c.riskLevel]}` }}>RISK {c.riskLevel}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{c.category}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                    {c.creatorName} ({c.creatorVerification}) · Goal {naira(c.goalKobo)} · submitted {new Date(c.submittedAt).toLocaleDateString()}
                  </div>
                </div>
                <span style={{ color: '#9ca3af', fontSize: '1.25rem' }}>›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
