'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MonitoringRow, IntakeStatus } from '@/types/intakeAdmin';
import { listMonitoring, toLocal } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, th, td, input, IntakeStatusBadge } from '../_ui';

const STATUS_OPTIONS: ('' | IntakeStatus)[] = ['', 'NOT_STARTED', 'DRAFT', 'SUBMITTED'];

export default function MonitoringPage() {
  const [rows, setRows] = useState<MonitoringRow[]>([]);
  const [status, setStatus] = useState<'' | IntakeStatus>('');
  const [onlyNear, setOnlyNear] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listMonitoring());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = rows.filter((r) => (!status || r.intake_status === status) && (!onlyNear || r.incomplete_near_appt));

  return (
    <div>
      <BackLink />
      <PageHeader title="A8 · Intake Monitoring" subtitle="Upcoming appointments with their intake status. Rows highlighted in amber are incomplete close to the appointment time and may need a nudge." />
      <Notice kind="info">A consult cannot start until intake is <strong>Submitted</strong>. Incomplete-near-appointment rows are flagged so support can follow up.</Notice>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <select style={input} value={status} onChange={(e) => setStatus(e.target.value as '' | IntakeStatus)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <label style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyNear} onChange={(e) => setOnlyNear(e.target.checked)} /> Incomplete near appointment only
        </label>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{filtered.length} appointment(s)</span>
      </div>

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Appointment', 'Patient', 'Provider', 'Intake status', 'Appointment at', ''].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.appointment_id} style={{ borderBottom: '1px solid #1c1c1c', background: r.incomplete_near_appt ? 'rgba(120,53,15,0.25)' : undefined }}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.appointment_id}</td>
                <td style={td}>{r.patient}</td>
                <td style={td}>{r.provider}</td>
                <td style={td}>
                  <IntakeStatusBadge status={r.intake_status} />
                  {r.incomplete_near_appt ? <span style={{ marginLeft: 8, color: '#fbbf24', fontSize: 11 }}>● needs attention</span> : null}
                </td>
                <td style={{ ...td, opacity: 0.8 }}>{toLocal(r.appointment_at)}</td>
                <td style={td}><Link href={`/admin/intake/records/${r.appointment_id}`}>View record →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
