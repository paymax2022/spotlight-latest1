'use client';

import { useEffect, useState } from 'react';
import { getSpreadRules, updateSpreadRule } from '@/services/fxAdminService';
import type { SpreadRule } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td } from '../_ui';

export default function FxSpreadPage() {
  const [rows, setRows] = useState<SpreadRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() { setLoading(true); try { setRows(await getSpreadRules()); setEdits({}); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  async function save(rule: SpreadRule) {
    const bps = edits[rule.id] ?? rule.bps;
    if (bps < rule.minBps || bps > rule.maxBps) return;
    setBusy(rule.id);
    try { await updateSpreadRule(rule.id, { bps }); await load(); } finally { setBusy(null); }
  }

  async function toggleActive(rule: SpreadRule) {
    setBusy(rule.id);
    try { await updateSpreadRule(rule.id, { active: !rule.active }); await load(); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Spread & Pricing" subtitle="Markup per corridor × tier, with guard rails and version history." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="spread" />

      <Card title="Spread rules">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Corridor</th><th style={th()}>Tier</th><th style={th()}>Spread (bps)</th><th style={th()}>Guards</th><th style={th()}>Fixed</th><th style={th()}>Version</th><th style={th()}>Active</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const val = edits[r.id] ?? r.bps;
                const invalid = val < r.minBps || val > r.maxBps;
                const dirty = val !== r.bps;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{r.corridor}</strong></td>
                    <td style={td()}>{r.tier}</td>
                    <td style={td()}>
                      <input type="number" value={val} onChange={(e) => setEdits((p) => ({ ...p, [r.id]: parseInt(e.target.value || '0', 10) }))}
                        style={{ width: 72, padding: '0.25rem 0.4rem', border: `1px solid ${invalid ? '#dc2626' : '#d1d5db'}`, borderRadius: '0.3rem', fontSize: '0.82rem' }} />
                    </td>
                    <td style={{ ...td(), color: invalid ? '#dc2626' : '#6b7280' }}>{r.minBps}–{r.maxBps}</td>
                    <td style={td()}>{r.fixedMinor ? (r.fixedMinor / 100).toFixed(2) : '—'}</td>
                    <td style={{ ...td(), color: '#6b7280' }}>v{r.version}</td>
                    <td style={td()}><Badge status={r.active ? 'successful' : 'failed'} label={r.active ? 'Active' : 'Paused'} /></td>
                    <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button disabled={!dirty || invalid || busy === r.id} onClick={() => save(r)} style={{ ...btnPrimary(), opacity: !dirty || invalid ? 0.5 : 1, marginRight: 6 }}>Save</button>
                      <button disabled={busy === r.id} onClick={() => toggleActive(r)} style={btn()}>{r.active ? 'Pause' : 'Activate'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>Spread is itemized as <code>paymax_spread</code> in every quote. Edits outside the min/max guard are blocked. Each save creates a new version (audit-logged, rollback-capable).</p>
      </Card>
    </div>
  );
}
