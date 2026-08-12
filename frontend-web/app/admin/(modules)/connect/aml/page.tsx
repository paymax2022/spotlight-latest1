'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listAmlAlerts, formatNaira } from '@/services/connectAdminService';
import type { AmlAlert } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'open', 'investigating', 'escalated', 'cleared', 'str_filed'];

function severityColor(sev: string): string {
  if (sev === 'critical') return colors.danger;
  if (sev === 'high') return colors.warning;
  return colors.info;
}

function statusColor(status: string): string {
  if (status === 'cleared') return colors.success;
  if (status === 'str_filed') return colors.secondary;
  if (status === 'escalated') return colors.danger;
  return colors.info;
}

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
    <Page>
      <PageHeader title="AML alert queue" subtitle="Velocity / structuring / smurfing / gifting-ring alerts (§11.5). Reason codes only — no raw PII. STR/SAR filed to NFIU within 24h." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="cases" />

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading AML alerts…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No AML alerts in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Subject</th><th style={thCell}>Rule</th><th style={thCell}>Reason codes</th><th style={thCell}>Amount</th><th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}>Raised</th><th style={thCell}></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.subject_id}</code></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{a.rule.replace(/_/g, ' ')}</td>
                  <td style={tdCell}>{a.reason_codes.map((c) => <Badge key={c} text={c} color={colors.warning} />)}</td>
                  <td style={tdCell}>{a.amount_kobo ? formatNaira(a.amount_kobo) : '—'}</td>
                  <td style={tdCell}><Badge text={a.severity} color={severityColor(a.severity)} /></td>
                  <td style={tdCell}><Badge text={a.status.replace(/_/g, ' ')} color={statusColor(a.status)} /></td>
                  <td style={tdCell}>{timeAgo(a.created_at)}</td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Link href={`/admin/connect/aml/${a.id}`} style={{ color: colors.primary, textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
