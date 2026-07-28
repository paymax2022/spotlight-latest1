'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRanksAdmin } from '@/services/referralAdminOpsService';
import type { RankAdmin } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, StateBlock } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Gamification — Tier / rank / badge config"
        subtitle="Set ranks, point thresholds, badges and perks (A-GAM-02). Ranks are recognition only — non-cash."
        action={<Link href="/admin/referral/gamification" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Overview</Link>}
      />

      <Card title="Ranks">
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No ranks configured.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Rank</th><th style={th()}>Threshold</th><th style={th()}>Badge</th><th style={th()}>Perks</th><th style={th()}>Holders</th></tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.name}</td>
                  <td style={td()}>{r.threshold_points.toLocaleString('en-NG')} pts</td>
                  <td style={td()}><Badge status="vesting" label={r.badge} /></td>
                  <td style={td()}>{r.perks}</td>
                  <td style={td()}>{r.holders.toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
