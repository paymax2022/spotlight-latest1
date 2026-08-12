'use client';

import { useEffect, useState } from 'react';
import { listVcnApplications, decideVcn } from '@/services/healthVetAdminService';
import type { VcnApplication, VcnDecision } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, fmtDate } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['', 'submitted', 'under_review', 'needs_info', 'approved', 'suspended', 'rejected'];

export default function VcnAuditPage() {
  const [rows, setRows] = useState<VcnApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<VcnApplication | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listVcnApplications({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(id: string, decision: VcnDecision) {
    setBusy(true); setMsg(null);
    try { const r = await decideVcn(id, decision); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="VCN credential audit" subtitle="Verify the Veterinary Council of Nigeria (VCN) practising licence before granting discoverability. Fail-closed: no unverified vet goes live (HL-2). VCN licence number is surfaced on every record." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="vcn-audit" />

      <DisclosureNote>
        HL-2 — supply is credential-gated. Approval requires a verified VCN practising licence; capability grant
        is idempotent and unlocks discoverability. Licences auto-suspend on expiry. The VCN number is surfaced
        for traceability. All decisions are recorded to the immutable audit log (HL-12).
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
          <input style={input()} placeholder="Clinic, VCN no, state, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Vet / clinic</th><th style={th()}>VCN licence no</th><th style={th()}>Specialties</th>
              <th style={th()}>State</th><th style={th()}>VCN verified</th><th style={th()}>Licence expiry</th>
              <th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.vet_name_masked}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.clinic_name} · {r.id}</div></td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.vcn_licence_no}</code><div style={{ fontSize: '0.7rem', color: colors.muted }}>reg {r.vcn_register_year}</div></td>
                  <td style={td()}>{r.specialties.join(', ')}</td>
                  <td style={td()}>{r.state}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.lga}</div></td>
                  <td style={td()}><Badge status={r.vcn_verified ? 'verified' : 'pending'} label={r.vcn_verified ? 'VCN ✓' : 'VCN ✗'} /></td>
                  <td style={td()}>{fmtDate(r.licence_expires_at)}{r.licence_expires_at && new Date(r.licence_expires_at) < new Date() ? <div style={{ fontSize: '0.7rem', color: colors.danger }}>expired</div> : null}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}><button style={btn()} onClick={() => setOpen(r)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {open && (
        <Card title={`Review — ${open.clinic_name}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: colors.muted }}>Vet:</span> {open.vet_name_masked}</div>
            <div><span style={{ color: colors.muted }}>VCN licence:</span> <code>{open.vcn_licence_no}</code></div>
            <div><span style={{ color: colors.muted }}>CAC:</span> {open.cac_rc_no}</div>
            <div><span style={{ color: colors.muted }}>Submitted:</span> {fmtDate(open.submitted_at)}</div>
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
          <AuditNote>Approval is fail-closed on the VCN licence (HL-2) and every decision is written to the immutable audit log (HL-12).</AuditNote>
        </Card>
      )}
    </div>
  );
}
