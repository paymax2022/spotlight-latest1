'use client';

import { useEffect, useState } from 'react';
import { listContentQa } from '@/services/staysAdminService';
import type { ContentQaItem } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  StateBlock,
  FilterBar,
  btn,
  th,
  td,
  label,
  select,
  timeAgo,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Content & photo QA"
        subtitle="Automated and manual quality flags on property content across both rails — resolve low-res photos, thin descriptions, duplicates and watermarks before they affect conversion."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
        <button onClick={load} style={btn()}>Refresh</button>
      </FilterBar>

      <Card title="QA flags">
        <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No content QA flags found.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={th()}>Property</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>Supplier</th>
                  <th style={th()}>Issue</th>
                  <th style={th()}>Severity</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Detail</th>
                  <th style={th()}>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}>{c.property_name}</td>
                    <td style={td()}><Badge status={c.rail} /></td>
                    <td style={td()}>{c.supplier_code}</td>
                    <td style={td()}>{c.issue_type.replace(/_/g, ' ')}</td>
                    <td style={td()}><Badge status={c.severity} /></td>
                    <td style={td()}><Badge status={c.status} /></td>
                    <td style={td()}>{c.detail}</td>
                    <td style={td()}>{timeAgo(c.flagged_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
