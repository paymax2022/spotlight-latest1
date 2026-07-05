'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listConsents } from '@/services/referralAdminOpsService';
import type { ConsentRecord } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../../_ui';

const TYPES = ['all', 'referral_terms', 'marketing', 'data_share', 'profiling'];

export default function ConsentPage() {
  const [rows, setRows] = useState<ConsentRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listConsents(type)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Compliance — Consent & data management"
        subtitle="NDPC consent records and retention windows (A-CMPL-05)."
        action={<Link href="/admin/referral/compliance" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Policy</Link>}
      />

      <Card title="Consent records" right={
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No consent records.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>User</th><th style={th()}>Type</th><th style={th()}>Granted</th>
              <th style={th()}>Version</th><th style={th()}>Retention until</th><th style={th()}>Source</th><th style={th()}>Updated</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((c) => (
                <tr key={c.id}>
                  <td style={td()}><Link href={`/admin/referral/users/${c.user_id}`} style={{ color: '#340075' }}>{c.user_id}</Link></td>
                  <td style={td()}>{c.consent_type.replace(/_/g, ' ')}</td>
                  <td style={td()}><Badge status={c.granted ? 'active' : 'closed'} label={c.granted ? 'granted' : 'denied'} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.version}</code></td>
                  <td style={td()}>{c.retention_until}</td>
                  <td style={td()}>{c.source}</td>
                  <td style={td()}>{timeAgo(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
