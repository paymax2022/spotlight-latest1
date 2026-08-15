'use client';

import { useEffect, useState } from 'react';
import { listResultsAudit, releaseResult } from '@/services/healthLabAdminService';
import type { ResultAuditItem, ResultReleaseAction } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, AuditNote, StateBlock, FilterBar, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'processing', 'result_ready', 'escalated', 'released', 'amended'];
const ABNORMAL = ['', 'normal', 'abnormal', 'critical'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(critical|reject|fail|block|escalat)/.test(v)) return colors.danger;
  if (/(pending|warn|flag|abnormal|result_ready|result ready)/.test(v)) return colors.warning;
  if (/(release|verified|approve|complete|ok|normal)/.test(v)) return colors.success;
  if (/(amend|process)/.test(v)) return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Results audit & release controls" subtitle="Release sits behind hard gates: an unbroken chain (HL-6), registered-scientist sign-off, and NDPA consent (HL-8). Critical values route through escalation first (HL-7)." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="results-audit" />

      <DisclosureNote>
        HL-8 — health data is sensitive (NDPA 2023). A result releases to the patient vault only with consent on
        file AND a registered medical-laboratory-scientist sign-off, AND an intact chain-of-custody (HL-6). A
        critical value cannot be released silently — it must complete the human escalation path first (HL-7).
        Every release/hold/amend is written to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label>Flag</label>
          <select value={abnormal} onChange={(e) => setAbnormal(e.target.value)}>
            {ABNORMAL.map((a) => <option key={a} value={a}>{a ? a : 'All flags'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Patient, lab, order ref, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No results match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Result</th><th style={thCell}>Order</th><th style={thCell}>Patient</th>
                <th style={thCell}>Test</th><th style={thCell}>Flag</th><th style={thCell}>Gates</th>
                <th style={thCell}>TAT</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const releasable = r.chain_intact && r.signed_off && r.consent_on_file && !(r.abnormal_flag === 'critical' && r.status !== 'escalated');
                  return (
                    <tr key={r.id} style={r.abnormal_flag === 'critical' ? { background: tint(colors.danger, 0.06) } : undefined}>
                      <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                      <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.order_ref}</code></td>
                      <td style={tdCell}>{r.patient_masked}</td>
                      <td style={tdCell}>{r.test_summary}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.lab_masked} · {r.scientist_masked ?? 'unsigned'}</div></td>
                      <td style={tdCell}><Badge text={r.abnormal_flag === 'normal' ? 'normal' : r.abnormal_flag} color={statusColor(r.abnormal_flag === 'normal' ? 'normal' : r.abnormal_flag)} /></td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Badge text={r.chain_intact ? 'chain ✓' : 'chain ✗'} color={r.chain_intact ? colors.success : colors.danger} />
                          <Badge text={r.signed_off ? 'signed ✓' : 'signed ✗'} color={r.signed_off ? colors.success : colors.warning} />
                          <Badge text={r.consent_on_file ? 'consent ✓' : 'consent ✗'} color={r.consent_on_file ? colors.success : colors.warning} />
                        </div>
                      </td>
                      <td style={tdCell}>{r.tat_hours == null ? '—' : `${r.tat_hours}h`}</td>
                      <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} />{r.released_at ? <div style={{ fontSize: '0.72rem', color: colors.muted }}>{timeAgo(r.released_at)}</div> : null}</td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Button variant="primary" sm disabled={busy || r.status === 'released'} title={releasable ? '' : 'Blocked by a release gate'} onClick={() => act(r.id, 'release')}>Release</Button>
                          <Button variant="outline" sm disabled={busy} onClick={() => act(r.id, 'hold')}>Hold</Button>
                          <Button variant="danger" sm disabled={busy} onClick={() => act(r.id, 'amend')}>Amend</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>
    </Page>
  );
}
