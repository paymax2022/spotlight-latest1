'use client';

import { useEffect, useState } from 'react';
import { listPcnApplications, decidePcn } from '@/services/healthPharmacyAdminService';
import type { PcnApplication, PcnDecision } from '@/types/healthAdmin';
import { PharmacyTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|fail|block|suspend|expired)/.test(v)) return colors.danger;
  if (/(pending|warn|flag|needs_info|needs info|under_review|under review|submitted)/.test(v)) return colors.warning;
  if (/(approve|verified|active|complete|ok)/.test(v)) return colors.success;
  return colors.secondary;
}

export default function PcnAuditPage() {
  const [rows, setRows] = useState<PcnApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('submitted');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPcnApplications({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(item: PcnApplication, decision: PcnDecision) {
    const note = window.prompt(`${decision.replace('_', ' ')} "${item.pharmacy_name}" (${item.id})? Audited credential decision — enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await decidePcn(item.id, decision, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="PCN & premises verification audit" subtitle="Provider onboarding review — PCN premises registration + superintendent-pharmacist licence + CAC. Approve only on verified credentials; supply is credential-gated and auto-suspends on expiry." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <PharmacyTabs active="pcn-audit" />
      <DisclosureNote>State machine: <strong>SUBMITTED → UNDER_REVIEW ↔ NEEDS_INFO → APPROVED (↔ SUSPENDED) | REJECTED</strong>. Approval is blocked unless both PCN premises and superintendent-pharmacist licence are verified (HL-2); on approve, the pharmacy capability is idempotently granted. Every decision posts an immutable audit event (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Pharmacy, PCN no., state or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="needs_info">Needs info</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications in this queue.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Pharmacy</th><th style={thCell}>PCN premises</th><th style={thCell}>Pharmacist (PCN)</th><th style={thCell}>State / LGA</th>
                <th style={thCell}>Credentials</th><th style={thCell}>Licence expiry</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const expired = r.licence_expires_at ? new Date(r.licence_expires_at).getTime() < Date.now() : false;
                  return (
                    <tr key={r.id}>
                      <td style={tdCell}>
                        <div style={{ fontWeight: 600 }}>{r.pharmacy_name}</div>
                        <div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id} · {r.superintendent_masked} · CAC {r.cac_rc_no}</div>
                      </td>
                      <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.pcn_premises_no}</code></td>
                      <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.pcn_pharmacist_no}</code></td>
                      <td style={tdCell}>{r.state}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.lga}</div></td>
                      <td style={tdCell}>
                        <Badge text={r.premises_verified ? 'premises ✓' : 'premises ✗'} color={r.premises_verified ? colors.success : colors.warning} />
                        <div style={{ marginTop: 4 }}><Badge text={r.pharmacist_verified ? 'pharmacist ✓' : 'pharmacist ✗'} color={r.pharmacist_verified ? colors.success : colors.warning} /></div>
                      </td>
                      <td style={tdCell}>{fmtDate(r.licence_expires_at)}{expired && <div style={{ marginTop: 4 }}><Badge text="expired" color={colors.danger} /></div>}</td>
                      <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} /></td>
                      <td style={tdCell}>
                        {(r.status === 'submitted' || r.status === 'under_review' || r.status === 'needs_info') ? (
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <Button variant="primary" sm disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</Button>
                            <Button variant="outline" sm disabled={busy === r.id} onClick={() => decide(r, 'need_info')}>Need info</Button>
                            <Button variant="danger" sm disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</Button>
                          </div>
                        ) : r.status === 'approved' ? (
                          <Button variant="danger" sm disabled={busy === r.id} onClick={() => decide(r, 'suspend')}>Suspend</Button>
                        ) : r.status === 'suspended' ? (
                          <Button variant="primary" sm disabled={busy === r.id} onClick={() => decide(r, 'reinstate')}>Reinstate</Button>
                        ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
