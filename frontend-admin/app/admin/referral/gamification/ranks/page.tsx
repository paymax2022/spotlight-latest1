'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRanksAdmin } from '@/services/referralAdminOpsService';
import type { RankAdmin } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function RanksAdminPage() {
  const [rows, setRows] = useState<RankAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRanksAdmin()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Gamification — Tier / rank / badge config"
        subtitle="Set ranks, point thresholds, badges and perks (A-GAM-02). Ranks are recognition only — non-cash."
        actions={<Link href="/admin/referral/gamification" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Overview</Link>}
      />

      <Card title="Ranks">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No ranks configured.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thCell}>Rank</th><th style={thCell}>Threshold</th><th style={thCell}>Badge</th><th style={thCell}>Perks</th><th style={thCell}>Holders</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}>{r.name}</td>
                    <td style={tdCell}>{r.threshold_points.toLocaleString('en-NG')} pts</td>
                    <td style={tdCell}><Badge text={r.badge} color={colors.primary} /></td>
                    <td style={tdCell}>{r.perks}</td>
                    <td style={tdCell}>{r.holders.toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
