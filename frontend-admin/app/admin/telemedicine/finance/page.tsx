'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getFinanceSummary, listPayouts, getPayout, listEarnings, listInvoices, listDisputes, getDispute,
  getCommissionConfig, formatKobo, bpsToPercent,
  type FinanceSummary, type Payout, type PayoutDetail, type DoctorEarnings, type Invoice, type Dispute,
  type DisputeDetail, type CommissionConfigView,
} from '@/services/telemedAdminFinanceService';
import {
  PageHeader, TelemedTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, FilterBar,
  btn, th, td, input, label, select, fmtDate,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

type Section = 'payouts' | 'earnings' | 'invoices' | 'disputes' | 'commission';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'payouts', label: 'Payouts' },
  { key: 'earnings', label: 'Doctor earnings' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'disputes', label: 'Settlement disputes' },
  { key: 'commission', label: 'Commission config' },
];
const PAGE_SIZE = 25;

const PAYOUT_BADGE: Record<string, string> = {
  pending: 'pending', processing: 'in_progress', paid: 'approved', failed: 'rejected', reversed: 'rejected',
};

function useLoader<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await run()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [run]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

function Pager({ total, offset, onChange }: { total: number; offset: number; onChange: (o: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const last = offset + PAGE_SIZE >= total;
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: colors.muted }}>
      <button style={btn()} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
      <button style={btn()} disabled={last} onClick={() => onChange(offset + PAGE_SIZE)}>Next</button>
    </div>
  );
}

function bankText(p: Payout): string {
  const b = p.bank_account;
  if (!b.bank_name && !b.account_last4) return '—';
  return `${b.bank_name ?? 'Bank'} ••••${b.account_last4 ?? ''}${b.is_verified ? '' : ' (unverified)'}`;
}

