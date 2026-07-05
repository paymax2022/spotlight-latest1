'use client';

import { useEffect, useState } from 'react';
import { listPcnApplications, decidePcn } from '@/services/healthPharmacyAdminService';
import type { PcnApplication, PcnDecision } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="PCN & premises verification audit" subtitle="Provider onboarding review — PCN premises registration + superintendent-pharmacist licence + CAC. Approve only on verified credentials; supply is credential-gated and auto-suspends on expiry." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="pcn-audit" />
      <DisclosureNote>State machine: <strong>SUBMITTED → UNDER_REVIEW ↔ NEEDS_INFO → APPROVED (↔ SUSPENDED) | REJECTED</strong>. Approval is blocked unless both PCN premises and superintendent-pharmacist licence are verified (HL-2); on approve, the pharmacy capability is idempotently granted. Every decision posts an immutable audit event (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Pharmacy, PCN no., state or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under review</option>
            <option value="needs_info">Needs info</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Pharmacy</th><th style={th()}>PCN premises</th><th style={th()}>Pharmacist (PCN)</th><th style={th()}>State / LGA</th>
              <th style={th()}>Credentials</th><th style={th()}>Licence expiry</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const expired = r.licence_expires_at ? new Date(r.licence_expires_at).getTime() < Date.now() : false;
                return (
                  <tr key={r.id}>
                    <td style={td()}>
                      <div style={{ fontWeight: 600 }}>{r.pharmacy_name}</div>
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id} · {r.superintendent_masked} · CAC {r.cac_rc_no}</div>
                    </td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.pcn_premises_no}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.pcn_pharmacist_no}</code></td>
                    <td style={td()}>{r.state}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.lga}</div></td>
                    <td style={td()}>
                      <Badge status={r.premises_verified ? 'verified' : 'pending'} label={r.premises_verified ? 'premises ✓' : 'premises ✗'} />
                      <div style={{ marginTop: 4 }}><Badge status={r.pharmacist_verified ? 'verified' : 'pending'} label={r.pharmacist_verified ? 'pharmacist ✓' : 'pharmacist ✗'} /></div>
                    </td>
                    <td style={td()}>{fmtDate(r.licence_expires_at)}{expired && <div style={{ marginTop: 4 }}><Badge status="expired" label="expired" /></div>}</td>
                    <td style={td()}><Badge status={r.status} /></td>
                    <td style={td()}>
                      {(r.status === 'submitted' || r.status === 'under_review' || r.status === 'needs_info') ? (
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button style={btnPrimary()} disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</button>
                          <button style={btn()} disabled={busy === r.id} onClick={() => decide(r, 'need_info')}>Need info</button>
                          <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</button>
                        </div>
                      ) : r.status === 'approved' ? (
                        <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'suspend')}>Suspend</button>
                      ) : r.status === 'suspended' ? (
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => decide(r, 'reinstate')}>Reinstate</button>
                      ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
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
