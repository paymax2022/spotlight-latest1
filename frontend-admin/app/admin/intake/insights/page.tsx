'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { IntakeAnalytics, LabelledCount } from '@/types/intakeAdmin';
import { getAnalytics } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>ℹ︎</span>
      <span>{children}</span>
    </div>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<IntakeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        setData(await getAnalytics());
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A13 · Clinical Insights" subtitle="The most common patient-reported complaints and conditions, and the overall red-flag trigger rate, to inform service planning." />
      <Notice>
        These insights are <strong>de-identified and aggregated</strong> — they describe population-level trends only and contain no individual patient data.
      </Notice>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}
      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : null}

      {data && !loading ? (
        <>
          <Card style={{ marginTop: 16, borderLeft: `3px solid ${colors.info}`, maxWidth: 320 }}>
            <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Red-flag trigger rate</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{pct(data.red_flag_trigger_rate)}</div>
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>of submitted intakes triggered the triage gate</div>
          </Card>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', marginTop: 20 }}>
            <RankTable title="Top complaints (patient-reported)" rows={data.top_complaints} />
            <RankTable title="Top chronic conditions" rows={data.top_conditions} />
          </div>
        </>
      ) : null}
    </Page>
  );
}

function RankTable({ title, rows }: { title: string; rows: LabelledCount[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <Card>
      <strong style={{ fontSize: 13 }}>{title}</strong>
      <table style={{ width: '100%', marginTop: 10, fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thCell}>#</th><th style={thCell}>Label</th><th style={thCell}>Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label}>
              <td style={{ ...tdCell, color: colors.muted, width: 24 }}>{i + 1}</td>
              <td style={tdCell}>{r.label}</td>
              <td style={tdCell}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 8, background: colors.border, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: colors.info }} />
                  </div>
                  <span>{r.count}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
