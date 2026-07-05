'use client';

import Link from 'next/link';
import { PageHeader, Card, btn } from '../_ui';

export default function ConnectGamificationPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Gamification ops" subtitle="Missions, seasons and leaderboards. XP and coins are non-cash engagement points." />
      <Card>
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.75rem 1rem', color: '#9a3412', fontSize: '0.85rem', marginBottom: '1rem' }}>
          <strong>Non-cash invariant.</strong> XP and coins are gamification points only. Admin tooling must never convert points to money, wallet balance, or withdrawable value. Real money lives only in the Paymax wallet/ledger.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <Link href="/admin/connect/gamification/missions" style={{ ...btn(), display: 'block', padding: '1rem' }}>
            <strong style={{ display: 'block', color: '#111827' }}>Missions / quests →</strong>
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>Create & edit tasks and non-cash rewards</span>
          </Link>
          <Link href="/admin/connect/gamification/seasons" style={{ ...btn(), display: 'block', padding: '1rem' }}>
            <strong style={{ display: 'block', color: '#111827' }}>Seasons / events →</strong>
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>Schedule themed events</span>
          </Link>
          <Link href="/admin/connect/gamification/leaderboards" style={{ ...btn(), display: 'block', padding: '1rem' }}>
            <strong style={{ display: 'block', color: '#111827' }}>Leaderboards →</strong>
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>View & moderate boards</span>
          </Link>
        </div>
      </Card>
    </div>
  );
}
