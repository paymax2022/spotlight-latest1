'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRiskRules } from '@/services/referralAdminOpsService';
import type { RiskRule } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const CATEGORIES = ['all', 'velocity', 'device', 'kyc_dedup', 'behavioural'];

function actionBadgeColor(action: string): string {
  if (action === 'block' || action === 'clawback') return colors.danger;
  if (action === 'hold') return colors.warning;
  return colors.info;
}

export default function RiskRulesPage() {
  const [rows, setRows] = useState<RiskRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState('all');
  const [toggling, setToggling] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRiskRules()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function toggle(r: RiskRule) {
    setToggling(r.id);
    setRows((cur) => (cur ?? []).map((x) => x.id === r.id ? { ...x, enabled: !x.enabled, updated_at: new Date().toISOString() } : x));
    setTimeout(() => setToggling(null), 150);
  }

  const filtered = (rows ?? []).filter((r) => cat === 'all' ? true : r.category === cat);

  return (
    <Page>
      <PageHeader
        title="Risk — Rules engine"
        subtitle="Velocity, device, KYC-dedup and behavioural rules (A-RSK-02). Rule actions: flag → hold → block → clawback."
        actions={<Link href="/admin/referral/risk" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Dashboard</Link>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Detection rules</h2>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : filtered.length === 0 ? <p style={{ color: colors.muted }}>No rules in this category.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Rule</th><th style={thCell}>Category</th><th style={thCell}>Threshold</th>
                    <th style={thCell}>Action</th><th style={thCell}>Hits (30d)</th><th style={thCell}>Updated</th><th style={thCell}>Enabled</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}>{r.name}<br /><span style={{ fontSize: 11, color: colors.muted }}>{r.description}</span></td>
                        <td style={tdCell}>{r.category.replace(/_/g, ' ')}</td>
                        <td style={tdCell}><code style={{ fontSize: 13 }}>{r.threshold}</code></td>
                        <td style={tdCell}><Badge text={r.action} color={actionBadgeColor(r.action)} /></td>
                        <td style={tdCell}>{r.hits_30d}</td>
                        <td style={tdCell}>{timeAgo(r.updated_at)}</td>
                        <td style={tdCell}>
                          <Button
                            variant="outline"
                            sm
                            disabled={toggling === r.id}
                            onClick={() => toggle(r)}
                            style={{ color: r.enabled ? colors.success : colors.muted, borderColor: r.enabled ? colors.success : colors.inputBorder }}
                          >
                            {r.enabled ? 'On' : 'Off'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Card>
    </Page>
  );
}
