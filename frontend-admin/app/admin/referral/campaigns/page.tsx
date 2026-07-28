'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listCampaigns, formatNaira } from '@/services/referralAdminService';
import type { CampaignSummary } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Badge, btn, btnPrimary, th, td, StateBlock } from '../_ui';

const STATUSES = ['all', 'draft', 'scheduled', 'active', 'paused', 'throttled', 'ended'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Campaigns"
        subtitle="All referral campaigns, status & performance (A-CMP-01). Budget governor auto-pauses on fraud/burn spikes."
        action={<Link href="/admin/referral/campaigns/new" style={{ ...btnPrimary(), textDecoration: 'none' }}>+ New campaign</Link>}
      />
      <ReferralTabs active="campaigns" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: 'auto' }}><button onClick={load} style={btn()}>Refresh</button></span>
        </label>
      </Card>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No campaigns in this state.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Status</th><th style={th()}>Model</th><th style={th()}>Funded by</th><th style={th()}>Budget / spent</th><th style={th()}>Activations</th><th style={th()}>CPA</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><strong>{c.name}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.vertical}</div></td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}><Badge status="normal" label={c.reward_model} /></td>
                  <td style={td()}><Badge status={c.funded_by === 'merchant' ? 'vesting' : 'normal'} label={c.funded_by} /></td>
                  <td style={td()}>{formatNaira(c.budget_kobo)}<div style={{ fontSize: '0.72rem', color: c.spent_kobo / c.budget_kobo > 0.9 ? '#b91c1c' : '#9ca3af' }}>spent {formatNaira(c.spent_kobo)}</div></td>
                  <td style={td()}>{c.activations.toLocaleString('en-NG')}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.signups.toLocaleString('en-NG')} signups</div></td>
                  <td style={td()}>{c.cost_per_activation_kobo ? formatNaira(c.cost_per_activation_kobo) : '—'}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/referral/campaigns/${c.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
