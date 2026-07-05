'use client';

import { useEffect, useState } from 'react';
import type { IntakeAnalytics, LabelledCount } from '@/types/intakeAdmin';
import { getAnalytics } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card, th, td } from '../_ui';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
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
    <div>
      <BackLink />
      <PageHeader title="A13 · Clinical Insights" subtitle="The most common patient-reported complaints and conditions, and the overall red-flag trigger rate, to inform service planning." />
      <Notice kind="info">
        These insights are <strong>de-identified and aggregated</strong> — they describe population-level trends only and contain no individual patient data.
      </Notice>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}
      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}

      {data && !loading ? (
        <>
          <div style={{ ...card, marginTop: 16, borderLeft: '3px solid #22d3ee', maxWidth: 320 }}>
            <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Red-flag trigger rate</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{pct(data.red_flag_trigger_rate)}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>of submitted intakes triggered the triage gate</div>
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', marginTop: 20 }}>
            <RankTable title="Top complaints (patient-reported)" rows={data.top_complaints} />
            <RankTable title="Top chronic conditions" rows={data.top_conditions} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function RankTable({ title, rows }: { title: string; rows: LabelledCount[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div style={{ ...card }}>
      <strong style={{ fontSize: 13 }}>{title}</strong>
      <table style={{ width: '100%', marginTop: 10, fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
            <th style={th}>#</th><th style={th}>Label</th><th style={th}>Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} style={{ borderBottom: '1px solid #1c1c1c' }}>
              <td style={{ ...td, opacity: 0.5, width: 24 }}>{i + 1}</td>
              <td style={td}>{r.label}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 8, background: '#1f1f1f', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: '#60a5fa' }} />
                  </div>
                  <span>{r.count}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
