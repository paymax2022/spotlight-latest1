'use client';

import { useEffect, useState } from 'react';
import { listContentQa } from '@/services/staysAdminService';
import type { ContentQaItem } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Badge,
  StateBlock,
  FilterBar,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Button, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['pending', 'passed', 'failed'];
const SEVERITIES = ['low', 'medium', 'high'];

export default function StaysContentQaPage() {
  const [data, setData] = useState<ContentQaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');

  async function load() {
    setLoading(true); setError(null);
    try { setData(await listContentQa({ status: status || undefined, severity: severity || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, severity]);

  return (
    <Page>
      <PageHeader
        title="Content & photo QA"
        subtitle="Automated and manual quality flags on property content across both rails — resolve low-res photos, thin descriptions, duplicates and watermarks before they affect conversion."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="supply" />

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={label()}>Severity</label>
          <select style={select()} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </FilterBar>

      <Card title="QA flags">
        <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No content QA flags found.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={thCell}>Property</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>Supplier</th>
                  <th style={thCell}>Issue</th>
                  <th style={thCell}>Severity</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Detail</th>
                  <th style={thCell}>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.property_name}</td>
                    <td style={tdCell}><Badge status={c.rail} /></td>
                    <td style={tdCell}>{c.supplier_code}</td>
                    <td style={tdCell}>{c.issue_type.replace(/_/g, ' ')}</td>
                    <td style={tdCell}><Badge status={c.severity} /></td>
                    <td style={tdCell}><Badge status={c.status} /></td>
                    <td style={tdCell}>{c.detail}</td>
                    <td style={tdCell}>{timeAgo(c.flagged_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </Page>
  );
}
