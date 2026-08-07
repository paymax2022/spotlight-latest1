'use client';

import { useEffect, useState } from 'react';
import { listConsultations, formatNaira, type ConsultationRecord } from '@/services/telemedicineAdminService';
import { PageHeader, TelemedTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function ConsultationsPage() {
  const [rows, setRows] = useState<ConsultationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listConsultations({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Consultations" subtitle="Consultation (appointment) oversight — patient identity is masked." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <TelemedTabs active="consultations" />
      <DisclosureNote>Read-only — backed by member appointment projections. No admin write surface exists on the backend yet.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Clinician, patient or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No consultations match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Consultation</th><th style={th()}>Patient</th><th style={th()}>Clinician</th><th style={th()}>Specialty</th>
              <th style={th()}>Status</th><th style={th()}>Fee</th><th style={th()}>Scheduled</th><th style={th()}>Rx</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
