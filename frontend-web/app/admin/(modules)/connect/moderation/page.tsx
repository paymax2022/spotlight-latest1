'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listModerationCases } from '@/services/connectAdminService';
import type { ModerationCaseSummary } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'open', 'investigating', 'actioned', 'dismissed'];

function severityColor(severity: string): string {
  if (severity === 'critical' || severity === 'high') return colors.danger;
  if (severity === 'normal') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Moderation queue" subtitle="Reported content & users (§11.4). Every report is a case — never silent. AI moderation reason codes shown per item." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="cases" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading moderation queue…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No moderation cases in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Case</th><th style={thCell}>Content</th><th style={thCell}>Reason</th><th style={thCell}>AI reason codes</th><th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}>Reported</th><th style={thCell}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.case_id}</code></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.content_type}</td>
                  <td style={tdCell}>{r.reason}</td>
                  <td style={tdCell}>{r.ai_reason_codes.length ? r.ai_reason_codes.map((c) => <Badge key={c} text={c} color={colors.info} />) : <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={tdCell}><Badge text={r.severity} color={severityColor(r.severity)} /></td>
                  <td style={tdCell}><Badge text={r.status === 'actioned' ? 'resolved' : r.status === 'dismissed' ? 'closed' : r.status} color={r.status === 'actioned' ? colors.success : r.status === 'dismissed' ? colors.secondary : colors.warning} /></td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Link href={`/admin/connect/moderation/${r.id}`} style={{ color: colors.info, textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
