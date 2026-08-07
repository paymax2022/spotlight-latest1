'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MonitoringRow, IntakeStatus } from '@/types/intakeAdmin';
import { listMonitoring, toLocal } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_OPTIONS: ('' | IntakeStatus)[] = ['', 'NOT_STARTED', 'DRAFT', 'SUBMITTED'];

const STATUS_COLORS: Record<IntakeStatus, string> = {
  SUBMITTED: colors.success,
  DRAFT: colors.warning,
  NOT_STARTED: colors.secondary,
};

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>ℹ︎</span>
      <span>{children}</span>
    </div>
  );
}

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
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A8 · Intake Monitoring" subtitle="Upcoming appointments with their intake status. Rows highlighted in amber are incomplete close to the appointment time and may need a nudge." />
      <Notice>A consult cannot start until intake is <strong>Submitted</strong>. Incomplete-near-appointment rows are flagged so support can follow up.</Notice>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <select className="vx-input" value={status} onChange={(e) => setStatus(e.target.value as '' | IntakeStatus)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <label style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyNear} onChange={(e) => setOnlyNear(e.target.checked)} /> Incomplete near appointment only
        </label>
        <span style={{ fontSize: 12, color: colors.muted }}>{filtered.length} appointment(s)</span>
      </div>

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Appointment', 'Patient', 'Provider', 'Intake status', 'Appointment at', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.appointment_id} style={{ background: r.incomplete_near_appt ? tint(colors.warning, 0.12) : undefined }}>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.appointment_id}</td>
                  <td style={tdCell}>{r.patient}</td>
                  <td style={tdCell}>{r.provider}</td>
                  <td style={tdCell}>
                    <Badge text={r.intake_status.replace(/_/g, ' ').toLowerCase()} color={STATUS_COLORS[r.intake_status] ?? colors.secondary} />
                    {r.incomplete_near_appt ? <span style={{ marginLeft: 8, color: colors.warning, fontSize: 11 }}>● needs attention</span> : null}
                  </td>
                  <td style={{ ...tdCell, color: colors.muted }}>{toLocal(r.appointment_at)}</td>
                  <td style={tdCell}><Link href={`/admin/intake/records/${r.appointment_id}`} style={{ color: colors.primary }}>View record →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
