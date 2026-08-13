'use client';

import { useEffect, useState } from 'react';
import { getSweeps } from '@/services/insuranceAdminService';
import type { SweepsMonitor } from '@/types/insuranceAdmin';
import { InsuranceTabs, Kpi, StateBlock, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function runStatusColor(status: string): string {
  if (status === 'completed') return colors.success;
  if (status === 'running') return colors.warning;
  return colors.danger;
}

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
    <Page>
      <PageHeader
        title="Lapse & renewal sweeps"
        subtitle="Scheduled jobs that flag policies entering renewal windows and process grace-expired lapses."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="ops" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No sweep data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Kpi label="Renewals due (7d)" value={data.renewals_due_7d.toLocaleString('en-NG')} />
              <Kpi label="Renewals due (30d)" value={data.renewals_due_30d.toLocaleString('en-NG')} />
              <Kpi label="Lapses pending" value={data.lapses_pending.toLocaleString('en-NG')} accent={data.lapses_pending > 0 ? colors.warning : undefined} />
              <Kpi label="Next run" value={timeAgo(data.next_run_at)} accent={colors.primary} />
            </div>

            <Card title="Recent runs">
              {data.recent_runs.length === 0 ? <p style={{ color: colors.muted }}>No recent runs.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thCell}>Kind</th>
                        <th style={thCell}>Status</th>
                        <th style={thCell}>Scanned</th>
                        <th style={thCell}>Affected</th>
                        <th style={thCell}>Notified</th>
                        <th style={thCell}>Errors</th>
                        <th style={thCell}>Window</th>
                        <th style={thCell}>Ran</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_runs.map((r) => (
                        <tr key={r.id}>
                          <td style={tdCell}><Badge text={r.kind} color={r.kind === 'renewal' ? colors.info : colors.danger} /></td>
                          <td style={tdCell}><Badge text={r.status} color={runStatusColor(r.status)} /></td>
                          <td style={tdCell}>{r.scanned.toLocaleString('en-NG')}</td>
                          <td style={tdCell}>{r.affected.toLocaleString('en-NG')}</td>
                          <td style={tdCell}>{r.notified.toLocaleString('en-NG')}</td>
                          <td style={{ ...tdCell, color: r.errors > 0 ? colors.danger : colors.text, fontWeight: r.errors > 0 ? 700 : 400 }}>{r.errors}</td>
                          <td style={tdCell}>{r.window}</td>
                          <td style={tdCell}>{timeAgo(r.ran_at)}</td>
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
    </Page>
  );
}
