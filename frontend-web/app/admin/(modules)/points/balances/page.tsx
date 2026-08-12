'use client';

import { useState } from 'react';
import { lookupMembership, type PointsMembership } from '@/services/pointsAdminService';
import { PageHeader, PointsTabs, Card, Kpi, DisclosureNote, FilterBar, btn, btnPrimary, input, label, fmtDate } from '../_ui';

const num = (n: number) => n.toLocaleString('en-NG');

export default function PointsBalancesPage() {
  const [userId, setUserId] = useState('usr_2210');
  const [data, setData] = useState<PointsMembership | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!userId.trim()) return;
    setLoading(true); setError(null); setData(null);
    try { setData(await lookupMembership(userId.trim())); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Member balances" subtitle="Look up a member's loyalty/points membership by user id." />
      <PointsTabs active="balances" />
      <DisclosureNote>Live admin endpoint — <code>GET /api/loyalty/admin/loyalty/memberships/:userId</code> (RBAC <code>loyalty.read</code>). Returns the member's tier and points balance.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 280 }}>
          <label style={label()}>User id</label>
          <input style={input()} placeholder="e.g. usr_2210" value={userId} onChange={(e) => setUserId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        </div>
        <button style={btnPrimary()} onClick={lookup} disabled={loading}>{loading ? 'Looking up…' : 'Look up'}</button>
      </FilterBar>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {data && (
        <Card title={`Membership — ${data.user_id}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <Kpi label="Tier" value={data.tier} accent="#340075" />
            <Kpi label="Points balance" value={num(data.points_balance)} />
            <Kpi label="Lifetime points" value={num(data.lifetime_points)} />
            <Kpi label="Member since" value={fmtDate(data.joined_at)} />
          </div>
        </Card>
      )}

      {!data && !error && !loading && <p style={{ color: '#6b7280' }}>Enter a user id and look up to view the member&apos;s balance.</p>}
    </div>
  );
}
