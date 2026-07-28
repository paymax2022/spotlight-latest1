'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { IntakeRecord } from '@/types/intakeAdmin';
import { getRecord, toLocal } from '@/services/intakeAdminService';
import { PageHeader, Notice, card, td, IntakeStatusBadge } from '../../_ui';

export default function RecordViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [record, setRecord] = useState<IntakeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        // Fetching the record server-side writes an access-log entry.
        setRecord(await getRecord(id));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake/monitoring" style={{ fontSize: 13, opacity: 0.8 }}>← Intake monitoring</Link>
      </div>
      <PageHeader title={`A9 · Intake Record — ${id}`} subtitle="Read-only view of a patient's pre-consultation intake. All values are patient-reported (decision-support only, not a diagnosis)." />
      <Notice kind="audit">This access has been recorded in the Access &amp; Audit Log. Intake is visible only within the care relationship and for authorised support/clinical-admin review.</Notice>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}
      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}

      {record && !loading ? (
        <>
          <div style={{ ...card, marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><div style={{ opacity: 0.5, fontSize: 11 }}>Patient</div>{record.patient}</div>
            <div><div style={{ opacity: 0.5, fontSize: 11 }}>Assigned provider</div>{record.provider}</div>
            <div><div style={{ opacity: 0.5, fontSize: 11 }}>Status</div><IntakeStatusBadge status={record.intake_status} /></div>
            <div><div style={{ opacity: 0.5, fontSize: 11 }}>Submitted</div>{toLocal(record.submitted_at)}</div>
            <div><div style={{ opacity: 0.5, fontSize: 11 }}>Consent</div>{record.consent_version ? `v${record.consent_version}` : '—'}</div>
            <div><div style={{ opacity: 0.5, fontSize: 11 }}>Schema</div>v{record.schema_version}</div>
          </div>

          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {record.sections.map((s) => (
              <div key={s.key} style={{ ...card, borderColor: s.highlight ? '#5c4a00' : '#2a2a2a', background: s.highlight ? '#1a1300' : '#111' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{s.label}</strong>
                  {s.highlight ? <span style={{ fontSize: 11, color: '#fde68a' }}>★ surfaced to doctor</span> : null}
                </div>
                <table style={{ width: '100%', marginTop: 8, fontSize: 13 }}>
                  <tbody>
                    {s.values.map((v, i) => (
                      <tr key={i}>
                        <td style={{ ...td, width: 180, opacity: 0.6 }}>{v.label}</td>
                        <td style={td}>{v.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
