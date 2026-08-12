'use client';

import { useEffect, useState } from 'react';
import { listRecalls, createRecall } from '@/services/healthPharmacyAdminService';
import type { RecallRecord, RecallSeverity, CreateRecallInput } from '@/types/healthAdmin';
import { PharmacyTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(critical|high|reject|fail|block)/.test(v)) return colors.danger;
  if (/(pending|warn|flag|open|medium)/.test(v)) return colors.warning;
  if (/(resolve|approve|verified|complete|ok|low)/.test(v)) return colors.success;
  if (/(investigat)/.test(v)) return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Pharmacovigilance & recall" subtitle="Open and track product recalls — quarantine affected batches and notify patients. NAFDAC registration and batch surfaced." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <PharmacyTabs active="recall" />
      <DisclosureNote>Recalls quarantine the affected NAFDAC-registered batch and trigger patient notification. Opening a recall is an audited config/clinical action recorded to the immutable audit log (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Open a recall">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginTop: 14 }}>
          <div><label>Product name *</label><Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></div>
          <div><label>NAFDAC reg. no.</label><Input placeholder="A4-0100" value={form.nafdac_reg_no} onChange={(e) => setForm({ ...form, nafdac_reg_no: e.target.value })} /></div>
          <div><label>Batch no. *</label><Input value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} /></div>
          <div><label>Severity</label>
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as RecallSeverity })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label>Reason *</label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: '0.75rem' }}><Button variant="primary" disabled={busy} onClick={submit}>{busy ? 'Opening…' : 'Open recall (audited)'}</Button></div>
      </Card>

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Product, batch, NAFDAC no. or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label>Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No recalls match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Product</th><th style={thCell}>NAFDAC reg.</th><th style={thCell}>Batch</th><th style={thCell}>Pharmacy</th>
                <th style={thCell}>Severity</th><th style={thCell}>Units / notified</th><th style={thCell}>Reason</th><th style={thCell}>Status</th><th style={thCell}>When</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><div style={{ fontWeight: 600 }}>{r.product_name}</div><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                    <td style={tdCell}>{r.nafdac_reg_no ? <code style={{ fontSize: '0.76rem' }}>{r.nafdac_reg_no}</code> : '—'}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.batch_no}</code></td>
                    <td style={tdCell}>{r.pharmacy_masked}</td>
                    <td style={tdCell}><Badge text={r.severity} color={statusColor(r.severity)} /></td>
                    <td style={tdCell}>{r.units_affected.toLocaleString('en-NG')}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.patients_notified.toLocaleString('en-NG')} notified</div></td>
                    <td style={tdCell}>{r.reason}</td>
                    <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                    <td style={tdCell}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>
    </Page>
  );
}
