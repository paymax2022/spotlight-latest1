'use client';

import { useEffect, useState } from 'react';
import { listClinicians, formatNaira, type ClinicianRecord } from '@/services/telemedicineAdminService';
import { PageHeader, TelemedTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate } from '../_ui';

export default function CliniciansPage() {
  const [rows, setRows] = useState<ClinicianRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listClinicians({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Clinicians" subtitle="Clinician roster — MDCN credentials, ratings and consult fees." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <TelemedTabs active="clinicians" />
      <DisclosureNote>Read-only — clinician verification / suspension is not yet exposed on the backend admin surface.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Name, specialty or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No clinicians match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Clinician</th><th style={th()}>Specialty</th><th style={th()}>Status</th><th style={th()}>MDCN</th>
              <th style={th()}>Rating</th><th style={th()}>Consult fee</th><th style={th()}>Consultations</th><th style={th()}>Joined</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>{c.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.id}</div></td>
                  <td style={td()}>{c.specialty}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.mdcn_number}</code></td>
                  <td style={td()}>{c.reviews_count > 0 ? `${c.rating.toFixed(1)} (${c.reviews_count})` : '—'}</td>
                  <td style={td()}>{formatNaira(c.consult_fee_kobo)}</td>
                  <td style={td()}>{c.consultations_total.toLocaleString('en-NG')}</td>
                  <td style={td()}>{fmtDate(c.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
