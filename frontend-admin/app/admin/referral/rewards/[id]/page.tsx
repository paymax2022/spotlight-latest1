'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getRewardEntry, executeClawback, formatNaira } from '@/services/referralAdminService';
import type { RewardLedgerEntry } from '@/types/referralAdmin';
import { ReferralTabs, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

function badgeColor(status: string): string {
  switch (status) {
    case 'eligible': case 'paid':
      return colors.success;
    case 'clawed_back':
      return colors.danger;
    case 'earned': case 'normal':
      return colors.info;
    case 'vesting': case 'house':
      return colors.primary;
    default:
      return colors.warning;
  }
}

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
    <Page>
      <PageHeader
        title="Reward detail"
        subtitle="Single reward across its lifecycle, with clawback management (A-RWD-05)."
        actions={<Link href="/admin/referral/rewards" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Back</Link>}
      />
      <ReferralTabs active="rewards" />

      {loading ? <p style={{ color: colors.muted }}>Loading…</p>
        : (error && !data) ? <p style={{ color: colors.danger }}>{error}</p>
        : !data ? <p style={{ color: colors.muted }}>Reward not found.</p>
        : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Reward {data.id}</h2>
                <Badge text={data.state.replace(/_/g, ' ')} color={badgeColor(data.state)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12 }}>
                <Field label="Beneficiary" value={<><code>{data.beneficiary_id}</code>{data.is_house && <> <Badge text="house" color={badgeColor('house')} /></>}</>} />
                <Field label="Referred user" value={data.referred_user_id ? <code>{data.referred_user_id}</code> : '—'} />
                <Field label="Campaign" value={data.campaign_id ? <Link href={`/admin/referral/campaigns/${data.campaign_id}`}>{data.campaign_id}</Link> : '—'} />
                <Field label="Kind" value={<Badge text={data.kind} color={badgeColor('normal')} />} />
                <Field label="Amount" value={<strong>{formatNaira(data.amount_kobo)}</strong>} />
                <Field label="Currency" value={data.currency} />
                <Field label="Ledger entry" value={data.ledger_entry_id ? <code>{data.ledger_entry_id}</code> : '—'} />
                <Field label="Idempotency key" value={<code style={{ fontSize: 12 }}>{data.idempotency_key}</code>} />
                <Field label="Excluded from K-factor" value={data.excluded_from_kfactor ? 'Yes' : 'No'} />
                <Field label="Excluded from override" value={data.excluded_from_override ? 'Yes' : 'No'} />
                <Field label="Created" value={timeAgo(data.created_at)} />
                <Field label="Updated" value={timeAgo(data.updated_at)} />
              </div>
            </Card>

            <Card title="Clawback management (A-RWD-05)">
              {data.state === 'clawed_back' ? (
                <p style={{ color: colors.danger, fontWeight: 600, marginTop: 14 }}>This reward has already been clawed back.</p>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <p style={{ fontSize: 13, color: colors.text, marginTop: 0 }}>Reverse a fraudulent or invalid reward. Clawbacks post a reversing ledger entry (never an UPDATE) and emit an audit event.</p>
                  <div style={{ marginBottom: 12, maxWidth: 560 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reason (required, audited)</label>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate KYC identity / fraudulent referrer" />
                  </div>
                  {error && data && <p style={{ color: colors.danger }}>{error}</p>}
                  {done && <p style={{ color: colors.success }}>Clawback executed.</p>}
                  <Button variant="danger" onClick={clawback} disabled={busy || !canClawback}>{busy ? 'Processing…' : 'Execute clawback'}</Button>
                </div>
              )}
            </Card>
          </>
        )}
    </Page>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 3, color: colors.text }}>{value}</div>
    </div>
  );
}
