'use client';

import { useEffect, useState } from 'react';
import { getSpreadRules, updateSpreadRule } from '@/services/fxAdminService';
import type { SpreadRule } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
      <PageHeader title="Spread & Pricing" subtitle="Markup per corridor × tier, with guard rails and version history." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="spread" />

      <Card title="Spread rules">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Corridor</th><th style={thCell}>Tier</th><th style={thCell}>Spread (bps)</th><th style={thCell}>Guards</th><th style={thCell}>Fixed</th><th style={thCell}>Version</th><th style={thCell}>Active</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const val = edits[r.id] ?? r.bps;
                const invalid = val < r.minBps || val > r.maxBps;
                const dirty = val !== r.bps;
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong>{r.corridor}</strong></td>
                    <td style={tdCell}>{r.tier}</td>
                    <td style={tdCell}>
                      <input type="number" value={val} onChange={(e) => setEdits((p) => ({ ...p, [r.id]: parseInt(e.target.value || '0', 10) }))}
                        style={{ width: 72, padding: '0.25rem 0.4rem', border: `1px solid ${invalid ? colors.danger : colors.inputBorder}`, borderRadius: '0.3rem', fontSize: '0.82rem' }} />
                    </td>
                    <td style={{ ...tdCell, color: invalid ? colors.danger : colors.muted }}>{r.minBps}–{r.maxBps}</td>
                    <td style={tdCell}>{r.fixedMinor ? (r.fixedMinor / 100).toFixed(2) : '—'}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>v{r.version}</td>
                    <td style={tdCell}><Badge status={r.active ? 'successful' : 'failed'} label={r.active ? 'Active' : 'Paused'} /></td>
                    <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button variant="primary" sm style={{ opacity: !dirty || invalid ? 0.5 : 1, marginRight: 6 }} disabled={!dirty || invalid || busy === r.id} onClick={() => save(r)}>Save</Button>
                      <Button variant="outline" sm disabled={busy === r.id} onClick={() => toggleActive(r)}>{r.active ? 'Pause' : 'Activate'}</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>Spread is itemized as <code>paymax_spread</code> in every quote. Edits outside the min/max guard are blocked. Each save creates a new version (audit-logged, rollback-capable).</p>
      </Card>
    </div>
  );
}
