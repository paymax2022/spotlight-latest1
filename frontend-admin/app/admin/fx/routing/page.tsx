'use client';

import { useEffect, useState } from 'react';
import { getRoutingWeights, saveRoutingWeights, simulateRoute } from '@/services/fxAdminService';
import type { RoutingWeights, RouteSimResult, Provider } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge } from '../_ui';
import { Button, colors, thCell, tdCell, tint } from '@/components/ui/vuexy';

export default function FxRoutingPage() {
  const [rows, setRows] = useState<RoutingWeights[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [simCorridor, setSimCorridor] = useState('USD-NGN');
  const [simAmount, setSimAmount] = useState('1000');
  const [sim, setSim] = useState<RouteSimResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  async function load() { setLoading(true); try { setRows(await getRoutingWeights()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  const patch = (i: number, p: Partial<RoutingWeights>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const toggleProv = (i: number, prov: Provider) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, enabled: { ...r.enabled, [prov]: !r.enabled[prov] } } : r)));

  async function save() {
    setSaving(true);
    try { await saveRoutingWeights(rows); setSavedAt(new Date().toLocaleTimeString('en-NG')); }
    finally { setSaving(false); }
  }

  async function runSim() {
    setSimBusy(true);
    try { setSim(await simulateRoute(simCorridor, Math.round(parseFloat(simAmount || '0') * 100))); }
    finally { setSimBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Routing Configuration" subtitle="Weights, provider enablement and bias per corridor." action={<Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>} />
      <FxTabs active="routing" />
      {savedAt ? <p style={{ color: colors.success, fontSize: '0.82rem' }}>Saved at {savedAt}. All changes are audit-logged.</p> : null}

      <Card title="Score weights (w_cost / w_cover / w_liq / w_rel)">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Corridor</th><th style={thCell}>Cost</th><th style={thCell}>Coverage</th><th style={thCell}>Liquidity</th><th style={thCell}>Reliability</th><th style={thCell}>Eversend</th><th style={thCell}>Maplerad</th><th style={thCell}>Bias</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.corridor} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{r.corridor}</strong></td>
                  {(['wCost', 'wCover', 'wLiq', 'wRel'] as const).map((k) => (
                    <td key={k} style={tdCell}>
                      <input type="number" min={0} max={1} step={0.05} value={r[k]} onChange={(e) => patch(i, { [k]: parseFloat(e.target.value) } as Partial<RoutingWeights>)} style={numInput()} />
                    </td>
                  ))}
                  <td style={tdCell}><input type="checkbox" checked={r.enabled.eversend} onChange={() => toggleProv(i, 'eversend')} /></td>
                  <td style={tdCell}><input type="checkbox" checked={r.enabled.maplerad} onChange={() => toggleProv(i, 'maplerad')} /></td>
                  <td style={tdCell}>
                    <select value={r.bias} onChange={(e) => patch(i, { bias: e.target.value as RoutingWeights['bias'] })} style={{ ...numInput(), width: 110, textTransform: 'capitalize' }}>
                      <option value="auto">auto</option><option value="eversend">eversend</option><option value="maplerad">maplerad</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>Weights are applied per corridor and customer tier. A disabled provider is skipped during scoring.</p>
      </Card>

      <Card title="Simulate route (what-if quote)">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <label style={lbl()}>Corridor<input value={simCorridor} onChange={(e) => setSimCorridor(e.target.value)} style={textInput()} /></label>
          <label style={lbl()}>Amount (USD)<input type="number" value={simAmount} onChange={(e) => setSimAmount(e.target.value)} style={textInput()} /></label>
          <Button variant="outline" disabled={simBusy} onClick={runSim}>{simBusy ? 'Simulating…' : 'Simulate'}</Button>
        </div>
        {sim ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Rank</th><th style={thCell}>Provider</th><th style={thCell}>All-in rate</th><th style={thCell}>Score</th><th style={thCell}>Viable</th><th style={thCell}>Note</th>
              </tr>
            </thead>
            <tbody>
              {sim.ranked.map((r, i) => (
                <tr key={r.provider} style={{ borderBottom: `1px solid ${colors.border}`, background: i === 0 ? tint(colors.info, 0.08) : undefined }}>
                  <td style={tdCell}>{i === 0 ? <Badge status="successful" label="Best" /> : i + 1}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}><strong>{r.provider}</strong></td>
                  <td style={tdCell}>{r.allInRate}</td>
                  <td style={tdCell}>{r.score.toFixed(2)}</td>
                  <td style={tdCell}>{r.viable ? 'Yes' : 'No'}</td>
                  <td style={{ ...tdCell, color: colors.muted }}>{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={{ color: colors.muted, fontSize: '0.85rem' }}>Enter a corridor and amount to preview how the router would score providers.</p>}
      </Card>
    </div>
  );
}

const numInput = (): React.CSSProperties => ({ width: 64, padding: '0.25rem 0.4rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.3rem', fontSize: '0.82rem' });
const textInput = (): React.CSSProperties => ({ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', marginTop: 4, display: 'block' });
const lbl = (): React.CSSProperties => ({ fontSize: '0.8rem', color: colors.text });
