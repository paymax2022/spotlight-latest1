'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listModerationCases } from '@/services/connectAdminService';
import type { ModerationCaseSummary } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'open', 'investigating', 'actioned', 'dismissed'];

export default function ConnectModerationPage() {
  const [rows, setRows] = useState<ModerationCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listModerationCases(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Moderation queue" subtitle="Reported content & users (§11.4). Every report is a case — never silent. AI moderation reason codes shown per item." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="cases" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading moderation queue…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No moderation cases in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Case</th><th style={th()}>Content</th><th style={th()}>Reason</th><th style={th()}>AI reason codes</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>Reported</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.case_id}</code></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{r.content_type}</td>
                  <td style={td()}>{r.reason}</td>
                  <td style={td()}>{r.ai_reason_codes.length ? r.ai_reason_codes.map((c) => <Badge key={c} status="normal" label={c} />) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}><Badge status={r.severity} /></td>
                  <td style={td()}><Badge status={r.status === 'actioned' ? 'resolved' : r.status === 'dismissed' ? 'closed' : r.status} /></td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/connect/moderation/${r.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
