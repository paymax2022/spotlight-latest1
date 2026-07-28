'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCalendar, formatNaira } from '@/services/staysExtranetService';
import type { CalendarData } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, StateBlock, FilterBar, btn, btnPrimary, input, label } from '../_ui';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(m: string) {
    setLoading(true); setError(null);
    try { setData(await getCalendar(m)); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(month); }, [month]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Calendar — availability & rates" subtitle="Month grid of available rooms and the nightly rate per room type. Red cells are stop-sell. Use bulk edit for date ranges." action={<Link href="/extranet/bulk-edit" style={{ ...btnPrimary(), textDecoration: 'none' }}>Bulk edit</Link>} />
      <ExtranetTabs active="inventory" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <FilterBar>
        <div><label style={label()}>Month</label><input style={input()} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <button onClick={() => load(month)} style={btn()}>Refresh</button>
      </FilterBar>

      <Card title={`${month}${data ? ` · ${data.currency} (₦)` : ''}`}>
        <StateBlock loading={loading} error={error} empty={!data || data.rows.length === 0} emptyText="No calendar data for this month.">
          {data && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: '#fff', padding: '0.4rem 0.6rem', textAlign: 'left', minWidth: 140, borderBottom: '1px solid #e5e7eb' }}>Room type</th>
                    {data.rows[0]?.cells.map((c) => (
                      <th key={c.date} style={{ padding: '0.3rem 0.25rem', textAlign: 'center', color: '#6b7280', borderBottom: '1px solid #e5e7eb', minWidth: 52 }}>{c.date.slice(8)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.room_type_id}>
                      <td style={{ position: 'sticky', left: 0, background: '#fff', padding: '0.4rem 0.6rem', fontWeight: 600, borderTop: '1px solid #f3f4f6' }}>{row.room_type_name}</td>
                      {row.cells.map((c) => (
                        <td key={c.date} title={`${c.date} · ${formatNaira(c.rate_kobo)} · ${c.available} left${c.stop_sell ? ' · STOP SELL' : ''}`} style={{ padding: '0.3rem 0.2rem', textAlign: 'center', borderTop: '1px solid #f3f4f6', background: c.stop_sell ? '#fee2e2' : c.available === 0 ? '#fef3c7' : '#fff' }}>
                          <div style={{ fontWeight: 700, color: c.stop_sell ? '#b91c1c' : '#111827' }}>{c.available}</div>
                          <div style={{ color: '#6b7280' }}>{Math.round(c.rate_kobo / 100000)}k</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem' }}>Top number = rooms available; bottom = nightly rate (₦ thousands). Amber = sold out, red = stop-sell. Hover a cell for full detail.</p>
            </div>
          )}
        </StateBlock>
      </Card>
    </div>
  );
}
