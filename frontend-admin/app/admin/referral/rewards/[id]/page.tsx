'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getRewardEntry, executeClawback, formatNaira } from '@/services/referralAdminService';
import type { RewardLedgerEntry } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Badge, btn, btnDanger, input, label, timeAgo, StateBlock } from '../../_ui';

export default function RewardDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<RewardLedgerEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getRewardEntry(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function clawback() {
    if (!data || !reason.trim()) { setError('A reason is required to claw back.'); return; }
    setBusy(true); setError(null);
    try { await executeClawback({ reward_id: data.id, reason: reason.trim() }); setData({ ...data, state: 'clawed_back' }); setDone(true); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const canClawback = data && data.state !== 'clawed_back';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reward detail"
        subtitle="Single reward across its lifecycle, with clawback management (A-RWD-05)."
        action={<Link href="/admin/referral/rewards" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Back</Link>}
      />
      <ReferralTabs active="rewards" />

      <StateBlock loading={loading} error={error && !data ? error : null} empty={!data} emptyText="Reward not found.">
        {data && (
          <>
            <Card title={`Reward ${data.id}`} right={<Badge status={data.state} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem' }}>
                <Field label="Beneficiary" value={<><code>{data.beneficiary_id}</code>{data.is_house && <> <Badge status="house" label="house" /></>}</>} />
                <Field label="Referred user" value={data.referred_user_id ? <code>{data.referred_user_id}</code> : '—'} />
                <Field label="Campaign" value={data.campaign_id ? <Link href={`/admin/referral/campaigns/${data.campaign_id}`} style={{ color: '#1d4ed8' }}>{data.campaign_id}</Link> : '—'} />
                <Field label="Kind" value={<Badge status="normal" label={data.kind} />} />
                <Field label="Amount" value={<strong>{formatNaira(data.amount_kobo)}</strong>} />
                <Field label="Currency" value={data.currency} />
                <Field label="Ledger entry" value={data.ledger_entry_id ? <code>{data.ledger_entry_id}</code> : '—'} />
                <Field label="Idempotency key" value={<code style={{ fontSize: '0.76rem' }}>{data.idempotency_key}</code>} />
                <Field label="Excluded from K-factor" value={data.excluded_from_kfactor ? 'Yes' : 'No'} />
                <Field label="Excluded from override" value={data.excluded_from_override ? 'Yes' : 'No'} />
                <Field label="Created" value={timeAgo(data.created_at)} />
                <Field label="Updated" value={timeAgo(data.updated_at)} />
              </div>
            </Card>

            <Card title="Clawback management (A-RWD-05)">
              {data.state === 'clawed_back' ? (
                <p style={{ color: '#b91c1c', fontWeight: 600 }}>This reward has already been clawed back.</p>
              ) : (
                <>
                  <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: 0 }}>Reverse a fraudulent or invalid reward. Clawbacks post a reversing ledger entry (never an UPDATE) and emit an audit event.</p>
                  <div style={{ marginBottom: '0.75rem', maxWidth: 560 }}>
                    <label style={label()}>Reason (required, audited)</label>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} style={input()} placeholder="e.g. Duplicate KYC identity / fraudulent referrer" />
                  </div>
                  {error && data && <p style={{ color: '#dc2626' }}>{error}</p>}
                  {done && <p style={{ color: '#15803d' }}>Clawback executed.</p>}
                  <button onClick={clawback} disabled={busy || !canClawback} style={{ ...btnDanger(), opacity: busy ? 0.6 : 1 }}>{busy ? 'Processing…' : 'Execute clawback'}</button>
                </>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: '#111827' }}>{value}</div>
    </div>
  );
}
