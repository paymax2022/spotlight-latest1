'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminGetFeeSchedule, adminUpdateFeeSchedule, FeeScheduleConflictError, validateFeeScheduleUpdate,
} from '@/services/cryptoAdminService';
import type { CryptoFeeScheduleResponse, CryptoFeeScheduleUpdate, CryptoFeeScheduleVersion } from '@/types/cryptoAdmin';
import {
  CryptoTabs, Kpi, StateBlock, DisclosureNote, AuditNote, PermissionBanner,
  fmtDate, label as lbl, textarea, input as inputStyle, CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

type OverrideRow = { asset: string; bps: string };

// Basis points as a percentage: 75 -> "0.75%". bps are integers, so this is exact.
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

const parseBps = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s));

function toRows(o: Record<string, number>): OverrideRow[] {
  return Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([asset, bps]) => ({ asset, bps: String(bps) }));
}

export default function CryptoFeeSchedulePage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [data, setData] = useState<CryptoFeeScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [major, setMajor] = useState('');
  const [other, setOther] = useState('');
  const [majors, setMajors] = useState('');
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const seed = useCallback((v: CryptoFeeScheduleVersion) => {
    setMajor(String(v.major_bps));
    setOther(String(v.other_bps));
    setMajors(v.majors.join(', '));
    setRows(toRows(v.overrides));
    setReason('');
    setReviewing(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGetFeeSchedule();
      setData(r);
      if (r) seed(r.current);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [seed]);

  useEffect(() => { void load(); }, [load]);

  const cur = data?.current;
  const ceiling = data?.ceiling_bps ?? 150;

  // The edit as the API will receive it (before normalisation), plus any problem with it.
  const draft: CryptoFeeScheduleUpdate | null = useMemo(() => {
    if (!cur) return null;
    const overrides: Record<string, number> = {};
    for (const r of rows) if (r.asset.trim() !== '' || r.bps.trim() !== '') overrides[r.asset.trim().toUpperCase()] = parseBps(r.bps);
    return {
      expected_version: cur.version,
      major_bps: parseBps(major),
      other_bps: parseBps(other),
      majors: Array.from(new Set(majors.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean))),
      overrides,
      reason,
    };
  }, [cur, major, other, majors, rows, reason]);

  const duplicate = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const a = r.asset.trim().toUpperCase();
      if (!a) continue;
      if (seen.has(a)) return a;
      seen.add(a);
    }
    return null;
  }, [rows]);

  // Reason is checked separately so the message while typing is about the rates, not the empty reason.
  const problem = useMemo(() => {
    if (!draft) return null;
    if (duplicate) return `${duplicate} appears more than once in the overrides.`;
    const v = validateFeeScheduleUpdate({ ...draft, reason: draft.reason || 'x' }, ceiling);
    return v;
  }, [draft, duplicate, ceiling]);

  const normalised = useMemo(() => {
    if (!draft) return null;
    const m = Array.from(new Set(draft.majors.map((x) => x.toUpperCase()))).sort();
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(draft.overrides)) o[k.toUpperCase()] = v;
    return { majors: m, overrides: o };
  }, [draft]);

  const changed = useMemo(() => {
    if (!cur || !draft || !normalised) return false;
    return draft.major_bps !== cur.major_bps || draft.other_bps !== cur.other_bps
      || JSON.stringify(normalised.majors) !== JSON.stringify([...cur.majors].sort())
      || JSON.stringify(Object.entries(normalised.overrides).sort()) !== JSON.stringify(Object.entries(cur.overrides).sort());
  }, [cur, draft, normalised]);

  const canReview = canAdmin && changed && !problem && reason.trim() !== '' && !busy;

  async function apply() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const applied = await adminUpdateFeeSchedule(draft, ceiling);
      setMsg(`Fee schedule updated to version ${applied.version}. It prices new quotes only; swaps already quoted keep their price.`);
      await load();
    } catch (e) {
      if (e instanceof FeeScheduleConflictError) {
        setMsg(null);
        await load(); // load() clears errors, so the explanation goes up after it
        setError('The schedule changed since you loaded it. It has been reloaded; review the new values and re-apply your change.');
      } else {
        setError(String(e instanceof Error ? e.message : e));
        setReviewing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const setRow = (i: number, patch: Partial<OverrideRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <Page>
      <PageHeader
        title="Crypto — Fee Schedule"
        subtitle="The markup charged on crypto swaps, in basis points (100 bps = 1%). A new version prices new quotes only."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <CryptoTabs active="fees" />
      <DisclosureNote>
        Backed by <code>GET/PUT /api/v1/admin/crypto/fee-schedule</code> (RBAC <code>crypto.admin</code>). Versions are
        append-only: a mistake is fixed by saving another version, never by editing history. Every rate is capped at the
        code ceiling; a swap that is already quoted keeps the price it was quoted at. Each change needs a reason and is
        written to the audit log. If someone else saves first, your change is refused and the page reloads.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading && !data} error={null} empty={!loading && !data && !error} emptyText="Fee schedule is unavailable: the swap pipeline is not enabled on this environment.">
        {cur && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div data-testid="kpi-major"><Kpi label="Major assets" value={pct(cur.major_bps)} sub={cur.majors.join(', ') || '—'} /></div>
              <div data-testid="kpi-other"><Kpi label="Other assets" value={pct(cur.other_bps)} /></div>
              <div data-testid="kpi-ceiling"><Kpi label="Hard ceiling" value={pct(ceiling)} sub="fixed in code" accent={colors.danger} /></div>
              <div data-testid="kpi-version"><Kpi label="Version" value={String(cur.version)} sub={cur.version === 0 ? 'configured default' : cur.created_by} /></div>
            </div>

            <Card title="Change the schedule">
              {reviewing && draft && normalised ? (
                <div>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Confirm fee change</h3>
                  <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>
                    This changes the price of every NEW swap quote. Swaps already quoted keep their current price.
                  </p>
                  <ul style={{ fontSize: '0.85rem', lineHeight: 1.7, paddingLeft: '1.1rem' }}>
                    {draft.major_bps !== cur.major_bps && <li data-testid="diff-major">Major assets: {pct(cur.major_bps)} → <strong>{pct(draft.major_bps)}</strong></li>}
                    {draft.other_bps !== cur.other_bps && <li data-testid="diff-other">Other assets: {pct(cur.other_bps)} → <strong>{pct(draft.other_bps)}</strong></li>}
                    {JSON.stringify(normalised.majors) !== JSON.stringify([...cur.majors].sort()) && <li data-testid="diff-majors">Major asset list: {cur.majors.join(', ') || '—'} → <strong>{normalised.majors.join(', ') || '—'}</strong></li>}
                    {JSON.stringify(Object.entries(normalised.overrides).sort()) !== JSON.stringify(Object.entries(cur.overrides).sort()) && (
                      <li data-testid="diff-overrides">Overrides: {Object.entries(cur.overrides).map(([a, b]) => `${a} ${pct(b)}`).join(', ') || 'none'} → <strong>{Object.entries(normalised.overrides).map(([a, b]) => `${a} ${pct(b)}`).join(', ') || 'none'}</strong></li>
                    )}
                    <li>Reason: “{draft.reason.trim()}”</li>
                  </ul>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button variant="primary" disabled={!canAdmin || busy} onClick={() => void apply()}>{busy ? '…' : 'Confirm change'}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>Back</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label style={lbl()} htmlFor="fee-major">Major markup (bps)</label>
                      <input id="fee-major" aria-label="Major markup (bps)" style={inputStyle()} inputMode="numeric" disabled={!canAdmin} value={major} onChange={(e) => setMajor(e.target.value)} />
                    </div>
                    <div>
                      <label style={lbl()} htmlFor="fee-other">Other-assets markup (bps)</label>
                      <input id="fee-other" aria-label="Other-assets markup (bps)" style={inputStyle()} inputMode="numeric" disabled={!canAdmin} value={other} onChange={(e) => setOther(e.target.value)} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={lbl()} htmlFor="fee-majors">Major assets (comma-separated)</label>
                      <input id="fee-majors" aria-label="Major assets (comma-separated)" style={inputStyle()} disabled={!canAdmin} value={majors} onChange={(e) => setMajors(e.target.value)} />
                    </div>
                  </div>

                  <div style={{ marginTop: '0.9rem' }}>
                    <label style={lbl()}>Per-asset overrides (win over the rates above)</label>
                    {rows.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', maxWidth: 420 }}>
                        <input aria-label={`Override asset ${i + 1}`} style={inputStyle()} placeholder="Asset, e.g. DOGE" disabled={!canAdmin} value={r.asset} onChange={(e) => setRow(i, { asset: e.target.value })} />
                        <input aria-label={`Override bps ${i + 1}`} style={inputStyle()} inputMode="numeric" placeholder="bps" disabled={!canAdmin} value={r.bps} onChange={(e) => setRow(i, { bps: e.target.value })} />
                        <Button variant="outline" sm aria-label={`Remove override ${i + 1}`} disabled={!canAdmin} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>×</Button>
                      </div>
                    ))}
                    <Button variant="outline" sm disabled={!canAdmin} onClick={() => setRows((rs) => [...rs, { asset: '', bps: '' }])}>Add override</Button>
                  </div>

                  <div style={{ marginTop: '0.9rem' }}>
                    <label style={lbl()} htmlFor="fee-reason">Reason (mandatory, recorded in the audit log)</label>
                    <textarea id="fee-reason" aria-label="Reason for change" style={textarea()} disabled={!canAdmin} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>

                  {changed && problem && <p style={{ color: colors.danger, fontSize: '0.8rem' }}>{problem}</p>}
                  <div style={{ marginTop: '0.75rem' }}>
                    <Button variant="primary" disabled={!canReview} onClick={() => setReviewing(true)}>Review change</Button>
                  </div>
                </div>
              )}
            </Card>

            <Card title="History">
              <StateBlock loading={false} error={null} empty={data.history.length === 0} emptyText="No changes have been saved yet; the configured default applies.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Version</th><th style={thCell}>Major</th><th style={thCell}>Other</th><th style={thCell}>Overrides</th>
                    <th style={thCell}>Changed by</th><th style={thCell}>When</th><th style={thCell}>Reason</th>
                  </tr></thead>
                  <tbody>
                    {data.history.map((h) => (
                      <tr key={h.version}>
                        <td style={tdCell}>{h.version}</td>
                        <td style={tdCell}>{pct(h.major_bps)}</td>
                        <td style={tdCell}>{pct(h.other_bps)}</td>
                        <td style={tdCell}>{Object.entries(h.overrides).map(([a, b]) => `${a} ${pct(b)}`).join(', ') || '—'}</td>
                        <td style={tdCell}>{h.created_by}</td>
                        <td style={tdCell}>{fmtDate(h.created_at)}</td>
                        <td style={tdCell}>{h.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
