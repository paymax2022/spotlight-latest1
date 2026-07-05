'use client';

import { useEffect, useState } from 'react';
import { listMlscnApplications, decideMlscn } from '@/services/healthLabAdminService';
import type { MlscnApplication, MlscnDecision } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, fmtDate } from '../../_ui';

const STATUSES = ['', 'submitted', 'under_review', 'needs_info', 'approved', 'suspended', 'rejected'];

export default function MlscnAuditPage() {
  const [rows, setRows] = useState<MlscnApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MlscnApplication | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listMlscnApplications({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(id: string, decision: MlscnDecision) {
    setBusy(true); setMsg(null);
    try { const r = await decideMlscn(id, decision); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="MLSCN credential audit" subtitle="Verify lab facility (MLSCN) and registered medical-laboratory-scientist licences before granting discoverability. Fail-closed: no unverified lab goes live (HL-2)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LabTabs active="mlscn-audit" />

      <DisclosureNote>
        HL-2 — supply is credential-gated. Approval requires a verified MLSCN facility licence AND a verified
        medical-laboratory-scientist licence; capability grant is idempotent. Licences auto-suspend on expiry.
        All decisions are recorded to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Lab name, MLSCN no, state, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Lab</th><th style={th()}>MLSCN facility no</th><th style={th()}>Scientist</th>
              <th style={th()}>State</th><th style={th()}>Verified</th><th style={th()}>Earliest expiry</th>
              <th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.lab_name}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.mlscn_lab_no}</code></td>
                  <td style={td()}>{r.lab_scientist_masked}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.mlscn_scientist_no}</div></td>
                  <td style={td()}>{r.state}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.lga}</div></td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Badge status={r.lab_verified ? 'verified' : 'pending'} label={r.lab_verified ? 'facility ✓' : 'facility ✗'} />
                      <Badge status={r.scientist_verified ? 'verified' : 'pending'} label={r.scientist_verified ? 'scientist ✓' : 'scientist ✗'} />
                    </div>
                  </td>
                  <td style={td()}>{fmtDate(r.licence_expires_at)}{r.licence_expires_at && new Date(r.licence_expires_at) < new Date() ? <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>expired</div> : null}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}><button style={btn()} onClick={() => setOpen(r)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {open && (
        <Card title={`Review — ${open.lab_name}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: '#6b7280' }}>Scientist:</span> {open.lab_scientist_masked}</div>
            <div><span style={{ color: '#6b7280' }}>CAC:</span> {open.cac_rc_no}</div>
            <div><span style={{ color: '#6b7280' }}>Submitted:</span> {fmtDate(open.submitted_at)}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead><tr><th style={th()}>Document</th><th style={th()}>Reference</th><th style={th()}>Expires</th><th style={th()}>Verified</th></tr></thead>
            <tbody>
              {open.docs.map((d, i) => (
                <tr key={i}>
                  <td style={td()}>{d.kind.replace(/_/g, ' ')}</td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{d.reference}</code></td>
                  <td style={td()}>{fmtDate(d.expires_at)}</td>
                  <td style={td()}><Badge status={d.verified ? 'verified' : 'pending'} label={d.verified ? 'verified' : 'unverified'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button disabled={busy} style={btnPrimary()} onClick={() => decide(open.id, 'approve')}>Approve &amp; grant capability</button>
            <button disabled={busy} style={btn()} onClick={() => decide(open.id, 'need_info')}>Request info</button>
            <button disabled={busy} style={btn()} onClick={() => decide(open.id, 'suspend')}>Suspend</button>
            <button disabled={busy} style={btnDanger()} onClick={() => decide(open.id, 'reject')}>Reject</button>
          </div>
          <AuditNote>Approval is fail-closed (HL-2) and every decision is written to the immutable audit log (HL-12).</AuditNote>
        </Card>
      )}
    </div>
  );
}
