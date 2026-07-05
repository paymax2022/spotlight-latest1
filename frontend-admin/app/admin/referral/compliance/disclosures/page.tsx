'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listDisclosures } from '@/services/referralAdminOpsService';
import type { Disclosure } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../../_ui';

const STATUSES = ['all', 'draft', 'active', 'archived'];

export default function DisclosuresPage() {
  const [rows, setRows] = useState<Disclosure[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDisclosures(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Compliance — Disclosures & T&Cs"
        subtitle="Versioned terms and earnings disclosures with acceptance tracking (A-CMPL-02)."
        action={<Link href="/admin/referral/compliance" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Policy</Link>}
      />

      <Card title="Disclosure versions" right={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No disclosures.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Title</th><th style={th()}>Version</th><th style={th()}>Status</th>
              <th style={th()}>Effective</th><th style={th()}>Required</th><th style={th()}>Acceptance</th><th style={th()}>Updated</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((d) => (
                <tr key={d.id}>
                  <td style={td()}>{d.title}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{d.version}</code></td>
                  <td style={td()}><Badge status={d.status === 'active' ? 'active' : d.status === 'draft' ? 'draft' : 'closed'} label={d.status} /></td>
                  <td style={td()}>{d.effective_date}</td>
                  <td style={td()}>{d.required ? 'Yes' : 'No'}</td>
                  <td style={td()}>{`${(d.acceptance_rate * 100).toFixed(0)}%`}</td>
                  <td style={td()}>{timeAgo(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
