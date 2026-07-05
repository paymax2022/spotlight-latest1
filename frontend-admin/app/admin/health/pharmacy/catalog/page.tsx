'use client';

import { useEffect, useState } from 'react';
import { listCatalog, governCatalogItem, formatNaira } from '@/services/healthPharmacyAdminService';
import type { CatalogItem, CatalogGovernanceAction } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select } from '../../_ui';

export default function CatalogGovernancePage() {
  const [rows, setRows] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [pom, setPom] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCatalog({ status: status || undefined, pom: pom || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, pom]);

  async function govern(item: CatalogItem, action: CatalogGovernanceAction) {
    const note = window.prompt(`${action} "${item.product_name}" (${item.id})? Audited NAFDAC governance — enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await governCatalogItem(item.id, action, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Catalog & NAFDAC governance" subtitle="Product listing review — only NAFDAC-registered products may be listed; unregistered/banned items are rejected at write, not merely hidden. POM and controlled-substance flags surfaced." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="catalog" />
      <DisclosureNote>NAFDAC-only catalog (HL-5): approving an item with no valid NAFDAC registration is blocked. Controlled substances are excluded at MVP (HL-4). POM items carry an Rx-required flag enforced at order time (HL-3). Every governance decision posts an immutable audit event (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Product, brand, NAFDAC no. or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <label style={label()}>Class</label>
          <select style={select()} value={pom} onChange={(e) => setPom(e.target.value)}>
            <option value="">All</option>
            <option value="pom">POM (Rx)</option>
            <option value="otc">OTC</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No catalog items in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Product</th><th style={th()}>Pharmacy</th><th style={th()}>NAFDAC reg.</th><th style={th()}>Class</th>
              <th style={th()}>Price</th><th style={th()}>Stock</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>
                    <div style={{ fontWeight: 600 }}>{r.product_name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.brand} · {r.form} {r.strength} · {r.id}</div>
                    {r.flagged_reason && <div style={{ marginTop: 4 }}><Badge status="flagged" label={r.flagged_reason} /></div>}
                  </td>
                  <td style={td()}>{r.pharmacy_masked}</td>
                  <td style={td()}>
                    {r.nafdac_reg_no ? <code style={{ fontSize: '0.76rem' }}>{r.nafdac_reg_no}</code> : <Badge status="invalid" label="none" />}
                    <div style={{ marginTop: 4 }}><Badge status={r.nafdac_valid ? 'verified' : 'invalid'} label={r.nafdac_valid ? 'valid' : 'invalid'} /></div>
                  </td>
                  <td style={td()}>
                    {r.controlled ? <Badge status="controlled" label="controlled" /> : r.pom ? <Badge status="pom" label="POM" /> : <Badge status="otc" label="OTC" />}
                  </td>
                  <td style={td()}>{formatNaira(r.price_kobo)}</td>
                  <td style={td()}>{r.stock.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {(r.status === 'pending' || r.status === 'suspended') && <button style={btnPrimary()} disabled={busy === r.id} onClick={() => govern(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</button>}
                      {(r.status === 'pending' || r.status === 'approved') && <button style={btnDanger()} disabled={busy === r.id} onClick={() => govern(r, 'reject')}>Reject</button>}
                      {r.status === 'approved' && <button style={btn()} disabled={busy === r.id} onClick={() => govern(r, 'suspend')}>Suspend</button>}
                      {(r.status === 'rejected') && <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
                    </div>
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
