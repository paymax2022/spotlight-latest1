'use client';

import { useEffect, useState } from 'react';
import { listCatalog, upsertCatalogItem, formatNaira, formatPoints } from '@/services/loyaltyAdminService';
import type { CatalogItem, RedemptionKind, CatalogStatus } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, th, td, input, label, select, fmtDate } from '../../events/_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

export default function CatalogPage() {
  const [rows, setRows] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: CatalogItem; next: CatalogStatus } | null>(null);

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

  function askToggle(item: CatalogItem) {
    const next: CatalogStatus = item.status === 'active' ? 'disabled' : 'active';
    setMsg(null);
    setPending({ item, next });
  }

  // reason is captured as an operator acknowledgement for the audit trail;
  // upsertCatalogItem does not accept a reason argument (signature unchanged).
  async function confirmToggle(_reason: string) {
    if (!pending) return;
    const { item, next } = pending;
    setBusy(item.id); setMsg(null);
    try {
      const res = await upsertCatalogItem({ id: item.id, name: item.name, kind: item.kind, cost_points: item.cost_points, cash_value_kobo: item.cash_value_kobo, stock: item.stock, status: next });
      setMsg(res.message + ` (audit ${res.audit_id})`);
      setPending(null);
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
      <PageHeader title="Rewards catalog" subtitle="Catalog CRUD — airtime, bill credit, ticket discounts and perks redeemable with points." action={<div style={{ display: 'flex', gap: '0.5rem' }}><button onClick={() => setShowForm((s) => !s)} style={btnPrimary()}>{showForm ? 'Close' : 'New item'}</button><button onClick={load} style={btn()}>Refresh</button></div>} />
      <LoyaltyTabs active="catalog" />
      <DisclosureNote><strong>NL-4 — non-cash.</strong> Catalog items redeem only to airtime / bill credit / ticket discount / perk; never bank cash-out. The ₦ &quot;cash value&quot; is the value delivered (e.g. airtime topped up), not a cash payout. New items default to <em>draft</em>; publish explicitly. All changes audited (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      {showForm && (
        <Card title="Create catalog item (saved as draft)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.6rem', alignItems: 'flex-end' }}>
            <div><label style={label()}>Name</label><input style={input()} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. ₦1,000 Airtime" /></div>
            <div><label style={label()}>Kind</label>
              <select style={select()} value={fKind} onChange={(e) => setFKind(e.target.value as RedemptionKind)}>
                <option value="airtime">Airtime</option>
                <option value="bill_credit">Bill credit</option>
                <option value="ticket_discount">Ticket discount</option>
                <option value="perk">Perk</option>
              </select>
            </div>
            <div><label style={label()}>Cost (points)</label><input style={input()} value={fCost} onChange={(e) => setFCost(e.target.value)} /></div>
            <div><label style={label()}>Cash value (₦)</label><input style={input()} value={fCash} onChange={(e) => setFCash(e.target.value)} /></div>
            <div><label style={label()}>Stock (-1 = ∞)</label><input style={input()} value={fStock} onChange={(e) => setFStock(e.target.value)} /></div>
            <button style={btnPrimary()} disabled={busy === 'new'} onClick={createItem}>{busy === 'new' ? '…' : 'Create draft'}</button>
          </div>
        </Card>
      )}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="airtime">Airtime</option>
            <option value="bill_credit">Bill credit</option>
            <option value="ticket_discount">Ticket discount</option>
            <option value="perk">Perk</option>
          </select>
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No catalog items match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Item</th><th style={th()}>Kind</th><th style={th()}>Cost</th><th style={th()}>Cash value</th>
              <th style={th()}>Stock</th><th style={th()}>Redeemed</th><th style={th()}>Status</th><th style={th()}>Updated</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}><Badge status={r.kind} label={r.kind.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{formatPoints(r.cost_points)}</td>
                  <td style={td()}>{r.cash_value_kobo > 0 ? formatNaira(r.cash_value_kobo) : <span style={{ color: '#9ca3af' }}>n/a (perk)</span>}</td>
                  <td style={td()}>{r.stock < 0 ? '∞' : r.stock.toLocaleString('en-NG')}</td>
                  <td style={td()}>{r.redeemed.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{fmtDate(r.updated_at)}</td>
                  <td style={td()}>
                    <button style={btn()} disabled={busy === r.id} onClick={() => askToggle(r)}>{busy === r.id ? '…' : r.status === 'active' ? 'Disable' : 'Publish'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {pending && (
        <ConfirmDialog
          open
          level="warning"
          title={pending.next === 'active' ? 'Publish catalog item' : 'Disable catalog item'}
          description={`"${pending.item.name}" → ${pending.next}. ${pending.next === 'active' ? 'Members will be able to redeem this item with points.' : 'Members will no longer be able to redeem this item.'}`}
          reasons={[
            pending.next === 'active'
              ? 'Makes this reward redeemable with points (NL-4 — non-cash).'
              : 'Removes this reward from redemption.',
            'Recorded in the audit log with your name, reason and timestamp (NL-12).',
          ]}
          requireReason
          reasonPlaceholder="Why are you changing this catalog item?"
          busy={busy === pending.item.id}
          confirmLabel={pending.next === 'active' ? 'Publish' : 'Disable'}
          onConfirm={confirmToggle}
          onCancel={() => {
            if (busy !== pending.item.id) setPending(null);
          }}
        />
      )}
    </div>
  );
}
