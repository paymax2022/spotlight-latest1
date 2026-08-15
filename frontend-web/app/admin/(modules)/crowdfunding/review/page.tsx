'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listReviewCampaigns } from '@/services/crowdfundingAdminService';
import type { CfReviewCampaign, CfRiskLevel } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

const STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: colors.warning, CHANGES_REQUESTED: colors.primary, ACTIVE: colors.success,
  COMPLETED: colors.info, FROZEN: colors.danger, REJECTED: colors.muted,
};
const RISK_COLOR: Record<CfRiskLevel, string> = { LOW: colors.success, MEDIUM: colors.warning, HIGH: colors.danger };

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

const FILTERS = ['PENDING_REVIEW', 'CHANGES_REQUESTED', 'ACTIVE', 'FROZEN', 'REJECTED', ''];

export default function CampaignReviewQueue() {
  const [items, setItems] = useState<CfReviewCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('PENDING_REVIEW');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listReviewCampaigns(filter || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <Page>
      <PageHeader title="Campaign Review" subtitle="Verify, approve, request changes, reject or freeze submitted campaigns." />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <Button key={s || 'all'} variant={filter === s ? 'primary' : 'outline'} sm onClick={() => setFilter(s)}>{s ? s.replace('_', ' ') : 'All'}</Button>
        ))}
        <Button variant="outline" sm style={{ marginLeft: 'auto' }} onClick={load}>Refresh</Button>
      </div>

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading campaigns…</p>
      ) : items.length === 0 ? (
        <p style={{ color: colors.muted }}>No campaigns in this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((c) => (
            <Link key={c.id} href={`/admin/crowdfunding/review/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <Card style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: '0.5rem', background: colors.headBg, overflow: 'hidden', flexShrink: 0 }}>
                  {c.coverImage ? <img src={c.coverImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Badge text={c.status.replace('_', ' ')} color={STATUS_BADGE[c.status]} />
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0.1rem 0.5rem', borderRadius: '9999px', background: colors.card, color: RISK_COLOR[c.riskLevel], border: `1px solid ${RISK_COLOR[c.riskLevel]}` }}>RISK {c.riskLevel}</span>
                    <span style={{ fontSize: '0.72rem', color: colors.muted, background: colors.headBg, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{c.category}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 2 }}>
                    {c.creatorName} ({c.creatorVerification}) · Goal {naira(c.goalKobo)} · submitted {new Date(c.submittedAt).toLocaleDateString()}
                  </div>
                </div>
                <span style={{ color: colors.muted, fontSize: '1.25rem' }}>›</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
