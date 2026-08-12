'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AccessLogRow, AccessLogEventType } from '@/types/intakeAdmin';
import { listAccessLog, toLocal } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const EVENT_LABELS: Record<AccessLogEventType, { label: string; color: string }> = {
  RECORD_VIEW: { label: 'Record view', color: colors.info },
  CONSENT_ACCEPTED: { label: 'Consent accepted', color: colors.success },
  RED_FLAG_TRIGGERED: { label: 'Red-flag triggered', color: colors.danger },
  SCHEMA_PUBLISHED: { label: 'Schema published', color: colors.secondary },
  RULE_TOGGLED: { label: 'Rule toggled', color: colors.secondary },
};

const FILTERS: ('' | AccessLogEventType)[] = ['', 'RECORD_VIEW', 'CONSENT_ACCEPTED', 'RED_FLAG_TRIGGERED', 'SCHEMA_PUBLISHED', 'RULE_TOGGLED'];

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>🔒</span>
      <span>{children}</span>
    </div>
  );
}

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
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A10 · Access & Audit Log" subtitle="Who accessed which intake and when, plus consent and red-flag events. This is the audit trail for sensitive health-data access." />
      <Notice>This log is append-only. Record-view entries are written automatically whenever an intake record is opened in the viewer (A9).</Notice>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <select className="vx-input" value={filter} onChange={(e) => setFilter(e.target.value as '' | AccessLogEventType)}>
          {FILTERS.map((f) => <option key={f} value={f}>{f ? EVENT_LABELS[f].label : 'All events'}</option>)}
        </select>
        <span style={{ fontSize: 12, color: colors.muted }}>{filtered.length} event(s)</span>
      </div>

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['When', 'Event', 'Actor', 'Appointment', 'Intake', 'Detail'].map((h) => <th key={h} style={thCell}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const ev = EVENT_LABELS[r.event_type];
                return (
                  <tr key={r.id}>
                    <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>{toLocal(r.created_at)}</td>
                    <td style={tdCell}><Badge text={ev.label} color={ev.color} /></td>
                    <td style={tdCell}>{r.actor}</td>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.appointment_id ?? '—'}</td>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.intake_id ?? '—'}</td>
                    <td style={{ ...tdCell, color: colors.muted, fontSize: 12 }}>{r.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
