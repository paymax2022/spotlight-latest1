'use client';

import { useEffect, useState } from 'react';
import { listCatalog, governCatalogItem, formatNaira } from '@/services/healthPharmacyAdminService';
import type { CatalogItem, CatalogGovernanceAction } from '@/types/healthAdmin';
import { PharmacyTabs, DisclosureNote, StateBlock, FilterBar, AuditNote } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|fail|block|suspend|invalid|controlled)/.test(v)) return colors.danger;
  if (/(pending|warn|flag|pom)/.test(v)) return colors.warning;
  if (/(approve|verified|active|complete|ok|otc)/.test(v)) return colors.success;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Catalog & NAFDAC governance" subtitle="Product listing review — only NAFDAC-registered products may be listed; unregistered/banned items are rejected at write, not merely hidden. POM and controlled-substance flags surfaced." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <PharmacyTabs active="catalog" />
      <DisclosureNote>NAFDAC-only catalog (HL-5): approving an item with no valid NAFDAC registration is blocked. Controlled substances are excluded at MVP (HL-4). POM items carry an Rx-required flag enforced at order time (HL-3). Every governance decision posts an immutable audit event (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Product, brand, NAFDAC no. or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <label>Class</label>
          <select value={pom} onChange={(e) => setPom(e.target.value)}>
            <option value="">All</option>
            <option value="pom">POM (Rx)</option>
            <option value="otc">OTC</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No catalog items in this queue.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Product</th><th style={thCell}>Pharmacy</th><th style={thCell}>NAFDAC reg.</th><th style={thCell}>Class</th>
                <th style={thCell}>Price</th><th style={thCell}>Stock</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}>
                      <div style={{ fontWeight: 600 }}>{r.product_name}</div>
                      <div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.brand} · {r.form} {r.strength} · {r.id}</div>
                      {r.flagged_reason && <div style={{ marginTop: 4 }}><Badge text={r.flagged_reason} color={colors.warning} /></div>}
                    </td>
                    <td style={tdCell}>{r.pharmacy_masked}</td>
                    <td style={tdCell}>
                      {r.nafdac_reg_no ? <code style={{ fontSize: '0.76rem' }}>{r.nafdac_reg_no}</code> : <Badge text="none" color={colors.danger} />}
                      <div style={{ marginTop: 4 }}><Badge text={r.nafdac_valid ? 'valid' : 'invalid'} color={r.nafdac_valid ? colors.success : colors.danger} /></div>
                    </td>
                    <td style={tdCell}>
                      {r.controlled ? <Badge text="controlled" color={colors.danger} /> : r.pom ? <Badge text="POM" color={colors.warning} /> : <Badge text="OTC" color={colors.success} />}
                    </td>
                    <td style={tdCell}>{formatNaira(r.price_kobo)}</td>
                    <td style={tdCell}>{r.stock.toLocaleString('en-NG')}</td>
                    <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {(r.status === 'pending' || r.status === 'suspended') && <Button variant="primary" sm disabled={busy === r.id} onClick={() => govern(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</Button>}
                        {(r.status === 'pending' || r.status === 'approved') && <Button variant="danger" sm disabled={busy === r.id} onClick={() => govern(r, 'reject')}>Reject</Button>}
                        {r.status === 'approved' && <Button variant="outline" sm disabled={busy === r.id} onClick={() => govern(r, 'suspend')}>Suspend</Button>}
                        {(r.status === 'rejected') && <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                      </div>
                    </td>
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
