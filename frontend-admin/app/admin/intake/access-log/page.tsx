'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AccessLogRow, AccessLogEventType } from '@/types/intakeAdmin';
import { listAccessLog, toLocal } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, th, td, input } from '../_ui';

const EVENT_LABELS: Record<AccessLogEventType, { label: string; bg: string; fg: string }> = {
  RECORD_VIEW: { label: 'Record view', bg: '#1e3a8a', fg: '#bfdbfe' },
  CONSENT_ACCEPTED: { label: 'Consent accepted', bg: '#064e3b', fg: '#a7f3d0' },
  RED_FLAG_TRIGGERED: { label: 'Red-flag triggered', bg: '#13343b', fg: '#a5f3fc' },
  SCHEMA_PUBLISHED: { label: 'Schema published', bg: '#374151', fg: '#d1d5db' },
  RULE_TOGGLED: { label: 'Rule toggled', bg: '#374151', fg: '#d1d5db' },
};

const FILTERS: ('' | AccessLogEventType)[] = ['', 'RECORD_VIEW', 'CONSENT_ACCEPTED', 'RED_FLAG_TRIGGERED', 'SCHEMA_PUBLISHED', 'RULE_TOGGLED'];

export default function AccessLogPage() {
  const [rows, setRows] = useState<AccessLogRow[]>([]);
  const [filter, setFilter] = useState<'' | AccessLogEventType>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listAccessLog());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = rows.filter((r) => !filter || r.event_type === filter);

  return (
    <div>
      <BackLink />
      <PageHeader title="A10 · Access & Audit Log" subtitle="Who accessed which intake and when, plus consent and red-flag events. This is the audit trail for sensitive health-data access." />
      <Notice kind="audit">This log is append-only. Record-view entries are written automatically whenever an intake record is opened in the viewer (A9).</Notice>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <select style={input} value={filter} onChange={(e) => setFilter(e.target.value as '' | AccessLogEventType)}>
          {FILTERS.map((f) => <option key={f} value={f}>{f ? EVENT_LABELS[f].label : 'All events'}</option>)}
        </select>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{filtered.length} event(s)</span>
      </div>

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['When', 'Event', 'Actor', 'Appointment', 'Intake', 'Detail'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const ev = EVENT_LABELS[r.event_type];
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <td style={{ ...td, opacity: 0.8, whiteSpace: 'nowrap' }}>{toLocal(r.created_at)}</td>
                  <td style={td}><span style={{ background: ev.bg, color: ev.fg, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{ev.label}</span></td>
                  <td style={td}>{r.actor}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.appointment_id ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.intake_id ?? '—'}</td>
                  <td style={{ ...td, opacity: 0.8, fontSize: 12 }}>{r.detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
