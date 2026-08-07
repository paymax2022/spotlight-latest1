'use client';

import { useEffect, useState } from 'react';
import { listServices, governService, formatNaira } from '@/services/healthVetAdminService';
import type { VetService, VetServiceGovernanceAction } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, fmtDate, pct } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['', 'pending', 'approved', 'rejected', 'suspended'];
const MODES = ['', 'tele', 'home', 'clinic'];

export default function VetServicesPage() {
  const [rows, setRows] = useState<VetService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listServices({ status: status || undefined, mode: mode || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, mode]);

  async function govern(id: string, action: VetServiceGovernanceAction) {
    setBusy(true); setMsg(null);
    try { const r = await governService(id, action); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Service & fee governance" subtitle="Govern vet service definitions and pricing across tele / home / clinic modes. Platform fee is capped at the governed take-rate ceiling; suspended vets cannot list (HL-2). Fees in ₦." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="services" />

      <DisclosureNote>
        Service/fee governance enforces a pricing policy — fees above the governed 10% take-rate ceiling are
        blocked at approval, and listings from suspended/unverified vets are rejected (HL-2). Every governance
        decision is written to the immutable audit log (HL-12). Fees shown in ₦ (kobo internally).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Mode</label>
          <select style={select()} value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m} value={m}>{m ? m : 'All modes'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Service, vet, category, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No services match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Service</th><th style={th()}>Mode</th><th style={th()}>Vet</th>
              <th style={th()}>Duration</th><th style={th()}>Fee</th><th style={th()}>Platform fee</th>
              <th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.service_name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.category} · {r.id}</div>{r.flagged_reason ? <div style={{ fontSize: '0.72rem', color: colors.danger, marginTop: 3 }}>{r.flagged_reason}</div> : null}</td>
                  <td style={td()}><Badge status={r.mode} /></td>
                  <td style={td()}>{r.vet_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.clinic_masked}</div></td>
                  <td style={td()}>{r.duration_minutes}m</td>
                  <td style={td()}>{formatNaira(r.fee_kobo)}</td>
                  <td style={td()}><span style={{ color: r.platform_fee_pct > 0.1 ? colors.danger : colors.text, fontWeight: r.platform_fee_pct > 0.1 ? 700 : 400 }}>{pct(r.platform_fee_pct)}</span></td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {r.status === 'pending' || r.status === 'suspended' ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button disabled={busy} style={btnPrimary()} onClick={() => govern(r.id, 'approve')}>Approve</button>
                        {r.status !== 'suspended' && <button disabled={busy} style={btn()} onClick={() => govern(r.id, 'suspend')}>Suspend</button>}
                        <button disabled={busy} style={btnDanger()} onClick={() => govern(r.id, 'reject')}>Reject</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
      <p style={{ fontSize: '0.72rem', color: colors.muted }}>Listed {rows.length} service(s). Last governed {fmtDate(new Date().toISOString())}.</p>
    </div>
  );
}
