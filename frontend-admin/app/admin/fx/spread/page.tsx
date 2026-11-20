'use client';

import { useEffect, useState } from 'react';
import { getSpreadRules, updateSpreadRule } from '@/services/fxAdminService';
import type { SpreadRule } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, ErrorNote, errorMessage } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxSpreadPage() {
  const [rows, setRows] = useState<SpreadRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() { setLoading(true); setError(null); try { setRows(await getSpreadRules()); setEdits({}); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  // The markup rail upserts by (corridor, tier), not by the row id the list
  // happens to return, so the write carries those two keys.
  async function save(rule: SpreadRule) {
    const bps = edits[rule.id] ?? rule.bps;
    if (bps < rule.minBps || bps > rule.maxBps) return;
    setBusy(rule.id);
    setSaveError(null);
    try { await updateSpreadRule({ corridor: rule.corridor, tier: rule.tier }, { bps }); await load(); }
    catch (e) { setSaveError(String(e)); }
    finally { setBusy(null); }
  }

  async function toggleActive(rule: SpreadRule) {
    setBusy(rule.id);
    setSaveError(null);
    try { await updateSpreadRule({ corridor: rule.corridor, tier: rule.tier }, { active: !rule.active }); await load(); }
    catch (e) { setSaveError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Spread & Pricing" subtitle="The live markup registry every quote prices from — per corridor × tier, with the change history in the audit trail." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="spread" />

      <Card title="Spread rules">
        {saveError && (
          <p role="alert" style={{ color: colors.danger, fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            Not saved. {saveError}
          </p>
        )}
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : error ? (
          <ErrorNote message={error} />
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No markup rows. The platform rate is the DEFAULT row; seed public.fx_markup_rates before pricing a corridor.</p>
        ) : (
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
                    <td style={{ ...tdCell, color: colors.muted }}>{r.version === undefined ? '—' : `v${r.version}`}</td>
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
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>
          These are the live <code>fx_markup_rates</code> rows the quote engine reads on every
          request, so an edit changes the next quote with no restart. Spread is itemized as
          <code> paymax_spread</code> in every quote. Edits outside the 0–1000 bps ceiling the
          table enforces are rejected by the backend. Every write records an immutable
          before/after audit row (GET <code>/markup/audit</code>); there is no version counter
          and no one-click rollback.
        </p>
      </Card>
    </div>
  );
}
