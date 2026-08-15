'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getReservation, formatNaira, formatMoney } from '@/services/staysAdminService';
import type { ReservationDetail } from '@/types/staysAdmin';
import { StaysTabs, Badge, fmtDate, timeAgo, StateBlock, DisclosureNote } from '../../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{k}</div>
      <div style={{ fontSize: '0.9rem', color: colors.text, marginTop: '0.15rem' }}>{v}</div>
    </div>
  );
}

const code: React.CSSProperties = { fontSize: '0.78rem', background: tint(colors.muted, 0.12), padding: '0.1rem 0.35rem', borderRadius: '0.25rem' };

export default function StaysReservationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<ReservationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReservation(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  return (
    <Page>
      <PageHeader
        title="Reservation detail"
        subtitle="Lifecycle timeline, money breakdown and double-entry ledger for a single booking. Guest PII is masked."
        actions={
          <Link href="/admin/stays/reservations" style={{ textDecoration: 'none' }}>
            <Button variant="outline">&larr; Back to reservations</Button>
          </Link>
        }
      />
      <StaysTabs active="reservations" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Reservation not found.">
        {data && (
          <>
            <DisclosureNote>
              Source rail <strong>{data.rail}</strong> via supplier <strong>{data.supplier_code}</strong>
              {data.fx_rate != null && data.fx_supplier_currency
                ? <> &middot; cross-currency booking — supplier currency <strong>{data.fx_supplier_currency}</strong> converted at FX rate <strong>{data.fx_rate}</strong> (NGN per {data.fx_supplier_currency}). FX disclosed per PRD §5/§12.</>
                : <> &middot; settled in NGN, no FX conversion.</>}
            </DisclosureNote>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: colors.text }}>Booking facts</h2>
                <Badge status={data.state} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                <Fact k="Reservation ID" v={<code style={code}>{data.id}</code>} />
                <Fact k="Supplier ref" v={data.supplier_ref ? <code style={code}>{data.supplier_ref}</code> : '—'} />
                <Fact k="Property" v={`${data.property_name} (${data.city})`} />
                <Fact k="Rail" v={<Badge status={data.rail} />} />
                <Fact k="Supplier" v={<Badge status={data.supplier_code} />} />
                <Fact k="Room type" v={data.room_type} />
                <Fact k="Rate plan" v={data.rate_plan} />
                <Fact k="Board" v={data.board} />
                <Fact k="Occupancy" v={data.occupancy} />
                <Fact k="Rooms" v={String(data.rooms)} />
                <Fact k="Check-in" v={fmtDate(data.check_in)} />
                <Fact k="Check-out" v={fmtDate(data.check_out)} />
                <Fact k="Refundable" v={<Badge status={data.refundable ? 'approved' : 'rejected'} label={data.refundable ? 'Refundable' : 'Non-refundable'} />} />
                <Fact k="Cancellation policy" v={data.cancellation_policy} />
                <Fact k="Payment method" v={data.payment_method} />
                <Fact k="Idempotency key" v={<code style={code}>{data.idempotency_key}</code>} />
                <Fact k="Book token" v={<code style={code}>{data.book_token_ref}</code>} />
                <Fact k="Guest email" v={data.guest_email_masked} />
                <Fact k="Guest phone" v={data.guest_phone_masked} />
                <Fact k="Consent version" v={<code style={code}>{data.consent_version}</code>} />
              </div>
            </Card>

            <Card title="Money breakdown">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                <Fact k="Net rate" v={formatNaira(data.net_rate_kobo)} />
                <Fact k="Markup" v={formatNaira(data.markup_kobo)} />
                <Fact k="Tax" v={formatNaira(data.tax_amount_kobo)} />
                <Fact k="Gross" v={<strong>{formatNaira(data.gross_amount_kobo)} {data.currency}</strong>} />
                {data.fx_rate != null && data.fx_supplier_currency && (
                  <Fact k="Supplier net (FX)" v={`${formatMoney(Math.round(data.net_rate_kobo / data.fx_rate), data.fx_supplier_currency)} @ ${data.fx_rate}`} />
                )}
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: colors.text }}>Ledger</h2>
                <span style={{ fontSize: '0.75rem', color: colors.muted }}>double-entry — HOLD &rarr; CHARGE &rarr; RELEASE/REFUND</span>
              </div>
              {data.ledger.length === 0 ? (
                <p style={{ color: colors.muted }}>No ledger entries recorded.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thCell}>Kind</th>
                        <th style={thCell}>Amount</th>
                        <th style={thCell}>Ledger ref</th>
                        <th style={thCell}>Status</th>
                        <th style={thCell}>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((l) => (
                        <tr key={l.id}>
                          <td style={tdCell}><Badge status={l.kind} /></td>
                          <td style={tdCell}>{formatNaira(l.amount_kobo)}</td>
                          <td style={tdCell}><code style={code}>{l.ledger_ref}</code></td>
                          <td style={tdCell}><Badge status={l.status} /></td>
                          <td style={tdCell}>{fmtDate(l.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="State timeline">
              {data.timeline.length === 0 ? (
                <p style={{ color: colors.muted }}>No timeline entries.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {data.timeline.map((t, i) => (
                    <div key={`${t.at}-${i}`} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 150 }}><Badge status={t.state} /></div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: colors.text }}>
                          <strong>{t.actor}</strong>{t.note ? ` — ${t.note}` : ''}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.1rem' }}>{fmtDate(t.at)} &middot; {timeAgo(t.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
