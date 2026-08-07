'use client';

import { useEffect, useState } from 'react';
import { listReliability } from '@/services/staysAdminService';
import type { ReliabilityScore } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  StateBlock,
  FilterBar,
  DisclosureNote,
  label,
  select,
  pct,
} from '../_ui';
import { Page, PageHeader, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const GRADES = ['A', 'B', 'C', 'D'];

const GRADE_COLOR: Record<string, string> = {
  A: colors.success,
  B: colors.info,
  C: colors.warning,
  D: colors.danger,
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
    <Page>
      <PageHeader
        title="Hotelier reliability scoring"
        subtitle="Supply-quality scorecard per property. Low-grade (C/D) hoteliers are surfaced for supply-quality action — coaching, demotion in ranking, or de-listing."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
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
              <th style={thCell}>Property</th>
              <th style={thCell}>Hotelier</th>
              <th style={{ ...thCell, minWidth: 160 }}>Score</th>
              <th style={thCell}>Grade</th>
              <th style={thCell}>Confirm rate</th>
              <th style={thCell}>Cancel rate</th>
              <th style={thCell}>Overbook</th>
              <th style={thCell}>Avg response</th>
              <th style={thCell}>Reviews</th>
              <th style={thCell}>Bookings 90d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lowGrade = r.grade === 'C' || r.grade === 'D';
              const color = GRADE_COLOR[r.grade] ?? colors.muted;
              return (
                <tr key={r.hotelier_id} style={lowGrade ? { background: tint(colors.warning, 0.08) } : undefined}>
                  <td style={tdCell}>{r.property_name}</td>
                  <td style={tdCell}>{r.hotelier_masked}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: 8, background: tint(colors.muted, 0.12), borderRadius: 4, overflow: 'hidden', minWidth: 80 }}>
                        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, r.score))}%`, background: color, borderRadius: 4 }} />
                      </div>
                      <span style={{ fontWeight: 700, color, width: 28, textAlign: 'right' }}>{r.score}</span>
                    </div>
                  </td>
                  <td style={tdCell}><Badge status={r.grade} label={r.grade} /></td>
                  <td style={tdCell}>{pct(r.confirm_rate)}</td>
                  <td style={{ ...tdCell, color: r.cancel_rate >= 0.1 ? colors.danger : colors.text, fontWeight: r.cancel_rate >= 0.1 ? 600 : 400 }}>{pct(r.cancel_rate)}</td>
                  <td style={{ ...tdCell, color: r.overbook_incidents > 0 ? colors.danger : colors.text, fontWeight: r.overbook_incidents > 0 ? 600 : 400 }}>{r.overbook_incidents}</td>
                  <td style={tdCell}>{r.avg_response_minutes} min</td>
                  <td style={tdCell}><span style={{ color: colors.warning }}>★</span> {r.reviews_avg.toFixed(1)}</td>
                  <td style={tdCell}>{r.bookings_90d.toLocaleString('en-NG')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StateBlock>
    </Page>
  );
}
