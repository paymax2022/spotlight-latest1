'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listCampaigns, formatNaira } from '@/services/referralAdminService';
import type { CampaignSummary } from '@/types/referralAdmin';
import { ReferralTabs } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'draft', 'scheduled', 'active', 'paused', 'throttled', 'ended'];

function campaignStatusColor(status: string): string {
  if (status === 'active') return colors.success;
  if (status === 'paused' || status === 'throttled') return colors.warning;
  if (status === 'scheduled') return colors.info;
  return colors.secondary;
}

export default function CampaignsListPage() {
  const [rows, setRows] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCampaigns(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <Page>
      <PageHeader
        title="Campaigns"
        subtitle="All referral campaigns, status & performance (A-CMP-01). Budget governor auto-pauses on fraud/burn spikes."
        actions={<Link href="/admin/referral/campaigns/new"><Button variant="primary">+ New campaign</Button></Link>}
      />
      <ReferralTabs active="campaigns" />

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: 'auto' }}><Button variant="outline" sm onClick={load}>Refresh</Button></span>
        </label>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, fontSize: 13, padding: 14 }}>{error}</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No campaigns in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Name</th><th style={thCell}>Status</th><th style={thCell}>Model</th><th style={thCell}>Funded by</th><th style={thCell}>Budget / spent</th><th style={thCell}>Activations</th><th style={thCell}>CPA</th><th style={thCell}></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}><strong>{c.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.vertical}</div></td>
                  <td style={tdCell}><Badge text={c.status} color={campaignStatusColor(c.status)} /></td>
                  <td style={tdCell}><Badge text={c.reward_model} color={colors.info} /></td>
                  <td style={tdCell}><Badge text={c.funded_by} color={c.funded_by === 'merchant' ? colors.primary : colors.info} /></td>
                  <td style={tdCell}>{formatNaira(c.budget_kobo)}<div style={{ fontSize: '0.72rem', color: c.spent_kobo / c.budget_kobo > 0.9 ? colors.danger : colors.muted }}>spent {formatNaira(c.spent_kobo)}</div></td>
                  <td style={tdCell}>{c.activations.toLocaleString('en-NG')}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.signups.toLocaleString('en-NG')} signups</div></td>
                  <td style={tdCell}>{c.cost_per_activation_kobo ? formatNaira(c.cost_per_activation_kobo) : '—'}</td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Link href={`/admin/referral/campaigns/${c.id}`} style={{ color: colors.info, textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
