'use client';

import { useEffect, useState } from 'react';
import { listCatalog, upsertCatalogItem, formatNaira, formatPoints } from '@/services/loyaltyAdminService';
import type { CatalogItem, RedemptionKind, CatalogStatus } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../../events/_ui';
import { Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 } as const;

export default function CatalogPage() {
  const [rows, setRows] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // simple create form
  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState('');
  const [fKind, setFKind] = useState<RedemptionKind>('airtime');
  const [fCost, setFCost] = useState('1000');
  const [fCash, setFCash] = useState('500');
  const [fStock, setFStock] = useState('-1');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCatalog({ kind: kind || undefined, status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind, status]);

  async function toggleStatus(item: CatalogItem) {
    const next: CatalogStatus = item.status === 'active' ? 'disabled' : 'active';
    if (!window.confirm(`Set "${item.name}" to ${next}? Audited change.`)) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await upsertCatalogItem({ id: item.id, name: item.name, kind: item.kind, cost_points: item.cost_points, cash_value_kobo: item.cash_value_kobo, stock: item.stock, status: next });
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function createItem() {
    const cost = Number(fCost); const cashNaira = Number(fCash); const stock = Number(fStock);
    if (!fName.trim() || Number.isNaN(cost) || cost <= 0) { setMsg('Name and a positive point cost are required.'); return; }
    setBusy('new'); setMsg(null);
    try {
      const res = await upsertCatalogItem({ name: fName.trim(), kind: fKind, cost_points: cost, cash_value_kobo: Math.round((Number.isNaN(cashNaira) ? 0 : cashNaira) * 100), stock: Number.isNaN(stock) ? -1 : stock, status: 'draft' });
      setMsg(res.message + ` (audit ${res.audit_id})`);
      setShowForm(false); setFName('');
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Rewards catalog" subtitle="Catalog CRUD — airtime, bill credit, ticket discounts and perks redeemable with points." action={<div style={{ display: 'flex', gap: '0.5rem' }}><Button variant="primary" sm onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : 'New item'}</Button><Button variant="outline" sm onClick={load}>Refresh</Button></div>} />
      <LoyaltyTabs active="catalog" />
      <DisclosureNote><strong>NL-4 — non-cash.</strong> Catalog items redeem only to airtime / bill credit / ticket discount / perk; never bank cash-out. The ₦ &quot;cash value&quot; is the value delivered (e.g. airtime topped up), not a cash payout. New items default to <em>draft</em>; publish explicitly. All changes audited (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      {showForm && (
        <Card title="Create catalog item (saved as draft)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.6rem', alignItems: 'flex-end' }}>
            <div><label style={labelStyle}>Name</label><Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. ₦1,000 Airtime" /></div>
            <div><label style={labelStyle}>Kind</label>
              <select value={fKind} onChange={(e) => setFKind(e.target.value as RedemptionKind)}>
                <option value="airtime">Airtime</option>
                <option value="bill_credit">Bill credit</option>
                <option value="ticket_discount">Ticket discount</option>
                <option value="perk">Perk</option>
              </select>
            </div>
            <div><label style={labelStyle}>Cost (points)</label><Input value={fCost} onChange={(e) => setFCost(e.target.value)} /></div>
            <div><label style={labelStyle}>Cash value (₦)</label><Input value={fCash} onChange={(e) => setFCash(e.target.value)} /></div>
            <div><label style={labelStyle}>Stock (-1 = ∞)</label><Input value={fStock} onChange={(e) => setFStock(e.target.value)} /></div>
            <Button variant="primary" disabled={busy === 'new'} onClick={createItem}>{busy === 'new' ? '…' : 'Create draft'}</Button>
          </div>
        </Card>
      )}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={labelStyle}>Search</label>
          <Input placeholder="Name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={labelStyle}>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="airtime">Airtime</option>
            <option value="bill_credit">Bill credit</option>
            <option value="ticket_discount">Ticket discount</option>
            <option value="perk">Perk</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No catalog items match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Item</th><th style={thCell}>Kind</th><th style={thCell}>Cost</th><th style={thCell}>Cash value</th>
              <th style={thCell}>Stock</th><th style={thCell}>Redeemed</th><th style={thCell}>Status</th><th style={thCell}>Updated</th><th style={thCell}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>{r.name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={tdCell}><Badge status={r.kind} label={r.kind.replace(/_/g, ' ')} /></td>
                  <td style={tdCell}>{formatPoints(r.cost_points)}</td>
                  <td style={tdCell}>{r.cash_value_kobo > 0 ? formatNaira(r.cash_value_kobo) : <span style={{ color: colors.muted }}>n/a (perk)</span>}</td>
                  <td style={tdCell}>{r.stock < 0 ? '∞' : r.stock.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{r.redeemed.toLocaleString('en-NG')}</td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                  <td style={tdCell}>{fmtDate(r.updated_at)}</td>
                  <td style={tdCell}>
                    <Button variant="outline" sm disabled={busy === r.id} onClick={() => toggleStatus(r)}>{busy === r.id ? '…' : r.status === 'active' ? 'Disable' : 'Publish'}</Button>
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
