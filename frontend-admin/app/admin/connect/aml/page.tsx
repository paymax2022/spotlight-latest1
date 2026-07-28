'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listAmlAlerts, formatNaira } from '@/services/connectAdminService';
import type { AmlAlert } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'open', 'investigating', 'escalated', 'cleared', 'str_filed'];

export default function ConnectAmlPage() {
  const [rows, setRows] = useState<AmlAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAmlAlerts(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="AML alert queue" subtitle="Velocity / structuring / smurfing / gifting-ring alerts (§11.5). Reason codes only — no raw PII. STR/SAR filed to NFIU within 24h." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="cases" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading AML alerts…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No AML alerts in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Subject</th><th style={th()}>Rule</th><th style={th()}>Reason codes</th><th style={th()}>Amount</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>Raised</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.subject_id}</code></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{a.rule.replace(/_/g, ' ')}</td>
                  <td style={td()}>{a.reason_codes.map((c) => <Badge key={c} status="high" label={c} />)}</td>
                  <td style={td()}>{a.amount_kobo ? formatNaira(a.amount_kobo) : '—'}</td>
                  <td style={td()}><Badge status={a.severity} /></td>
                  <td style={td()}><Badge status={a.status === 'cleared' ? 'resolved' : a.status === 'str_filed' ? 'closed' : a.status === 'escalated' ? 'critical' : a.status} label={a.status.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{timeAgo(a.created_at)}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/connect/aml/${a.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
