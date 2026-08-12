'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { IntakeRecord } from '@/types/intakeAdmin';
import { getRecord, toLocal } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Badge, colors, tint, tdCell } from '@/components/ui/vuexy';

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: colors.success,
  DRAFT: colors.warning,
  NOT_STARTED: colors.secondary,
};

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>🔒</span>
      <span>{children}</span>
    </div>
  );
}

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
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake/monitoring" style={{ fontSize: 13, color: colors.primary }}>← Intake monitoring</Link>
      </div>
      <PageHeader title={`A9 · Intake Record — ${id}`} subtitle="Read-only view of a patient's pre-consultation intake. All values are patient-reported (decision-support only, not a diagnosis)." />
      <Notice>This access has been recorded in the Access &amp; Audit Log. Intake is visible only within the care relationship and for authorised support/clinical-admin review.</Notice>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}
      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : null}

      {record && !loading ? (
        <>
          <Card style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div><div style={{ color: colors.muted, fontSize: 11 }}>Patient</div>{record.patient}</div>
            <div><div style={{ color: colors.muted, fontSize: 11 }}>Assigned provider</div>{record.provider}</div>
            <div><div style={{ color: colors.muted, fontSize: 11 }}>Status</div><Badge text={record.intake_status.replace(/_/g, ' ').toLowerCase()} color={STATUS_COLORS[record.intake_status] ?? colors.secondary} /></div>
            <div><div style={{ color: colors.muted, fontSize: 11 }}>Submitted</div>{toLocal(record.submitted_at)}</div>
            <div><div style={{ color: colors.muted, fontSize: 11 }}>Consent</div>{record.consent_version ? `v${record.consent_version}` : '—'}</div>
            <div><div style={{ color: colors.muted, fontSize: 11 }}>Schema</div>v{record.schema_version}</div>
          </Card>

          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {record.sections.map((s) => (
              <Card key={s.key} style={s.highlight ? { borderColor: colors.warning, background: tint(colors.warning, 0.08) } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{s.label}</strong>
                  {s.highlight ? <span style={{ fontSize: 11, color: colors.warning }}>★ surfaced to doctor</span> : null}
                </div>
                <table style={{ width: '100%', marginTop: 8, fontSize: 13 }}>
                  <tbody>
                    {s.values.map((v, i) => (
                      <tr key={i}>
                        <td style={{ ...tdCell, width: 180, color: colors.muted }}>{v.label}</td>
                        <td style={tdCell}>{v.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </Page>
  );
}
