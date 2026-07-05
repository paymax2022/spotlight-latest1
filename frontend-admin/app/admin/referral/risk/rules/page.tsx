'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listRiskRules } from '@/services/referralAdminOpsService';
import type { RiskRule } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../../_ui';

const CATEGORIES = ['all', 'velocity', 'device', 'kyc_dedup', 'behavioural'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Risk — Rules engine"
        subtitle="Velocity, device, KYC-dedup and behavioural rules (A-RSK-02). Rule actions: flag → hold → block → clawback."
        action={<Link href="/admin/referral/risk" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Dashboard</Link>}
      />

      <Card title="Detection rules" right={
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c.replace(/_/g, ' ')}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No rules in this category.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Rule</th><th style={th()}>Category</th><th style={th()}>Threshold</th>
              <th style={th()}>Action</th><th style={th()}>Hits (30d)</th><th style={th()}>Updated</th><th style={th()}>Enabled</th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.name}<br /><span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.description}</span></td>
                  <td style={td()}>{r.category.replace(/_/g, ' ')}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.threshold}</code></td>
                  <td style={td()}><Badge status={r.action === 'block' || r.action === 'clawback' ? 'critical' : r.action === 'hold' ? 'high' : 'normal'} label={r.action} /></td>
                  <td style={td()}>{r.hits_30d}</td>
                  <td style={td()}>{timeAgo(r.updated_at)}</td>
                  <td style={td()}>
                    <button disabled={toggling === r.id} onClick={() => toggle(r)} style={{ ...btn(), color: r.enabled ? '#15803d' : '#9ca3af', borderColor: r.enabled ? '#15803d' : '#d1d5db' }}>
                      {r.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
