'use client';

import { useEffect, useState } from 'react';
import { listMlscnApplications, decideMlscn } from '@/services/healthLabAdminService';
import type { MlscnApplication, MlscnDecision } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, AuditNote, StateBlock, FilterBar, fmtDate } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'submitted', 'under_review', 'needs_info', 'approved', 'suspended', 'rejected'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|suspend|fail|block)/.test(v)) return colors.danger;
  if (/(pending|needs_info|needs info|under_review|under review|warn|flag)/.test(v)) return colors.warning;
  if (/(approve|verified|active|complete|ok)/.test(v)) return colors.success;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="MLSCN credential audit" subtitle="Verify lab facility (MLSCN) and registered medical-laboratory-scientist licences before granting discoverability. Fail-closed: no unverified lab goes live (HL-2)." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="mlscn-audit" />

      <DisclosureNote>
        HL-2 — supply is credential-gated. Approval requires a verified MLSCN facility licence AND a verified
        medical-laboratory-scientist licence; capability grant is idempotent. Licences auto-suspend on expiry.
        All decisions are recorded to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Lab name, MLSCN no, state, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Lab</th><th style={thCell}>MLSCN facility no</th><th style={thCell}>Scientist</th>
                <th style={thCell}>State</th><th style={thCell}>Verified</th><th style={thCell}>Earliest expiry</th>
                <th style={thCell}>Status</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.lab_name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                    <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.mlscn_lab_no}</code></td>
                    <td style={tdCell}>{r.lab_scientist_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.mlscn_scientist_no}</div></td>
                    <td style={tdCell}>{r.state}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.lga}</div></td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Badge text={r.lab_verified ? 'facility ✓' : 'facility ✗'} color={r.lab_verified ? colors.success : colors.warning} />
                        <Badge text={r.scientist_verified ? 'scientist ✓' : 'scientist ✗'} color={r.scientist_verified ? colors.success : colors.warning} />
                      </div>
                    </td>
                    <td style={tdCell}>{fmtDate(r.licence_expires_at)}{r.licence_expires_at && new Date(r.licence_expires_at) < new Date() ? <div style={{ fontSize: '0.7rem', color: colors.danger }}>expired</div> : null}</td>
                    <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} /></td>
                    <td style={tdCell}><Button variant="outline" sm onClick={() => setOpen(r)}>Review</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>

      {open && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>Review — {open.lab_name}</h2>
            <Button variant="outline" sm onClick={() => setOpen(null)}>Close</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: colors.muted }}>Scientist:</span> {open.lab_scientist_masked}</div>
            <div><span style={{ color: colors.muted }}>CAC:</span> {open.cac_rc_no}</div>
            <div><span style={{ color: colors.muted }}>Submitted:</span> {fmtDate(open.submitted_at)}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead><tr><th style={thCell}>Document</th><th style={thCell}>Reference</th><th style={thCell}>Expires</th><th style={thCell}>Verified</th></tr></thead>
            <tbody>
              {open.docs.map((d, i) => (
                <tr key={i}>
                  <td style={tdCell}>{d.kind.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{d.reference}</code></td>
                  <td style={tdCell}>{fmtDate(d.expires_at)}</td>
                  <td style={tdCell}><Badge text={d.verified ? 'verified' : 'unverified'} color={d.verified ? colors.success : colors.warning} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="primary" disabled={busy} onClick={() => decide(open.id, 'approve')}>Approve &amp; grant capability</Button>
            <Button variant="outline" disabled={busy} onClick={() => decide(open.id, 'need_info')}>Request info</Button>
            <Button variant="outline" disabled={busy} onClick={() => decide(open.id, 'suspend')}>Suspend</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide(open.id, 'reject')}>Reject</Button>
          </div>
          <AuditNote>Approval is fail-closed (HL-2) and every decision is written to the immutable audit log (HL-12).</AuditNote>
        </Card>
      )}
    </Page>
  );
}
