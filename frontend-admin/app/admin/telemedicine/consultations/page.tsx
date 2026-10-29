'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listConsultations, getConsultation, cancelConsultation, reassignConsultation, formatNaira,
  type ConsultationRecord, type ConsultationDetail,
} from '@/services/telemedicineAdminService';
import { PageHeader, TelemedTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';
import { toCsv, downloadCsv, fetchAllPages } from '@/lib/csv';

const PAGE_SIZE = 25;
type Filters = { status: string; search: string; from: string; to: string };
const EMPTY: Filters = { status: '', search: '', from: '', to: '' };

export default function ConsultationsPage() {
  const [rows, setRows] = useState<ConsultationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useCallback((limit: number, off: number) => listConsultations({
    status: applied.status || undefined, search: applied.search || undefined,
    from: applied.from || undefined, to: applied.to || undefined, limit, offset: off,
  }), [applied]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const page = await query(PAGE_SIZE, offset); setRows(page.items); setTotal(page.total); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [query, offset]);
  useEffect(() => { load(); }, [load]);

  const apply = () => { setOffset(0); setApplied(draft); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await fetchAllPages((limit, off) => query(limit, off));
      downloadCsv(`telemedicine-consultations-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(all, [
        { header: 'id', value: (c) => c.id },
        { header: 'patient', value: (c) => c.patient_masked },
        { header: 'clinician', value: (c) => c.clinician_name },
        { header: 'specialty', value: (c) => c.specialty },
        { header: 'status', value: (c) => c.status },
        { header: 'fee_kobo', value: (c) => c.fee_kobo },
        { header: 'scheduled_at', value: (c) => c.scheduled_at },
        { header: 'prescription_issued', value: (c) => c.prescription_issued },
        { header: 'created_at', value: (c) => c.created_at },
      ]));
    } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); }
    finally { setExporting(false); }
  };

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Consultations" subtitle="Consultation (appointment) oversight — patient identity is masked."
        action={<div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={exportCsv} disabled={exporting} style={btn()}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
          <button onClick={load} style={btn()}>Refresh</button>
        </div>} />
      <TelemedTabs active="consultations" />
      <DisclosureNote>System-wide admin appointment list, filtered and paged on the server. Cancelling refunds the patient&apos;s escrow; reassigning moves the booking to another available doctor at the same time. Both are audited. Patient identity is shown masked (id only).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Id / ref prefix or clinician" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">All</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div><label style={label()}>Scheduled from</label><input style={input()} type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
        <div><label style={label()}>To (exclusive)</label><input style={input()} type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
        <button style={btn()} onClick={apply}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No consultations match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Consultation</th><th style={th()}>Patient</th><th style={th()}>Clinician</th><th style={th()}>Specialty</th>
              <th style={th()}>Status</th><th style={th()}>Fee</th><th style={th()}>Scheduled</th><th style={th()}>Rx</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.id}</code></td>
                  <td style={td()}>{c.patient_masked}</td>
                  <td style={td()}>{c.clinician_name}</td>
                  <td style={td()}>{c.specialty}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}>{formatNaira(c.fee_kobo)}</td>
                  <td style={td()}>{fmtDate(c.scheduled_at)}</td>
                  <td style={td()}>{c.prescription_issued ? <Badge status="paid" label="issued" /> : <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={td()}><button style={btn()} onClick={() => setOpenId(openId === c.id ? null : c.id)}>{openId === c.id ? 'Hide' : 'Details'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > PAGE_SIZE && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: colors.muted }}>
              <button style={btn()} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
              <button style={btn()} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          )}
        </StateBlock>
        {openId && <DetailPanel id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', padding: '0.2rem 0', fontSize: '0.85rem' }}>
      <span style={{ width: 160, color: colors.muted, flexShrink: 0 }}>{k}</span>
      <span style={{ wordBreak: 'break-word' }}>{v || '—'}</span>
    </div>
  );
}

function DetailPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<ConsultationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await getConsultation(id)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { setData(null); load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionErr(null);
    try { await fn(); await load(); onChanged(); }
    catch (e) { setActionErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const cancel = () => {
    if (!data) return;
    const reason = window.prompt(`Cancel and refund ${formatNaira(data.total_kobo)} to the patient? Enter a reason.`)?.trim();
    if (reason) run(() => cancelConsultation(id, reason));
  };
  const reassign = () => {
    const doctorId = window.prompt('New doctor id (doctors.id UUID, from the clinicians tab)')?.trim();
    if (!doctorId) return;
    const reason = window.prompt('Reason for reassigning')?.trim();
    if (reason) run(() => reassignConsultation(id, doctorId, reason));
  };
  const open = data && (data.status === 'booked' || data.status === 'confirmed');

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: colors.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <strong>Consultation detail</strong><button style={btn()} onClick={onClose}>Close</button>
      </div>
      <StateBlock loading={!data && !error} error={error} empty={false}>
        {data && (
          <>
            <KV k="Reference" v={data.ref} />
            <KV k="Status" v={data.status} />
            <KV k="Clinician" v={`${data.clinician_name} (${data.doctor_id})`} />
            <KV k="Patient" v={data.patient_masked} />
            <KV k="Type" v={data.consultation_type} />
            <KV k="Scheduled" v={fmtDate(data.scheduled_at)} />
            <KV k="Consult fee" v={formatNaira(data.fee_kobo)} />
            <KV k="Booking fee" v={formatNaira(data.platform_fee_kobo)} />
            <KV k="Patient paid" v={formatNaira(data.total_kobo)} />
            <KV k="Escrow" v={data.settlement_status} />
            <KV k="Reason given" v={data.notes} />
            {open && (
              <div style={{ display: 'flex', gap: '0.5rem', margin: '0.6rem 0' }}>
                <button style={btn()} disabled={busy} onClick={cancel}>Cancel &amp; refund</button>
                <button style={btn()} disabled={busy} onClick={reassign}>Reassign</button>
              </div>
            )}
            {actionErr && <p style={{ color: '#9a3412', fontSize: '0.82rem' }}>{actionErr}</p>}
            <div style={{ marginTop: '0.6rem', fontWeight: 600, fontSize: '0.85rem' }}>Admin actions ({data.audit.length})</div>
            {data.audit.length === 0 ? <p style={{ color: colors.muted, fontSize: '0.82rem' }}>None.</p> : data.audit.map((a, i) => (
              <div key={i} style={{ fontSize: '0.82rem', padding: '0.2rem 0' }}>
                {fmtDate(a.at)} · {a.action.replace('admin.telemedicine.appointment.', '')} · {String(a.detail?.reason ?? '')}
              </div>
            ))}
          </>
        )}
      </StateBlock>
    </div>
  );
}
