'use client';

import { useEffect, useState } from 'react';
import { listReliability } from '@/services/staysAdminService';
import type { ReliabilityScore } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Badge,
  StateBlock,
  FilterBar,
  DisclosureNote,
  btn,
  th,
  td,
  label,
  select,
  pct,
} from '../_ui';

const GRADES = ['A', 'B', 'C', 'D'];

const GRADE_COLOR: Record<string, string> = {
  A: '#15803d',
  B: '#1d4ed8',
  C: '#9a3412',
  D: '#b91c1c',
};

export default function StaysReliabilityPage() {
  const [rows, setRows] = useState<ReliabilityScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReliability(grade ? { grade } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [grade]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Hotelier reliability scoring"
        subtitle="Supply-quality scorecard per property. Low-grade (C/D) hoteliers are surfaced for supply-quality action — coaching, demotion in ranking, or de-listing."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="trust" />

      <DisclosureNote>
        Reliability blends confirmation rate, cancellation rate, overbooking incidents, response
        time and guest reviews. Low grade (C/D) hoteliers are prioritised for supply-quality action.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Grade</label>
          <select style={select()} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">All grades</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reliability scores found.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>Property</th>
              <th style={th()}>Hotelier</th>
              <th style={{ ...th(), minWidth: 160 }}>Score</th>
              <th style={th()}>Grade</th>
              <th style={th()}>Confirm rate</th>
              <th style={th()}>Cancel rate</th>
              <th style={th()}>Overbook</th>
              <th style={th()}>Avg response</th>
              <th style={th()}>Reviews</th>
              <th style={th()}>Bookings 90d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lowGrade = r.grade === 'C' || r.grade === 'D';
              const color = GRADE_COLOR[r.grade] ?? '#6b7280';
              return (
                <tr key={r.hotelier_id} style={lowGrade ? { background: '#fff7ed' } : undefined}>
                  <td style={td()}>{r.property_name}</td>
                  <td style={td()}>{r.hotelier_masked}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', minWidth: 80 }}>
                        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, r.score))}%`, background: color, borderRadius: 4 }} />
                      </div>
                      <span style={{ fontWeight: 700, color, width: 28, textAlign: 'right' }}>{r.score}</span>
                    </div>
                  </td>
                  <td style={td()}><Badge status={r.grade} label={r.grade} /></td>
                  <td style={td()}>{pct(r.confirm_rate)}</td>
                  <td style={{ ...td(), color: r.cancel_rate >= 0.1 ? '#b91c1c' : '#374151', fontWeight: r.cancel_rate >= 0.1 ? 600 : 400 }}>{pct(r.cancel_rate)}</td>
                  <td style={{ ...td(), color: r.overbook_incidents > 0 ? '#b91c1c' : '#374151', fontWeight: r.overbook_incidents > 0 ? 600 : 400 }}>{r.overbook_incidents}</td>
                  <td style={td()}>{r.avg_response_minutes} min</td>
                  <td style={td()}><span style={{ color: '#d97706' }}>★</span> {r.reviews_avg.toFixed(1)}</td>
                  <td style={td()}>{r.bookings_90d.toLocaleString('en-NG')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StateBlock>
    </div>
  );
}
