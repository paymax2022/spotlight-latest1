'use client';

import { useEffect, useState } from 'react';
import { listResultsAudit, releaseResult } from '@/services/healthLabAdminService';
import type { ResultAuditItem, ResultReleaseAction } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, timeAgo } from '../../_ui';

const STATUSES = ['', 'processing', 'result_ready', 'escalated', 'released', 'amended'];
const ABNORMAL = ['', 'normal', 'abnormal', 'critical'];

export default function ResultsAuditPage() {
  const [rows, setRows] = useState<ResultAuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [abnormal, setAbnormal] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listResultsAudit({ status: status || undefined, abnormal: abnormal || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, abnormal]);

  async function act(id: string, action: ResultReleaseAction) {
    setBusy(true); setMsg(null);
    try { const r = await releaseResult(id, action); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Results audit & release controls" subtitle="Release sits behind hard gates: an unbroken chain (HL-6), registered-scientist sign-off, and NDPA consent (HL-8). Critical values route through escalation first (HL-7)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LabTabs active="results-audit" />

      <DisclosureNote>
        HL-8 — health data is sensitive (NDPA 2023). A result releases to the patient vault only with consent on
        file AND a registered medical-laboratory-scientist sign-off, AND an intact chain-of-custody (HL-6). A
        critical value cannot be released silently — it must complete the human escalation path first (HL-7).
        Every release/hold/amend is written to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Flag</label>
          <select style={select()} value={abnormal} onChange={(e) => setAbnormal(e.target.value)}>
            {ABNORMAL.map((a) => <option key={a} value={a}>{a ? a : 'All flags'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Patient, lab, order ref, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No results match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Result</th><th style={th()}>Order</th><th style={th()}>Patient</th>
              <th style={th()}>Test</th><th style={th()}>Flag</th><th style={th()}>Gates</th>
              <th style={th()}>TAT</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const releasable = r.chain_intact && r.signed_off && r.consent_on_file && !(r.abnormal_flag === 'critical' && r.status !== 'escalated');
                return (
                  <tr key={r.id} style={r.abnormal_flag === 'critical' ? { background: '#fef2f2' } : undefined}>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.order_ref}</code></td>
                    <td style={td()}>{r.patient_masked}</td>
                    <td style={td()}>{r.test_summary}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.lab_masked} · {r.scientist_masked ?? 'unsigned'}</div></td>
                    <td style={td()}><Badge status={r.abnormal_flag === 'normal' ? 'normal' : r.abnormal_flag} /></td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Badge status={r.chain_intact ? 'ok' : 'breached'} label={r.chain_intact ? 'chain ✓' : 'chain ✗'} />
                        <Badge status={r.signed_off ? 'verified' : 'pending'} label={r.signed_off ? 'signed ✓' : 'signed ✗'} />
                        <Badge status={r.consent_on_file ? 'verified' : 'pending'} label={r.consent_on_file ? 'consent ✓' : 'consent ✗'} />
                      </div>
                    </td>
                    <td style={td()}>{r.tat_hours == null ? '—' : `${r.tat_hours}h`}</td>
                    <td style={td()}><Badge status={r.status} />{r.released_at ? <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{timeAgo(r.released_at)}</div> : null}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button disabled={busy || r.status === 'released'} title={releasable ? '' : 'Blocked by a release gate'} style={btnPrimary()} onClick={() => act(r.id, 'release')}>Release</button>
                        <button disabled={busy} style={btn()} onClick={() => act(r.id, 'hold')}>Hold</button>
                        <button disabled={busy} style={btnDanger()} onClick={() => act(r.id, 'amend')}>Amend</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
