'use client';

import Link from 'next/link';
import { Page, PageHeader, Card, colors, tint } from '@/components/ui/vuexy';

export default function ConnectGamificationPage() {
  return (
    <Page>
      <PageHeader title="Gamification ops" subtitle="Missions, seasons and leaderboards. XP and coins are non-cash engagement points." />
      <Card>
        <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.4)}`, borderRadius: '0.5rem', padding: '0.75rem 1rem', color: colors.warning, fontSize: '0.85rem', marginBottom: '1rem' }}>
          <strong>Non-cash invariant.</strong> XP and coins are gamification points only. Admin tooling must never convert points to money, wallet balance, or withdrawable value. Real money lives only in the Paymax wallet/ledger.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <Link href="/admin/connect/gamification/missions" style={{ display: 'block', padding: '1rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', textDecoration: 'none', background: colors.card }}>
            <strong style={{ display: 'block', color: colors.text }}>Missions / quests →</strong>
            <span style={{ color: colors.muted, fontSize: '0.8rem' }}>Create & edit tasks and non-cash rewards</span>
          </Link>
          <Link href="/admin/connect/gamification/seasons" style={{ display: 'block', padding: '1rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', textDecoration: 'none', background: colors.card }}>
            <strong style={{ display: 'block', color: colors.text }}>Seasons / events →</strong>
            <span style={{ color: colors.muted, fontSize: '0.8rem' }}>Schedule themed events</span>
          </Link>
          <Link href="/admin/connect/gamification/leaderboards" style={{ display: 'block', padding: '1rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', textDecoration: 'none', background: colors.card }}>
            <strong style={{ display: 'block', color: colors.text }}>Leaderboards →</strong>
            <span style={{ color: colors.muted, fontSize: '0.8rem' }}>View & moderate boards</span>
          </Link>
        </div>
      </Card>
    </Page>
  );
}
