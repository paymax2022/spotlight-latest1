'use client';

import { useEffect, useState } from 'react';
import { listRecalls, createRecall } from '@/services/healthPharmacyAdminService';
import type { RecallRecord, RecallSeverity, CreateRecallInput } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, th, td, input, label, select, timeAgo } from '../../_ui';

export default function RecallPage() {
  const [rows, setRows] = useState<RecallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState<CreateRecallInput>({ product_name: '', nafdac_reg_no: '', batch_no: '', severity: 'medium', reason: '' });

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRecalls({ status: status || undefined, severity: severity || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, severity]);

  async function submit() {
    if (!form.product_name || !form.batch_no || !form.reason) { setMsg('Product, batch and reason are required.'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await createRecall({ ...form, nafdac_reg_no: form.nafdac_reg_no || undefined });
      setMsg(res.message + ` (audit ${res.audit_id})`);
      setForm({ product_name: '', nafdac_reg_no: '', batch_no: '', severity: 'medium', reason: '' });
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Pharmacovigilance & recall" subtitle="Open and track product recalls — quarantine affected batches and notify patients. NAFDAC registration and batch surfaced." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="recall" />
      <DisclosureNote>Recalls quarantine the affected NAFDAC-registered batch and trigger patient notification. Opening a recall is an audited config/clinical action recorded to the immutable audit log (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Open a recall">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <div><label style={label()}>Product name *</label><input style={input()} value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></div>
          <div><label style={label()}>NAFDAC reg. no.</label><input style={input()} placeholder="A4-0100" value={form.nafdac_reg_no} onChange={(e) => setForm({ ...form, nafdac_reg_no: e.target.value })} /></div>
          <div><label style={label()}>Batch no. *</label><input style={input()} value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} /></div>
          <div><label style={label()}>Severity</label>
            <select style={select()} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as RecallSeverity })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Reason *</label><input style={input()} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: '0.75rem' }}><button style={btnPrimary()} disabled={busy} onClick={submit}>{busy ? 'Opening…' : 'Open recall (audited)'}</button></div>
      </Card>

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Product, batch, NAFDAC no. or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label style={label()}>Severity</label>
          <select style={select()} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No recalls match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Product</th><th style={th()}>NAFDAC reg.</th><th style={th()}>Batch</th><th style={th()}>Pharmacy</th>
              <th style={th()}>Severity</th><th style={th()}>Units / notified</th><th style={th()}>Reason</th><th style={th()}>Status</th><th style={th()}>When</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><div style={{ fontWeight: 600 }}>{r.product_name}</div><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}>{r.nafdac_reg_no ? <code style={{ fontSize: '0.76rem' }}>{r.nafdac_reg_no}</code> : '—'}</td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.batch_no}</code></td>
                  <td style={td()}>{r.pharmacy_masked}</td>
                  <td style={td()}><Badge status={r.severity} /></td>
                  <td style={td()}>{r.units_affected.toLocaleString('en-NG')}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.patients_notified.toLocaleString('en-NG')} notified</div></td>
                  <td style={td()}>{r.reason}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
