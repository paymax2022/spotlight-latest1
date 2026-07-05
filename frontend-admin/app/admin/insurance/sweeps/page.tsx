'use client';

import { useEffect, useState } from 'react';
import { getSweeps } from '@/services/insuranceAdminService';
import type { SweepsMonitor } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Kpi, Badge, btn, th, td, StateBlock, timeAgo } from '../_ui';

export default function SweepsPage() {
  const [data, setData] = useState<SweepsMonitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSweeps()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Lapse & renewal sweeps"
        subtitle="Scheduled jobs that flag policies entering renewal windows and process grace-expired lapses."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="ops" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No sweep data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Renewals due (7d)" value={data.renewals_due_7d.toLocaleString('en-NG')} />
              <Kpi label="Renewals due (30d)" value={data.renewals_due_30d.toLocaleString('en-NG')} />
              <Kpi label="Lapses pending" value={data.lapses_pending.toLocaleString('en-NG')} accent={data.lapses_pending > 0 ? '#9a3412' : undefined} />
              <Kpi label="Next run" value={timeAgo(data.next_run_at)} accent="#340075" />
            </div>

            <Card title="Recent runs">
              {data.recent_runs.length === 0 ? <p style={{ color: '#6b7280' }}>No recent runs.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th()}>Kind</th>
                        <th style={th()}>Status</th>
                        <th style={th()}>Scanned</th>
                        <th style={th()}>Affected</th>
                        <th style={th()}>Notified</th>
                        <th style={th()}>Errors</th>
                        <th style={th()}>Window</th>
                        <th style={th()}>Ran</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_runs.map((r) => (
                        <tr key={r.id}>
                          <td style={td()}><Badge status={r.kind === 'renewal' ? 'binding' : 'lapsed'} label={r.kind} /></td>
                          <td style={td()}><Badge status={r.status === 'completed' ? 'active' : r.status === 'running' ? 'pending' : 'failed'} label={r.status} /></td>
                          <td style={td()}>{r.scanned.toLocaleString('en-NG')}</td>
                          <td style={td()}>{r.affected.toLocaleString('en-NG')}</td>
                          <td style={td()}>{r.notified.toLocaleString('en-NG')}</td>
                          <td style={{ ...td(), color: r.errors > 0 ? '#b91c1c' : '#374151', fontWeight: r.errors > 0 ? 700 : 400 }}>{r.errors}</td>
                          <td style={td()}>{r.window}</td>
                          <td style={td()}>{timeAgo(r.ran_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
