'use client';

import { useEffect, useState } from 'react';
import { getBiDashboard, getBiCohorts, exportBi } from '@/services/academyAdminService';
import type { BiDashboard, BiCohortRow, BiExportInput, BiSeriesPoint } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Kpi, StateBlock, DisclosureNote, Bar, btn, btnPrimary, th, td, input, label, formatNaira, pct } from '../_ui';

const COHORT_BUCKETS = ['D1', 'D7', 'D30', 'D60', 'D90'];
const RETENTION_COLOR = (v: number) => (v >= 0.6 ? '#15803d' : v >= 0.35 ? '#9a3412' : '#b91c1c');

function isoDay(daysAgo: number) { return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10); }

function downloadCsv(filename: string, csv: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SeriesCard({ title, points, kind, dataset, from, to, onExport, busy }: {
  title: string; points: BiSeriesPoint[]; kind: 'pct' | 'count' | 'naira';
  dataset: BiExportInput['dataset']; from: string; to: string;
  onExport: (d: BiExportInput['dataset']) => void; busy: boolean;
}) {
  const max = kind === 'pct' ? 1 : Math.max(...points.map((p) => p.value), 1);
  const fmt = (v: number) => kind === 'pct' ? pct(v) : kind === 'naira' ? formatNaira(v) : v.toLocaleString('en-NG');
  return (
    <Card title={title} right={<button onClick={() => onExport(dataset)} disabled={busy} style={btn()}>Export CSV</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {points.map((p) => (
          <Bar key={p.label} value={p.value} max={max} labelLeft={p.label} labelRight={fmt(p.value)} color={kind === 'pct' ? RETENTION_COLOR(p.value) : '#340075'} />
        ))}
      </div>
    </Card>
  );
}

export default function AnalyticsBiPage() {
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const [dash, setDash] = useState<BiDashboard | null>(null);
  const [cohorts, setCohorts] = useState<BiCohortRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [d, c] = await Promise.all([getBiDashboard({ from, to }), getBiCohorts({ from, to })]);
      setDash(d); setCohorts(c);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doExport(dataset: BiExportInput['dataset']) {
    setBusy(true); setNotice(null);
    try { const r = await exportBi({ dataset, from, to }); downloadCsv(r.filename, r.csv); setNotice(`Exported ${r.rows} rows → ${r.filename}.`); }
    catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Analytics & BI depth" subtitle="Outcome, engagement, retention, funnel, revenue and exam-readiness dashboards with cohort analysis and CSV export." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="analytics" />
      <DisclosureNote>Requires <code>academy.analyst</code> (or <code>academy.admin</code>). Aggregate, anonymised metrics over the selected window. Exports are CSV; warehouse feeds run server-side. Money in ₦ (kobo internally).</DisclosureNote>

      <Card title="Date range">
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={label()}>From</label><input type="date" style={input()} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label style={label()}>To</label><input type="date" style={input()} value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><button onClick={load} style={btnPrimary()}>Apply</button></div>
          {notice && <span style={{ fontSize: '0.8rem', color: '#374151' }}>{notice}</span>}
        </div>
      </Card>

      <StateBlock loading={loading} error={error} empty={!dash} emptyText="No analytics for this range.">
        {dash && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Active learners" value={dash.kpis.active_learners.toLocaleString('en-NG')} accent="#340075" />
              <Kpi label="New signups" value={dash.kpis.new_signups.toLocaleString('en-NG')} />
              <Kpi label="Pass rate" value={pct(dash.kpis.pass_rate)} accent={dash.kpis.pass_rate < 0.5 ? '#b91c1c' : '#15803d'} />
              <Kpi label="D30 retention" value={pct(dash.kpis.d30_retention)} accent={dash.kpis.d30_retention < 0.4 ? '#9a3412' : '#15803d'} />
              <Kpi label="Revenue" value={formatNaira(dash.kpis.revenue_kobo)} accent="#15803d" />
              <Kpi label="Avg readiness" value={pct(dash.kpis.avg_readiness)} accent={dash.kpis.avg_readiness < 0.5 ? '#b91c1c' : '#15803d'} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem' }}>
              <SeriesCard title="Outcome — pass rate by subject" points={dash.outcome} kind="pct" dataset="outcome" from={from} to={to} onExport={doExport} busy={busy} />
              <SeriesCard title="Engagement — active learners" points={dash.engagement} kind="count" dataset="engagement" from={from} to={to} onExport={doExport} busy={busy} />
              <SeriesCard title="Retention — by cohort age" points={dash.retention} kind="pct" dataset="retention" from={from} to={to} onExport={doExport} busy={busy} />
              <SeriesCard title="Funnel — signup → exam-ready" points={dash.funnel} kind="count" dataset="funnel" from={from} to={to} onExport={doExport} busy={busy} />
              <SeriesCard title="Revenue — by stream" points={dash.revenue} kind="naira" dataset="revenue" from={from} to={to} onExport={doExport} busy={busy} />
              <SeriesCard title="Exam — readiness by exam" points={dash.exam} kind="pct" dataset="exam" from={from} to={to} onExport={doExport} busy={busy} />
            </div>

            <Card title="Cohort analysis — retention" right={<button onClick={() => doExport('cohort')} disabled={busy} style={btn()}>Export CSV</button>}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Cohort</th><th style={th()}>Size</th>{COHORT_BUCKETS.map((b) => <th key={b} style={th()}>{b}</th>)}</tr></thead>
                <tbody>
                  {cohorts.map((c) => (
                    <tr key={c.cohort}>
                      <td style={td()}><strong>{c.cohort}</strong></td>
                      <td style={td()}>{c.size.toLocaleString('en-NG')}</td>
                      {c.retention.map((v, i) => (
                        <td key={i} style={td()}>
                          {v > 0
                            ? <span style={{ display: 'inline-block', minWidth: 46, textAlign: 'center', padding: '0.1rem 0.4rem', borderRadius: 4, color: '#fff', fontSize: '0.72rem', fontWeight: 600, background: RETENTION_COLOR(v) }}>{pct(v)}</span>
                            : <span style={{ color: '#d1d5db' }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