export default function TelemedFinancePage() {
  const [section, setSection] = useState<Section>('payouts');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });

  const summary = useLoader<FinanceSummary>(
    () => getFinanceSummary({ from: applied.from || undefined, to: applied.to || undefined }),
    [applied.from, applied.to],
  );

  const s = summary.data;
  const byStatus = (st: string) => s?.payouts_by_status.find((p) => p.status === st);
  const money = (n?: number) => (s ? formatKobo(n ?? 0) : '—');

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Telemedicine finance"
        subtitle="Doctor earnings, payouts, invoices and settlement disputes across the telemedicine book."
        action={<button style={btn()} onClick={summary.reload}>Refresh</button>}
      />
      <TelemedTabs active="finance" />
      <DisclosureNote>
        Read-only oversight. Nothing on this page moves money, edits a payout, or posts to the ledger. Consult
        figures are derived from completed appointments with the fixed 85/15 settlement split; the ledger remains
        the source of truth for balances. Bank account numbers are shown as the last four digits only.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>From</label>
          <input style={input()} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label style={label()}>To (exclusive)</label>
          <input style={input()} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button style={btn()} onClick={() => setApplied({ from, to })}>Apply period</button>
        {(applied.from || applied.to) && (
          <button style={btn()} onClick={() => { setFrom(''); setTo(''); setApplied({ from: '', to: '' }); }}>All time</button>
        )}
      </FilterBar>

      <StateBlock loading={summary.loading && !s} error={summary.error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Gross consult fees" value={money(s?.gross_consult_fees_kobo)} sub={`${(s?.completed_consultations ?? 0).toLocaleString('en-NG')} completed consultations`} accent="#340075" />
          <Kpi label="Platform commission" value={money(s?.platform_commission_kobo)} sub={`${bpsToPercent(1500)} of consult fees`} />
          <Kpi label="Booking fees" value={money(s?.platform_booking_fees_kobo)} sub="Platform leg on top of the split" />
          <Kpi label="Doctor net" value={money(s?.doctor_net_kobo)} />
          <Kpi label="Payouts pending" value={money(byStatus('pending')?.amount_kobo)} sub={`${byStatus('pending')?.count ?? 0} payouts`} />
          <Kpi label="Payouts processing" value={money(byStatus('processing')?.amount_kobo)} sub={`${byStatus('processing')?.count ?? 0} payouts`} />
          <Kpi label="Payouts paid" value={money(byStatus('paid')?.amount_kobo)} sub={`${byStatus('paid')?.count ?? 0} payouts`} accent="#15803d" />
          <Kpi label="Failed / reversed" value={`${(byStatus('failed')?.count ?? 0) + (byStatus('reversed')?.count ?? 0)}`} sub={money((byStatus('failed')?.amount_kobo ?? 0) + (byStatus('reversed')?.amount_kobo ?? 0))} accent={(byStatus('failed')?.count ?? 0) + (byStatus('reversed')?.count ?? 0) > 0 ? '#9a3412' : undefined} />
          <Kpi label="Open disputes" value={`${s?.open_disputes ?? 0}`} accent={(s?.open_disputes ?? 0) > 0 ? '#9a3412' : undefined} />
        </div>
      </StateBlock>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {SECTIONS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            style={{ ...btn(), background: section === t.key ? colors.primary : colors.bg, color: section === t.key ? '#fff' : colors.text, fontWeight: 600 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'payouts' && <PayoutsSection from={applied.from} to={applied.to} />}
      {section === 'earnings' && <EarningsSection from={applied.from} to={applied.to} />}
      {section === 'invoices' && <InvoicesSection from={applied.from} to={applied.to} />}
      {section === 'disputes' && <DisputesSection />}
      {section === 'commission' && <CommissionSection />}
    </div>
  );
}

function PayoutsSection({ from, to }: { from: string; to: string }) {
  const [status, setStatus] = useState('');
  const [doctor, setDoctor] = useState('');
  const [doctorApplied, setDoctorApplied] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { setOffset(0); }, [status, doctorApplied, from, to]);
  const { data, loading, error, reload } = useLoader(
    () => listPayouts({ status: status || undefined, doctor_user_id: doctorApplied || undefined, from: from || undefined, to: to || undefined, limit: PAGE_SIZE, offset }),
    [status, doctorApplied, from, to, offset],
  );
  const rows = data?.items ?? [];

  return (
    <Card title="Payouts" right={<button style={btn()} onClick={reload}>Reload</button>}>
      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['pending', 'processing', 'paid', 'failed', 'reversed'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 280 }}>
          <label style={label()}>Doctor user id</label>
          <input style={input()} placeholder="UUID (from the earnings tab)" value={doctor} onChange={(e) => setDoctor(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && setDoctorApplied(doctor)} />
        </div>
        <button style={btn()} onClick={() => setDoctorApplied(doctor)}>Filter</button>
      </FilterBar>
      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th()}>Requested</th><th style={th()}>Doctor</th><th style={th()}>Amount</th><th style={th()}>Status</th>
            <th style={th()}>Consults</th><th style={th()}>Bank</th><th style={th()}>Disputes</th><th style={th()}></th>
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td style={td()}>{fmtDate(p.requested_at)}</td>
                <td style={td()}>{p.doctor_name || <span style={{ color: colors.muted }}>Unknown</span>}</td>
                <td style={td()}>{formatKobo(p.amount_kobo)}</td>
                <td style={td()}><Badge status={PAYOUT_BADGE[p.status] ?? p.status} label={p.status} /></td>
                <td style={td()}>{p.consult_count}</td>
                <td style={td()}>{bankText(p)}</td>
                <td style={td()}>{p.open_disputes > 0 ? <Badge status="rejected" label={`${p.open_disputes} open`} /> : '—'}</td>
                <td style={td()}><button style={btn()} onClick={() => setOpenId(openId === p.id ? null : p.id)}>{openId === p.id ? 'Hide' : 'Details'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager total={data?.total ?? 0} offset={offset} onChange={setOffset} />
      </StateBlock>
      {openId && <PayoutDetailPanel id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', padding: '0.2rem 0', fontSize: '0.85rem' }}>
      <span style={{ width: 170, color: colors.muted, flexShrink: 0 }}>{k}</span>
      <span style={{ wordBreak: 'break-word' }}>{v ?? '—'}</span>
    </div>
  );
}

function PayoutDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useLoader<PayoutDetail>(() => getPayout(id), [id]);
  return (
    <div style={{ marginTop: '1rem', padding: '1rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: colors.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <strong>Payout detail</strong><button style={btn()} onClick={onClose}>Close</button>
      </div>
      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <KV k="Reference" v={data.ref} />
            <KV k="Doctor" v={data.doctor_name} />
            <KV k="Amount" v={formatKobo(data.amount_kobo)} />
            <KV k="Status" v={data.status} />
            <KV k="Period" v={data.period_label} />
            <KV k="Bank" v={bankText(data)} />
            <KV k="Requested" v={fmtDate(data.requested_at)} />
            <KV k="Paid" v={data.paid_at ? fmtDate(data.paid_at) : null} />
            <KV k="Ledger ref" v={data.ledger_ref} />
            <KV k="Provider reference" v={data.provider_reference} />
            {data.failure_reason && <KV k="Failure reason" v={data.failure_reason} />}
            <div style={{ marginTop: '0.6rem', fontWeight: 600, fontSize: '0.85rem' }}>Disputes ({data.disputes.length})</div>
            {data.disputes.length === 0 ? <p style={{ color: colors.muted, fontSize: '0.82rem' }}>None.</p> : data.disputes.map((d) => (
              <div key={d.id} style={{ fontSize: '0.82rem', padding: '0.25rem 0' }}>
                <Badge status={d.status} /> {d.reason ?? 'No reason given'} · {fmtDate(d.created_at)}
              </div>
            ))}
          </>
        )}
      </StateBlock>
    </div>
  );
}

