'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listOverridePolicies, formatNaira, type OverridePolicyRow } from '@/services/referralAdminOpsService';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// A-AMB-04 — Override policy config.
//
// Reads GET /api/referral/admin/network/override-policies. The page previously
// also showed four policy-level tiles (activity-based only, max depth,
// recruitment earnings blocked, house excluded) sourced from mock data — no
// endpoint returns them, and an unsourced "Recruitment earnings: Blocked" tile
// asserts a compliance property the system never reported. They are gone rather
// than faked; the programme rules stay described in the subtitle as prose.

export default function OverridePolicyPage() {
  const [rows, setRows] = useState<OverridePolicyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listOverridePolicies()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Ambassadors — Override policy config"
        subtitle="Per-tier override rates and caps (A-AMB-04). Programme rule: overrides accrue on a member's verified activity, never on recruitment alone, and house-attributed members are excluded from override chains (§7A.2)."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" onClick={load}>Refresh</Button>
            <Link href="/admin/referral/ambassadors"><Button variant="outline">← Directory</Button></Link>
          </div>
        }
      />

      {error && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>Could not load override policies:</strong>
          <div style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 6 }}>{error}</div>
          <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 10 }}>
            Viewing needs the <code>referral.network.view</code> permission.
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Override rate by tier</h2>
          <span style={{ fontSize: '0.72rem', color: colors.muted }}>
            {rows ? `${rows.length} tier${rows.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No override policies configured.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead>
                <tr>
                  <th style={thCell}>Tier</th>
                  <th style={thCell}>Override rate</th>
                  <th style={thCell}>Per-member cap</th>
                  <th style={thCell}>Monthly cap</th>
                  <th style={thCell}>Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...tdCell, textTransform: 'capitalize', fontWeight: 600 }}>{p.tier}</td>
                    {/* bps -> %: 200 bps = 2.00%. Kept exact rather than rounded to a whole number. */}
                    <td style={tdCell}>{(p.overrideBps / 100).toFixed(2)}%</td>
                    <td style={tdCell}>{formatNaira(p.perMemberCapKobo)}</td>
                    <td style={tdCell}>{formatNaira(p.monthlyCapKobo)}</td>
                    <td style={tdCell}>
                      <Badge text={p.isActive ? 'active' : 'inactive'} color={p.isActive ? colors.success : colors.muted} />
                    </td>
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
