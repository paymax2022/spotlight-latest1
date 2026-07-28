'use client';

import { useEffect, useState } from 'react';
import { listOrders, getOrder, formatNaira } from '@/services/healthPharmacyAdminService';
import type { PharmacyOrderSummary, PharmacyOrderDetail } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, timeAgo } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Order & delivery oversight" subtitle="Monitor pharmacy orders through verify → dispense → last-mile delivery / pickup, with the held → released → refunded payment state alongside." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="orders" />
      <DisclosureNote>State machine: <strong>CREATED → [RX_PENDING] → CONFIRMED → DISPENSED → IN_DELIVERY | READY_FOR_PICKUP → DELIVERED | COLLECTED → CLOSED</strong>; pre-dispense → CANCELLED → REFUNDED. Payment is HELD on create, RELEASED on delivery/pickup, REFUNDED on cancel (HL-9). Delivery legs run on the existing last-mile transport rail. Read-only oversight; identities masked (HL-8).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Patient, pharmacy or order id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
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
          <label style={label()}>Fulfilment</label>
          <select style={select()} value={fulfilment} onChange={(e) => setFulfilment(e.target.value)}>
            <option value="">All</option>
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No orders match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Order</th><th style={th()}>Patient</th><th style={th()}>Pharmacy</th><th style={th()}>Fulfilment</th>
              <th style={th()}>Amount</th><th style={th()}>Payment</th><th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code>{r.has_pom && <div style={{ marginTop: 4 }}><Badge status="pom" label="POM" /></div>}</td>
                  <td style={td()}>{r.patient_masked}</td>
                  <td style={td()}>{r.pharmacy_masked}</td>
                  <td style={td()}><Badge status={r.fulfilment} />{r.delivery_ref && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>{r.delivery_ref}</div>}</td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}><Badge status={r.payment_status} /></td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}><button style={btn()} onClick={() => openDetail(r.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {(detailLoading || detail) && (
        <Card title={detail ? `Order ${detail.id}` : 'Loading order…'} right={detail ? <Badge status={detail.status} /> : undefined}>
          {detailLoading && <p style={{ color: '#6b7280' }}>Loading…</p>}
          {detail && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div><div style={{ color: '#6b7280', fontSize: '0.72rem' }}>Patient</div>{detail.patient_masked}</div>
                <div><div style={{ color: '#6b7280', fontSize: '0.72rem' }}>Pharmacy</div>{detail.pharmacy_masked}</div>
                <div><div style={{ color: '#6b7280', fontSize: '0.72rem' }}>Payment</div><Badge status={detail.payment_status} /></div>
                <div><div style={{ color: '#6b7280', fontSize: '0.72rem' }}>Rx ref</div>{detail.rx_ref ? <code>{detail.rx_ref}</code> : '—'}</div>
                <div><div style={{ color: '#6b7280', fontSize: '0.72rem' }}>Pickup code</div>{detail.pickup_code ?? '—'}</div>
                <div><div style={{ color: '#6b7280', fontSize: '0.72rem' }}>Delivery ref</div>{detail.delivery_ref ?? '—'}</div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                <thead><tr><th style={th()}>Item</th><th style={th()}>NAFDAC</th><th style={th()}>Class</th><th style={th()}>Qty</th><th style={th()}>Unit</th><th style={th()}>Total</th></tr></thead>
                <tbody>
                  {detail.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={td()}>{l.product_name}</td>
                      <td style={td()}>{l.nafdac_reg_no ? <code style={{ fontSize: '0.76rem' }}>{l.nafdac_reg_no}</code> : <Badge status="invalid" label="none" />}</td>
                      <td style={td()}>{l.pom ? <Badge status="pom" label="POM" /> : <Badge status="otc" label="OTC" />}</td>
                      <td style={td()}>{l.qty}</td>
                      <td style={td()}>{formatNaira(l.unit_price_kobo)}</td>
                      <td style={td()}>{formatNaira(l.line_total_kobo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td style={td()} colSpan={5}>Subtotal</td><td style={td()}>{formatNaira(detail.subtotal_kobo)}</td></tr>
                  <tr><td style={td()} colSpan={5}>Delivery fee</td><td style={td()}>{formatNaira(detail.delivery_fee_kobo)}</td></tr>
                  <tr><td style={{ ...td(), fontWeight: 700 }} colSpan={5}>Total</td><td style={{ ...td(), fontWeight: 700 }}>{formatNaira(detail.total_kobo)}</td></tr>
                </tfoot>
              </table>

              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Timeline (audited — HL-12)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Status</th><th style={th()}>Event</th><th style={th()}>Actor</th><th style={th()}>Audit</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {detail.timeline.map((t) => (
                    <tr key={t.id}>
                      <td style={td()}><Badge status={t.status} /></td>
                      <td style={td()}>{t.label}</td>
                      <td style={td()}>{t.actor_masked}</td>
                      <td style={td()}><code style={{ fontSize: '0.76rem' }}>{t.audit_id}</code></td>
                      <td style={td()}>{timeAgo(t.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
