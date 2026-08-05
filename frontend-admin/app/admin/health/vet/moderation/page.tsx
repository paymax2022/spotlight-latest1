'use client';

import { useEffect, useState } from 'react';
import { listModeration, moderate } from '@/services/healthVetAdminService';
import type { ModerationItem, ModerationAction } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, fmtDate } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['', 'open', 'investigating', 'resolved', 'ignored'];
const SEVERITIES = ['', 'low', 'medium', 'high'];

export default function VetModerationPage() {
  const [rows, setRows] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listModeration({ status: status || undefined, severity: severity || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, severity]);

  async function act(id: string, action: ModerationAction) {
    setBusy(true); setMsg(null);
    try { const r = await moderate(id, action); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Content & credential moderation" subtitle="Review credential-claim mismatches, unlicensed-advice reports and content abuse across the vet network. Suspending a provider revokes discoverability (HL-2). VCN number surfaced where a claim is in question." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="moderation" />

      <DisclosureNote>
        Paymax never provides clinical advice — unlicensed dosing/advice content is flagged (HL-1). Credential
        claims are validated against the VCN register; a confirmed mismatch can suspend the provider and revoke
        discoverability fail-closed (HL-2). Every moderation action is written to the immutable audit log (HL-12).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Severity</label>
          <select style={select()} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s ? s : 'All severities'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Subject, kind, VCN no, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No moderation items match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Subject</th><th style={th()}>Kind</th><th style={th()}>Summary</th>
              <th style={th()}>Severity</th><th style={th()}>Created</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.subject_masked}</strong>{r.vcn_licence_no ? <div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{r.vcn_licence_no}</code></div> : null}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={td()}><Badge status={r.kind} label={r.kind.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{r.summary}{r.reporter_masked ? <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 3 }}>reported by {r.reporter_masked}</div> : null}</td>
                  <td style={td()}><Badge status={r.severity} /></td>
                  <td style={td()}>{fmtDate(r.created_at)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {r.status === 'open' || r.status === 'investigating' ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.status === 'open' && <button disabled={busy} style={btn()} onClick={() => act(r.id, 'investigate')}>Investigate</button>}
                        <button disabled={busy} style={btnPrimary()} onClick={() => act(r.id, 'resolve')}>Resolve</button>
                        <button disabled={busy} style={btn()} onClick={() => act(r.id, 'ignore')}>Ignore</button>
                        <button disabled={busy} style={btnDanger()} onClick={() => act(r.id, 'suspend_provider')}>Suspend provider</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
