'use client';

import { useEffect, useState } from 'react';
import { listAppointments, getAppointment, formatNaira } from '@/services/healthVetAdminService';
import type { VetAppointment, VetAppointmentDetail } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, select, label, fmtDate } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['', 'requested', 'accepted', 'confirmed', 'in_progress', 'completed', 'rescheduled', 'cancelled', 'no_show'];
const MODES = ['', 'tele', 'home', 'clinic'];

export default function VetAppointmentsPage() {
  const [rows, setRows] = useState<VetAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [emergency, setEmergency] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<VetAppointmentDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAppointments({ status: status || undefined, mode: mode || undefined, emergency: emergency || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, mode, emergency]);

  async function openDetail(id: string) {
    setDetailBusy(true); setDetail(null);
    try { setDetail(await getAppointment(id)); }
    catch (e) { setError(String(e)); }
    finally { setDetailBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Appointment oversight" subtitle="Oversee the appointment lifecycle (requested → completed) across tele / home / clinic modes, with held→released→refunded payment state (HL-9) and emergency (SOS) routing flagged (HL-11). Fees in ₦." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="appointments" />

      <DisclosureNote>
        Appointment state machine: REQUESTED→ACCEPTED→CONFIRMED→IN_PROGRESS→COMPLETED; any→CANCELLED|NO_SHOW;
        CONFIRMED→RESCHEDULED→CONFIRMED. Payment is held in escrow on request and released on consult
        completion, refunded on cancellation (HL-9). Emergencies are routed to in-person care — tele-consult is
        not a substitute for emergency care (HL-11). Owner data is NDPA-masked (HL-8).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Mode</label>
          <select style={select()} value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m} value={m}>{m ? m : 'All modes'}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Emergency</label>
          <select style={select()} value={emergency} onChange={(e) => setEmergency(e.target.value)}>
            <option value="">All</option>
            <option value="yes">SOS / emergency only</option>
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Pet, owner, vet, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No appointments match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Pet / owner</th><th style={th()}>Vet</th><th style={th()}>Mode</th>
              <th style={th()}>Service</th><th style={th()}>Fee</th><th style={th()}>Payment</th>
              <th style={th()}>Scheduled</th><th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.pet_name}</strong> <span style={{ color: colors.muted, fontSize: '0.72rem' }}>({r.pet_species})</span><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.owner_masked} · {r.id}</div></td>
                  <td style={td()}>{r.vet_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.clinic_masked}</div></td>
                  <td style={td()}><Badge status={r.mode} />{r.is_emergency ? <div style={{ marginTop: 3 }}><Badge status="emergency" label="SOS" /></div> : null}</td>
                  <td style={td()}>{r.service_summary}</td>
                  <td style={td()}>{formatNaira(r.fee_kobo)}</td>
                  <td style={td()}><Badge status={r.payment_state} /></td>
                  <td style={td()}>{fmtDate(r.scheduled_at)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}><button style={btn()} onClick={() => openDetail(r.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {(detailBusy || detail) && (
        <Card title={detail ? `Appointment ${detail.id} — ${detail.pet_name}` : 'Loading…'} right={detail ? <button style={btn()} onClick={() => setDetail(null)}>Close</button> : null}>
          {detailBusy && <p style={{ color: colors.muted }}>Loading…</p>}
          {detail && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div><span style={{ color: colors.muted }}>Owner:</span> {detail.owner_masked}</div>
                <div><span style={{ color: colors.muted }}>Vet:</span> {detail.vet_masked}</div>
                <div><span style={{ color: colors.muted }}>Mode:</span> <Badge status={detail.mode} /></div>
                <div><span style={{ color: colors.muted }}>Payment:</span> <Badge status={detail.payment_state} /> {formatNaira(detail.fee_kobo)}</div>
                <div><span style={{ color: colors.muted }}>SOAP note:</span> {detail.consult_note_present ? 'present' : '—'}</div>
                <div><span style={{ color: colors.muted }}>e-Rx:</span> {detail.eprescription_ref ? <code>{detail.eprescription_ref}</code> : '—'}</div>
                <div><span style={{ color: colors.muted }}>Lab order:</span> {detail.lab_order_ref ? <code>{detail.lab_order_ref}</code> : '—'}</div>
                <div><span style={{ color: colors.muted }}>NDPA consent:</span> <Badge status={detail.consent_on_file ? 'verified' : 'pending'} label={detail.consent_on_file ? 'on file' : 'missing'} /></div>
              </div>
              {detail.triage_summary && (
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem', background: colors.headBg }}>
                  <strong>Triage intake:</strong> {detail.triage_summary}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Step</th><th style={th()}>Detail</th><th style={th()}>Actor</th><th style={th()}>Audit</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {detail.timeline.map((t, i) => (
                    <tr key={i}>
                      <td style={td()}><Badge status={t.step.toLowerCase()} label={t.step.replace(/_/g, ' ')} /></td>
                      <td style={td()}>{t.label}</td>
                      <td style={td()}>{t.actor_masked}</td>
                      <td style={td()}><code style={{ fontSize: '0.72rem' }}>{t.audit_id}</code></td>
                      <td style={td()}>{fmtDate(t.at)}</td>
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
