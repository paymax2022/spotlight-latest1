'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listContributions } from '@/src/lib/crowdfunding/api';
import { formatNaira } from '@/src/lib/crowdfunding/format';
import type { Contribution, ContributionStatus } from '@/src/types/crowdfunding-customer';

const STATUS_CLASS: Record<ContributionStatus, string> = {
  SUCCESSFUL: 'badge-approved',
  PROCESSING: 'badge-pending',
  PENDING: 'badge-pending',
  FAILED: 'badge-rejected',
  REFUND_REQUESTED: 'badge-paid',
  REFUNDED: 'badge-rejected',
};

export default function CrowdfundingContributionsClient() {
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const result = await listContributions();
        setContributions(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load your contributions.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div style={{ height: 200, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="font-display text-3xl text-foreground" style={{ margin: 0 }}>My Contributions</h1>
        <Link href="/crowdfunding" className="btn-outline py-2 px-3 text-[11px]">Browse Campaigns</Link>
      </div>

      {error && <p className="form-error">{error}</p>}

      {contributions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--foreground-muted)' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🤝</p>
          <p>You haven&apos;t contributed to any campaigns yet.</p>
        </div>
      ) : (
        <div className="glass-card rounded-md" style={{ padding: '0 16px' }}>
          {contributions.map((c) => (
            <Link
              key={c.id}
              href={`/crowdfunding/contributions/${c.id}`}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border)', gap: 12, textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{c.campaignTitle}</span>
                  <span className={STATUS_CLASS[c.status] ?? 'badge-pending'} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>{new Date(c.createdAt).toLocaleString()}</p>
              </div>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatNaira(c.amountKobo)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
