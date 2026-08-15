'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listConsents } from '@/services/referralAdminOpsService';
import type { ConsentRecord } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Compliance — Consent & data management"
        subtitle="NDPC consent records and retention windows (A-CMPL-05)."
        actions={<Link href="/admin/referral/compliance"><Button variant="outline">← Policy</Button></Link>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Consent records</h2>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, fontSize: 13, padding: 14 }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No consent records.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead><tr>
              <th style={thCell}>User</th><th style={thCell}>Type</th><th style={thCell}>Granted</th>
              <th style={thCell}>Version</th><th style={thCell}>Retention until</th><th style={thCell}>Source</th><th style={thCell}>Updated</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}><Link href={`/admin/referral/users/${c.user_id}`} style={{ color: colors.primary, textDecoration: 'none' }}>{c.user_id}</Link></td>
                  <td style={tdCell}>{c.consent_type.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><Badge text={c.granted ? 'granted' : 'denied'} color={c.granted ? colors.success : colors.secondary} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{c.version}</code></td>
                  <td style={tdCell}>{c.retention_until}</td>
                  <td style={tdCell}>{c.source}</td>
                  <td style={tdCell}>{timeAgo(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
