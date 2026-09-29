'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CrowdfundingApiError, getContribution, requestRefund } from '@/src/lib/crowdfunding/api';
import { formatNaira } from '@/src/lib/crowdfunding/format';
import type { Contribution } from '@/src/types/crowdfunding-customer';

export default function CrowdfundingContributionDetailClient({ contributionId }: { contributionId: string }) {
  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const result = await getContribution(contributionId);
        setContribution(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load this contribution.');
      } finally {
        setLoading(false);
      }
    })();
  }, [contributionId]);

  async function onRequestRefund() {
    setRequesting(true);
    setMessage('');
    try {
      await requestRefund(contributionId, reason.trim() || undefined);
      setContribution((prev) => prev ? { ...prev, status: 'REFUND_REQUESTED' } : prev);
      setMessage('Refund requested. An admin will review it shortly.');
    } catch (e) {
      setMessage(e instanceof CrowdfundingApiError ? e.message : 'Unable to request a refund.');
    } finally {
      setRequesting(false);
    }
  }

  if (loading) {
    return <div style={{ height: 220, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  if (error || !contribution) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p className="form-error">{error || 'Contribution not found.'}</p>
        <Link href="/crowdfunding/contributions" className="btn-outline py-2.5 px-4 text-[11px]">Back to My Contributions</Link>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-md p-4 md:p-5" style={{ maxWidth: 560, margin: '0 auto' }}>
      <p className="section-label mb-2">Contribution</p>
      <h1 className="font-display text-2xl text-foreground" style={{ marginBottom: 16 }}>{contribution.campaignTitle}</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Reference</span><span>{contribution.reference}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Amount</span><span style={{ fontWeight: 700 }}>{formatNaira(contribution.amountKobo)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Status</span><span>{contribution.status.replace(/_/g, ' ')}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Date</span><span>{new Date(contribution.createdAt).toLocaleString()}</span></div>
        {contribution.rewardTierTitle && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Reward</span><span>{contribution.rewardTierTitle}</span></div>}
      </div>

      {message && <p style={{ fontSize: 13, color: /unable/i.test(message) ? '#dc2626' : '#059669', marginBottom: 12 }}>{message}</p>}

      {contribution.refundEligible && contribution.status !== 'REFUND_REQUESTED' ? (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Request a refund</p>
          <textarea className="form-input" rows={2} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginBottom: 8 }} />
          <button type="button" className="btn-outline py-2 px-3 text-[11px]" disabled={requesting} onClick={() => void onRequestRefund()}>
            {requesting ? 'Requesting…' : 'Request Refund'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--foreground-dim)', marginTop: 6 }}>This records your request only — a team member reviews and processes any refund.</p>
        </div>
      ) : null}

      <Link href="/crowdfunding/contributions" className="btn-outline py-2.5 px-4 text-[11px]" style={{ marginTop: 16, display: 'inline-block' }}>
        Back to My Contributions
      </Link>
    </div>
  );
}
