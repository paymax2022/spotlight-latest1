'use client';

import { useEffect, useState } from 'react';
import { listOrders, getOrder, formatNaira } from '@/services/healthPharmacyAdminService';
import type { PharmacyOrderSummary, PharmacyOrderDetail } from '@/types/healthAdmin';
import { PharmacyTabs, DisclosureNote, StateBlock, FilterBar, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (/(reject|fail|block|cancel|invalid)/.test(v)) return colors.danger;
  if (/(pending|warn|flag|pom)/.test(v)) return colors.warning;
  if (/(approve|verified|active|complete|ok|delivered|collected|dispensed|closed|otc)/.test(v)) return colors.success;
  if (/(process|confirm|delivery|pickup|created)/.test(v)) return colors.info;
  return colors.secondary;
}

export default function OrdersOversightPage() {
  const [rows, setRows] = useState<PharmacyOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [fulfilment, setFulfilment] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<PharmacyOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listOrders({ status: status || undefined, fulfilment: fulfilment || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, fulfilment]);

  async function openDetail(id: string) {
    setDetailLoading(true); setDetail(null);
    try { setDetail(await getOrder(id)); }
    catch (e) { setError(String(e)); }
    finally { setDetailLoading(false); }
  }

  return (
    <Page>
      <PageHeader title="Order & delivery oversight" subtitle="Monitor pharmacy orders through verify → dispense → last-mile delivery / pickup, with the held → released → refunded payment state alongside." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <PharmacyTabs active="orders" />
      <DisclosureNote>State machine: <strong>CREATED → [RX_PENDING] → CONFIRMED → DISPENSED → IN_DELIVERY | READY_FOR_PICKUP → DELIVERED | COLLECTED → CLOSED</strong>; pre-dispense → CANCELLED → REFUNDED. Payment is HELD on create, RELEASED on delivery/pickup, REFUNDED on cancel (HL-9). Delivery legs run on the existing last-mile transport rail. Read-only oversight; identities masked (HL-8).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Patient, pharmacy or order id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="rx_pending_verification">Rx pending verify</option>
            <option value="confirmed">Confirmed</option>
            <option value="dispensed">Dispensed</option>
            <option value="in_delivery">In delivery</option>
            <option value="ready_for_pickup">Ready for pickup</option>
            <option value="delivered">Delivered</option>
            <option value="collected">Collected</option>
            <option value="cancelled">Cancelled</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label>Fulfilment</label>
          <select value={fulfilment} onChange={(e) => setFulfilment(e.target.value)}>
            <option value="">All</option>
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No orders match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Order</th><th style={thCell}>Patient</th><th style={thCell}>Pharmacy</th><th style={thCell}>Fulfilment</th>
                <th style={thCell}>Amount</th><th style={thCell}>Payment</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.id}</code>{r.has_pom && <div style={{ marginTop: 4 }}><Badge text="POM" color={colors.warning} /></div>}</td>
                    <td style={tdCell}>{r.patient_masked}</td>
                    <td style={tdCell}>{r.pharmacy_masked}</td>
                    <td style={tdCell}><Badge text={r.fulfilment} color={statusColor(r.fulfilment)} />{r.delivery_ref && <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 4 }}>{r.delivery_ref}</div>}</td>
                    <td style={tdCell}>{formatNaira(r.amount_kobo)}</td>
                    <td style={tdCell}><Badge text={r.payment_status.replace(/_/g, ' ')} color={statusColor(r.payment_status)} /></td>
                    <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} /></td>
                    <td style={tdCell}><Button variant="outline" sm onClick={() => openDetail(r.id)}>View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>

      {(detailLoading || detail) && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>{detail ? `Order ${detail.id}` : 'Loading order…'}</h2>
            {detail ? <Badge text={detail.status.replace(/_/g, ' ')} color={statusColor(detail.status)} /> : null}
          </div>
          {detailLoading && <p style={{ color: colors.muted }}>Loading…</p>}
          {detail && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div><div style={{ color: colors.muted, fontSize: '0.72rem' }}>Patient</div>{detail.patient_masked}</div>
                <div><div style={{ color: colors.muted, fontSize: '0.72rem' }}>Pharmacy</div>{detail.pharmacy_masked}</div>
                <div><div style={{ color: colors.muted, fontSize: '0.72rem' }}>Payment</div><Badge text={detail.payment_status.replace(/_/g, ' ')} color={statusColor(detail.payment_status)} /></div>
                <div><div style={{ color: colors.muted, fontSize: '0.72rem' }}>Rx ref</div>{detail.rx_ref ? <code>{detail.rx_ref}</code> : '—'}</div>
                <div><div style={{ color: colors.muted, fontSize: '0.72rem' }}>Pickup code</div>{detail.pickup_code ?? '—'}</div>
                <div><div style={{ color: colors.muted, fontSize: '0.72rem' }}>Delivery ref</div>{detail.delivery_ref ?? '—'}</div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                <thead><tr><th style={thCell}>Item</th><th style={thCell}>NAFDAC</th><th style={thCell}>Class</th><th style={thCell}>Qty</th><th style={thCell}>Unit</th><th style={thCell}>Total</th></tr></thead>
                <tbody>
                  {detail.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={tdCell}>{l.product_name}</td>
                      <td style={tdCell}>{l.nafdac_reg_no ? <code style={{ fontSize: '0.76rem' }}>{l.nafdac_reg_no}</code> : <Badge text="none" color={colors.danger} />}</td>
                      <td style={tdCell}>{l.pom ? <Badge text="POM" color={colors.warning} /> : <Badge text="OTC" color={colors.success} />}</td>
                      <td style={tdCell}>{l.qty}</td>
                      <td style={tdCell}>{formatNaira(l.unit_price_kobo)}</td>
                      <td style={tdCell}>{formatNaira(l.line_total_kobo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td style={tdCell} colSpan={5}>Subtotal</td><td style={tdCell}>{formatNaira(detail.subtotal_kobo)}</td></tr>
                  <tr><td style={tdCell} colSpan={5}>Delivery fee</td><td style={tdCell}>{formatNaira(detail.delivery_fee_kobo)}</td></tr>
                  <tr><td style={{ ...tdCell, fontWeight: 700 }} colSpan={5}>Total</td><td style={{ ...tdCell, fontWeight: 700 }}>{formatNaira(detail.total_kobo)}</td></tr>
                </tfoot>
              </table>

              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Timeline (audited — HL-12)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Status</th><th style={thCell}>Event</th><th style={thCell}>Actor</th><th style={thCell}>Audit</th><th style={thCell}>When</th></tr></thead>
                <tbody>
                  {detail.timeline.map((t) => (
                    <tr key={t.id}>
                      <td style={tdCell}><Badge text={t.status.replace(/_/g, ' ')} color={statusColor(t.status)} /></td>
                      <td style={tdCell}>{t.label}</td>
                      <td style={tdCell}>{t.actor_masked}</td>
                      <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{t.audit_id}</code></td>
                      <td style={tdCell}>{timeAgo(t.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      )}
    </Page>
  );
}