function EarningsSection({ from, to }: { from: string; to: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [from, to]);
  const { data, loading, error, reload } = useLoader(
    () => listEarnings({ from: from || undefined, to: to || undefined, limit: PAGE_SIZE, offset }),
    [from, to, offset],
  );
  const rows: DoctorEarnings[] = data?.items ?? [];
  return (
    <Card title="Doctor earnings" right={<button style={btn()} onClick={reload}>Reload</button>}>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: colors.muted }}>
        Earnings follow the selected period; “paid out” and “in flight” are all-time payout totals. No balance is
        computed here — the wallet ledger is authoritative.
      </p>
      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No doctors found.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th()}>Doctor</th><th style={th()}>Consults</th><th style={th()}>Gross</th><th style={th()}>Commission</th>
            <th style={th()}>Net</th><th style={th()}>Paid out</th><th style={th()}>In flight</th>
          </tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.doctor_id}>
                <td style={td()}>{e.doctor_name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{e.specialty} · <code>{e.doctor_user_id.slice(0, 8)}…</code></div></td>
                <td style={td()}>{e.completed_consultations}</td>
                <td style={td()}>{formatKobo(e.gross_kobo)}</td>
                <td style={td()}>{formatKobo(e.commission_kobo)}</td>
                <td style={td()}>{formatKobo(e.net_kobo)}</td>
                <td style={td()}>{formatKobo(e.paid_out_kobo)}</td>
                <td style={td()}>{formatKobo(e.in_flight_kobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager total={data?.total ?? 0} offset={offset} onChange={setOffset} />
      </StateBlock>
    </Card>
  );
}

function InvoicesSection({ from, to }: { from: string; to: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [from, to]);
  const { data, loading, error, reload } = useLoader(
    () => listInvoices({ from: from || undefined, to: to || undefined, limit: PAGE_SIZE, offset }),
    [from, to, offset],
  );
  const rows: Invoice[] = data?.items ?? [];
  return (
    <Card title="Doctor invoices" right={<button style={btn()} onClick={reload}>Reload</button>}>
      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No invoices in this period.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th()}>Issued</th><th style={th()}>Doctor</th><th style={th()}>Ref</th><th style={th()}>Gross</th>
            <th style={th()}>Commission</th><th style={th()}>VAT</th><th style={th()}>Net</th><th style={th()}>Status</th>
          </tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td style={td()}>{fmtDate(i.issued_at)}</td>
                <td style={td()}>{i.doctor_name || '—'}</td>
                <td style={td()}><code style={{ fontSize: '0.78rem' }}>{i.ref ?? '—'}</code></td>
                <td style={td()}>{formatKobo(i.gross_kobo)}</td>
                <td style={td()}>{formatKobo(i.commission_kobo)}</td>
                <td style={td()}>{formatKobo(i.vat_kobo)}</td>
                <td style={td()}>{formatKobo(i.net_kobo)}</td>
                <td style={td()}><Badge status={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager total={data?.total ?? 0} offset={offset} onChange={setOffset} />
      </StateBlock>
    </Card>
  );
}

function DisputesSection() {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { setOffset(0); }, [status]);
  const { data, loading, error, reload } = useLoader(
    () => listDisputes({ status: status || undefined, limit: PAGE_SIZE, offset }),
    [status, offset],
  );
  const rows: Dispute[] = data?.items ?? [];
  return (
    <Card title="Settlement disputes" right={<button style={btn()} onClick={reload}>Reload</button>}>
      <DisclosureNote>
        Disputes are raised by doctors from the app and only have an “open” state today, so this queue is
        read-only. Resolve them with the doctor and finance outside this console.
      </DisclosureNote>
      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
          </select>
        </div>
      </FilterBar>
      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No settlement disputes.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th()}>Raised</th><th style={th()}>Doctor</th><th style={th()}>Reason</th><th style={th()}>Status</th><th style={th()}></th>
          </tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td style={td()}>{fmtDate(d.created_at)}</td>
                <td style={td()}>{d.doctor_name || '—'}</td>
                <td style={td()}>{d.reason ?? '—'}</td>
                <td style={td()}><Badge status={d.status} /></td>
                <td style={td()}><button style={btn()} onClick={() => setOpenId(openId === d.id ? null : d.id)}>{openId === d.id ? 'Hide' : 'Details'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager total={data?.total ?? 0} offset={offset} onChange={setOffset} />
      </StateBlock>
      {openId && <DisputeDetailPanel id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

function DisputeDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useLoader<DisputeDetail>(() => getDispute(id), [id]);
  return (
    <div style={{ marginTop: '1rem', padding: '1rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: colors.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <strong>Dispute detail</strong><button style={btn()} onClick={onClose}>Close</button>
      </div>
      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <KV k="Doctor" v={data.doctor_name} />
            <KV k="Status" v={data.status} />
            <KV k="Reason" v={data.reason} />
            <KV k="Raised" v={fmtDate(data.created_at)} />
            <KV k="Last updated" v={fmtDate(data.updated_at)} />
            {Object.keys(data.detail).length > 0 && (
              <pre style={{ margin: '0.5rem 0', padding: '0.6rem', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '0.375rem', fontSize: '0.75rem', overflowX: 'auto' }}>
                {JSON.stringify(data.detail, null, 2)}
              </pre>
            )}
            {data.payout ? (
              <>
                <div style={{ marginTop: '0.6rem', fontWeight: 600, fontSize: '0.85rem' }}>Disputed payout</div>
                <KV k="Amount" v={formatKobo(data.payout.amount_kobo)} />
                <KV k="Status" v={data.payout.status} />
                <KV k="Requested" v={fmtDate(data.payout.requested_at)} />
                <KV k="Bank" v={bankText(data.payout)} />
              </>
            ) : <p style={{ color: colors.muted, fontSize: '0.82rem' }}>Not linked to a specific payout.</p>}
          </>
        )}
      </StateBlock>
    </div>
  );
}

function CommissionSection() {
  const { data, loading, error, reload } = useLoader<CommissionConfigView>(() => getCommissionConfig(), []);
  const overrides = data?.overrides ?? [];
  return (
    <Card title="Commission configuration" right={<button style={btn()} onClick={reload}>Reload</button>}>
      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              <Kpi label="Platform commission" value={bpsToPercent(data.platform_commission_bps)} sub="Fixed 85/15 settlement split" />
              <Kpi label="Doctor share" value={bpsToPercent(data.doctor_share_bps)} />
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.4rem' }}>Per-doctor stored configuration ({overrides.length})</div>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: colors.muted }}>
              These rows are what the doctor app displays on its earnings screen. Settlement itself uses the platform rate above.
            </p>
            {overrides.length === 0 ? <p style={{ color: colors.muted }}>No per-doctor configuration stored.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Doctor</th><th style={th()}>Commission</th><th style={th()}>VAT</th><th style={th()}>Payout cycle</th><th style={th()}>Updated</th></tr></thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.doctor_user_id}>
                      <td style={td()}>{o.doctor_name || <code>{o.doctor_user_id.slice(0, 8)}…</code>}</td>
                      <td style={td()}>{bpsToPercent(o.commission_bps)}</td>
                      <td style={td()}>{bpsToPercent(o.vat_bps)}</td>
                      <td style={td()}>{o.payout_cycle}</td>
                      <td style={td()}>{fmtDate(o.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </StateBlock>
    </Card>
  );
}
