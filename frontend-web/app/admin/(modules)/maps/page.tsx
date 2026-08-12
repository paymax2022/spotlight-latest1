'use client';

import { useEffect, useState } from 'react';
import { getDashboard, getEvents } from '@/services/mapServiceAdminService';
import type { MapDashboard, ResolutionEvent, CoverageTier } from '@/types/mapServiceAdmin';
import {
  PageHeader, MapsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, FilterBar,
  Bar, select, label, th, td, pct,
} from './_ui';

const DAY_OPTIONS = [1, 7, 30] as const;
const SOURCE_ORDER = ['gazetteer', 'cache', 'prediction', 'osm', 'google', 'here'] as const;
const TIERS: CoverageTier[] = ['GOOD', 'FAIR', 'LOW'];
// Paid sources are the only ones that cost money; everything else is "deflected".
const PAID_SOURCES = new Set(['google', 'here']);

export default function MapsDashboardPage() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<MapDashboard | null>(null);
  const [events, setEvents] = useState<ResolutionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(d: number) {
    setLoading(true); setError(null);
    try {
      const [dash, evs] = await Promise.all([getDashboard(d), getEvents(100)]);
      setData(dash);
      setEvents(evs);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(days); }, [days]);

  const def = data?.deflection;
  const totalSources = def ? SOURCE_ORDER.reduce((s, k) => s + (def.by_source[k] ?? 0), 0) : 0;
  const totalResolutions = def ? def.paid + def.deflected : 0;
  // NEEDS_PIN: prefer by_source['needs_pin']; otherwise derive from events with outcome_pin.
  const needsPin = def?.by_source?.needs_pin ?? events.filter((e) => e.outcome_pin).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="MapService — Cost & Coverage"
        subtitle="Cost-aware, coverage-aware geocoding. Requests are resolved from a private Nigeria gazetteer, cache and prediction first, escalating to paid providers (Google / HERE) only by coverage tier and confidence. Paid-call deflection is the key metric: every deflected call is money saved."
        action={<button onClick={() => load(days)} style={select()}>Refresh</button>}
      />
      <MapsTabs active="dashboard" />

      <DisclosureNote>
        Resolution escalates by coverage tier (GOOD → FAIR → LOW) and confidence. Confirmed pins feed back into
        the system; only <strong>non-PII</strong> improvements are ever queued for OpenStreetMap (under human review on the
        Contributions tab) — PII stays in the private gazetteer.
      </DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 160 }}>
          <label style={label()} htmlFor="days">Lookback window</label>
          <select id="days" style={select()} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>Last {d} day{d > 1 ? 's' : ''}</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && def && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total resolutions" value={totalResolutions.toLocaleString()} sub={`Last ${days} day${days > 1 ? 's' : ''}`} />
              <Kpi label="Deflection rate" value={pct(data.deflection_rate)} sub="Calls kept off paid providers" accent="#15803d" />
              <Kpi label="Paid calls" value={def.paid.toLocaleString()} sub="Google + HERE (billable)" accent="#b91c1c" />
              <Kpi label="Needs pin" value={needsPin.toLocaleString()} sub="Could not resolve — user pin required" accent="#9a3412" />
            </div>

            <Card title="Deflection by source">
              <p style={{ color: '#6b7280', fontSize: '0.78rem', margin: '0 0 0.75rem' }}>
                Share of resolutions handled by each source. The first four are free deflections; Google / HERE are paid.
              </p>
              {totalSources === 0 ? (
                <p style={{ color: '#6b7280' }}>No resolution data in this window.</p>
              ) : (
                SOURCE_ORDER.map((src) => (
                  <Bar
                    key={src}
                    label={src}
                    value={def.by_source[src] ?? 0}
                    total={totalSources}
                    color={PAID_SOURCES.has(src) ? '#b91c1c' : '#340075'}
                  />
                ))
              )}
            </Card>

            <Card title="By coverage tier">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Tier</th>
                  <th style={th()}>Deflected</th>
                  <th style={th()}>Paid</th>
                  <th style={th()}>Deflection rate</th>
                </tr></thead>
                <tbody>
                  {TIERS.map((t) => {
                    const row = def.by_coverage_tier[t] ?? { paid: 0, deflected: 0 };
                    const tot = row.paid + row.deflected;
                    return (
                      <tr key={t}>
                        <td style={td()}><Badge status={t.toLowerCase()} label={t} /></td>
                        <td style={td()}>{row.deflected.toLocaleString()}</td>
                        <td style={td()}>{row.paid.toLocaleString()}</td>
                        <td style={td()}>{tot > 0 ? pct(row.deflected / tot) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <Card title="Provider health">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Provider</th>
                  <th style={th()}>Up</th>
                  <th style={th()}>Circuit</th>
                  <th style={th()}>Error rate</th>
                  <th style={th()}>p95 latency</th>
                  <th style={th()}>Budget used</th>
                </tr></thead>
                <tbody>
                  {data.providers.length === 0 ? (
                    <tr><td style={td()} colSpan={6}>No providers reporting.</td></tr>
                  ) : data.providers.map((p) => {
                    const budgetRatio = p.budget_cap > 0 ? p.budget_used / p.budget_cap : 0;
                    return (
                      <tr key={p.name}>
                        <td style={td()}><strong style={{ textTransform: 'capitalize' }}>{p.name}</strong></td>
                        <td style={td()}><Badge status={p.up ? 'up' : 'down'} label={p.up ? 'Up' : 'Down'} /></td>
                        <td style={td()}><Badge status={p.circuit_state} /></td>
                        <td style={td()}>{pct(p.error_rate)}</td>
                        <td style={td()}>{p.p95_latency_ms} ms</td>
                        <td style={td()}>
                          {p.budget_used.toLocaleString()} / {p.budget_cap.toLocaleString()}
                          {p.budget_cap > 0 ? <span style={{ color: budgetRatio >= 0.9 ? '#b91c1c' : '#6b7280', marginLeft: 6 }}>({pct(budgetRatio)})</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
