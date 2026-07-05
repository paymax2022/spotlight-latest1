'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { IntakeAnalytics } from '@/types/intakeAdmin';
import { getAnalytics } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card } from '../_ui';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export default function AnalyticsPage() {
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
      <PageHeader title="A12 · Completion Analytics" subtitle="How often patients finish the intake, where they drop off, and how long it takes. Aggregated, de-identified." />
      <Notice kind="info">All figures are aggregated across patients. See <Link href="/admin/intake/insights">Clinical Insights (A13)</Link> for top complaints and conditions.</Notice>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}
      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}

      {data && !loading ? (
        <>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginTop: 16 }}>
            <Kpi label="Completion rate" value={pct(data.completion_rate)} accent="#22c55e" />
            <Kpi label="Avg time to complete" value={mmss(data.avg_time_to_complete_sec)} accent="#60a5fa" />
            <Kpi label="Red-flag trigger rate" value={pct(data.red_flag_trigger_rate)} accent="#22d3ee" />
          </div>

          <section style={{ marginTop: 24 }}>
            <p style={{ fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Per-step drop-off</p>
            <div style={{ ...card, marginTop: 8, display: 'grid', gap: 10 }}>
              {data.per_step_dropoff.map((s) => {
                const rate = s.reached ? s.completed / s.reached : 0;
                return (
                  <div key={s.step}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span>{s.step}</span>
                      <span style={{ opacity: 0.7 }}>{s.completed}/{s.reached} ({pct(rate)})</span>
                    </div>
                    <div style={{ height: 10, background: '#1f1f1f', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${rate * 100}%`, height: '100%', background: rate > 0.92 ? '#16a34a' : rate > 0.85 ? '#ca8a04' : '#b91c1c' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...card, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
