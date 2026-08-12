'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { IntakeAnalytics } from '@/types/intakeAdmin';
import { getAnalytics } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, colors, tint } from '@/components/ui/vuexy';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>ℹ︎</span>
      <span>{children}</span>
    </div>
  );
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
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A12 · Completion Analytics" subtitle="How often patients finish the intake, where they drop off, and how long it takes. Aggregated, de-identified." />
      <Notice>All figures are aggregated across patients. See <Link href="/admin/intake/insights">Clinical Insights (A13)</Link> for top complaints and conditions.</Notice>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}
      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : null}

      {data && !loading ? (
        <>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginTop: 16 }}>
            <Kpi label="Completion rate" value={pct(data.completion_rate)} accent={colors.success} />
            <Kpi label="Avg time to complete" value={mmss(data.avg_time_to_complete_sec)} accent={colors.info} />
            <Kpi label="Red-flag trigger rate" value={pct(data.red_flag_trigger_rate)} accent={colors.info} />
          </div>

          <section style={{ marginTop: 24 }}>
            <p style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Per-step drop-off</p>
            <Card style={{ marginTop: 8, display: 'grid', gap: 10 }}>
              {data.per_step_dropoff.map((s) => {
                const rate = s.reached ? s.completed / s.reached : 0;
                return (
                  <div key={s.step}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span>{s.step}</span>
                      <span style={{ color: colors.muted }}>{s.completed}/{s.reached} ({pct(rate)})</span>
                    </div>
                    <div style={{ height: 10, background: colors.border, borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${rate * 100}%`, height: '100%', background: rate > 0.92 ? colors.success : rate > 0.85 ? colors.warning : colors.danger }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          </section>
        </>
      ) : null}
    </Page>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <Card style={{ borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </Card>
  );
}
