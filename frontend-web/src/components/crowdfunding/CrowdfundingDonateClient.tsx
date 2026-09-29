'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { contribute, CrowdfundingApiError, getCampaign } from '@/src/lib/crowdfunding/api';
import { formatNaira } from '@/src/lib/crowdfunding/format';
import { mapRawStatus } from '@/src/types/crowdfunding-customer';
import type { CampaignDetail, RawContribution } from '@/src/types/crowdfunding-customer';

const MIN_KOBO = 10_000; // ₦100
const MAX_KOBO = 500_000_000; // ₦5,000,000
const SUGGESTED_NAIRA = [1000, 5000, 10000, 25000, 50000];

export default function CrowdfundingDonateClient({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [amountNaira, setAmountNaira] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<RawContribution | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getCampaign(campaignId);
        setCampaign(data);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to load this campaign.');
      } finally {
        setLoading(false);
      }
    })();
  }, [campaignId]);

  const amountKobo = Math.round(Number(amountNaira || 0) * 100);

  async function submit() {
    if (!amountNaira) { setMessage('Please enter an amount.'); return; }
    if (!Number.isFinite(amountKobo) || amountKobo < MIN_KOBO) { setMessage(`Minimum contribution is ${formatNaira(MIN_KOBO)}.`); return; }
    if (amountKobo > MAX_KOBO) { setMessage(`Maximum contribution is ${formatNaira(MAX_KOBO)}.`); return; }
    setBusy(true);
    setMessage('');
    try {
      const contribution = await contribute(campaignId, amountKobo);
      if (!contribution) return; // redirected to login
      setResult(contribution);
    } catch (e) {
      setMessage(e instanceof CrowdfundingApiError ? e.message : 'Unable to process your contribution.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div style={{ height: 240, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  if (!campaign) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p className="form-error">{message || 'Campaign not found.'}</p>
        <Link href="/crowdfunding" className="btn-outline py-2.5 px-4 text-[11px]">Back to Campaigns</Link>
      </div>
    );
  }

  if (result) {
    const status = mapRawStatus(result.status);
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 40 }}>{status === 'SUCCESSFUL' ? '✅' : status === 'REFUNDED' ? '↩️' : '⏳'}</p>
        <h3>{status === 'SUCCESSFUL' ? 'Thank you for your contribution!' : status === 'REFUNDED' ? 'Contribution refunded' : 'Contribution processing'}</h3>
        <p style={{ color: 'var(--foreground-muted)' }}>{formatNaira(result.amount_kobo)} to {campaign.title}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <Link href={`/crowdfunding/${campaignId}`} className="btn-outline py-2.5 px-4 text-[11px]">Back to Campaign</Link>
          <Link href="/crowdfunding/contributions" className="theme-btn">My Contributions</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-md p-4 md:p-5" style={{ maxWidth: 520, margin: '0 auto' }}>
      <p className="section-label mb-2">Contribute</p>
      <h1 className="font-display text-2xl text-foreground" style={{ marginBottom: 4 }}>{campaign.title}</h1>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--foreground-muted)' }}>
        {formatNaira(campaign.raisedKobo)} raised of {formatNaira(campaign.goalKobo)} goal
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {SUGGESTED_NAIRA.map((n) => (
          <button
            key={n}
            type="button"
            className={Number(amountNaira) === n ? 'btn-primary py-2 px-3 text-[11px]' : 'btn-outline py-2 px-3 text-[11px]'}
            onClick={() => setAmountNaira(String(n))}
          >
            {formatNaira(n * 100)}
          </button>
        ))}
      </div>

      <label className="d-block" style={{ marginBottom: 16 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Amount (₦)</span>
        <input
          type="number"
          className="form-input mt-1"
          min={MIN_KOBO / 100}
          value={amountNaira}
          onChange={(e) => setAmountNaira(e.target.value)}
          placeholder={`Minimum ${formatNaira(MIN_KOBO)}`}
        />
      </label>

      <p style={{ fontSize: 12, color: 'var(--foreground-dim)', marginBottom: 16 }}>
        Contributions are charged from your wallet balance. Make sure you have sufficient funds before continuing.
      </p>

      {message && <p className="form-error" style={{ marginBottom: 12 }}>{message}</p>}

      <button type="button" className="btn-primary py-3 px-4 text-[12px]" style={{ width: '100%' }} disabled={busy} onClick={() => void submit()}>
        {busy ? 'Processing…' : `Contribute ${amountKobo > 0 ? formatNaira(amountKobo) : ''}`}
      </button>
    </div>
  );
}
