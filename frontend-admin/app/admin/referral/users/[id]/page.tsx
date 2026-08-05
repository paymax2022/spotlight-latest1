'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getReferralUser360, interveneUser, formatNaira } from '@/services/referralAdminOpsService';
import type { ReferralUser360, InterventionAction } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, btnPrimary, btnDanger, input, label, th, td, timeAgo, StateBlock } from '../../_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

const ACTIONS: { value: InterventionAction; label: string }[] = [
  { value: 'adjust', label: 'Adjust balance' },
  { value: 'suspend', label: 'Suspend account' },
  { value: 'reverse', label: 'Reverse reward' },
  { value: 're_verify', label: 'Re-verify KYC' },
];

export default function ReferralUser360Page() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<ReferralUser360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<InterventionAction>('adjust');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReferralUser360(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  function askIntervene() {
    if (!data) return;
    if (!reason.trim()) { setMsg('A reason is required for any intervention (audited).'); return; }
    const requiresAmount = action === 'adjust' || action === 'reverse';
    const amountKobo = requiresAmount ? Math.round(parseFloat(amount || '0') * 100) : undefined;
    if (requiresAmount && (!amountKobo || amountKobo <= 0)) { setMsg('Enter a valid amount (₦).'); return; }
    setMsg(null);
    setConfirmOpen(true);
  }

  async function confirmIntervene(confirmReason: string) {
    if (!data) return;
    const requiresAmount = action === 'adjust' || action === 'reverse';
    const amountKobo = requiresAmount ? Math.round(parseFloat(amount || '0') * 100) : undefined;
    setBusy(true); setMsg(null);
    try {
      await interveneUser({ user_id: data.id, action, amount_kobo: amountKobo, reason: confirmReason });
      setMsg(`Intervention "${action}" recorded — audit event emitted.`);
      setReason(''); setAmount('');
      setConfirmOpen(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const needsAmount = action === 'adjust' || action === 'reverse';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={data ? data.name : 'User 360'}
        subtitle="Referral User 360: roles, earnings, referrals & risk score (A-USR-01) with manual intervention & support tools (A-USR-03/04)."
        action={<Link href="/admin/referral/users" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Users</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="User not found.">
        {data && (
          <>
            <Card title="Profile" right={<Badge status={data.status === 'active' ? 'active' : data.status === 'suspended' ? 'critical' : 'high'} label={data.status} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: '0.5rem' }}>
                <Kpi label="User ID" value={data.id} sub={data.email} />
                <Kpi label="Roles" value={data.roles.join(', ')} />
                <Kpi label="KYC tier" value={data.kyc_tier} />
                <Kpi label="Risk score" value={`${data.risk_score}/100`} accent={data.risk_score >= 70 ? '#b91c1c' : data.risk_score >= 40 ? '#9a3412' : '#15803d'} />
                <Kpi label="Total earned" value={formatNaira(data.total_earned_kobo)} />
                <Kpi label="Pending" value={formatNaira(data.pending_kobo)} accent="#9a3412" />
                <Kpi label="Clawed back" value={formatNaira(data.clawed_back_kobo)} accent={data.clawed_back_kobo > 0 ? '#b91c1c' : undefined} />
                <Kpi label="Referrals" value={`${data.active_referrals}/${data.referrals_count}`} sub="active / total" />
              </div>
            </Card>

            <Card title="Manual intervention (A-USR-03)">
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 0 }}>Adjust, suspend, reverse or re-verify. All actions are audited; money-affecting actions post reversing/adjusting ledger entries with an Idempotency-Key.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem', alignItems: 'end' }}>
                <div>
                  <label style={label()}>Action</label>
                  <select value={action} onChange={(e) => setAction(e.target.value as InterventionAction)} style={{ ...input(), cursor: 'pointer' }}>
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                {needsAmount && (
                  <div>
                    <label style={label()}>Amount (₦)</label>
                    <input style={input()} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000.00" inputMode="decimal" />
                  </div>
                )}
                <div>
                  <label style={label()}>Reason</label>
                  <input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill / fraud correction / dispute" />
                </div>
                <button disabled={busy} onClick={askIntervene} style={action === 'suspend' || action === 'reverse' ? btnDanger() : btnPrimary()}>{busy ? '…' : 'Apply'}</button>
              </div>
              {msg && <p style={{ color: msg.startsWith('Intervention') ? '#15803d' : '#b91c1c', fontSize: '0.8rem', marginTop: '0.5rem' }}>{msg}</p>}
            </Card>

            <Card title="Referrals">
              {data.referrals.length === 0 ? <p style={{ color: '#6b7280' }}>No referrals.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Referred user</th><th style={th()}>State</th><th style={th()}>Reward</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.referrals.map((r) => (
                      <tr key={r.id}><td style={td()}>{r.user_id}</td><td style={td()}>{r.state}</td><td style={td()}>{formatNaira(r.reward_kobo)}</td><td style={td()}>{timeAgo(r.created_at)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Earnings">
              {data.earnings.length === 0 ? <p style={{ color: '#6b7280' }}>No earnings.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Reward</th><th style={th()}>Kind</th><th style={th()}>State</th><th style={th()}>Amount</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.earnings.map((e) => (
                      <tr key={e.id}>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.id}</code></td>
                        <td style={td()}>{e.kind}</td>
                        <td style={td()}><Badge status={e.state} /></td>
                        <td style={td()}>{formatNaira(e.amount_kobo)}</td>
                        <td style={td()}>{timeAgo(e.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Audit trail">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th></tr></thead>
                <tbody>
                  {data.audit.map((a, i) => (
                    <tr key={i}><td style={td()}>{timeAgo(a.ts)}</td><td style={td()}>{a.actor}</td><td style={td()}>{a.action}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {confirmOpen ? (
              <ConfirmDialog
                open
                title={`${ACTIONS.find((a) => a.value === action)?.label ?? 'Intervene'} — ${data.name}`}
                level={action === 're_verify' ? 'warning' : 'critical'}
                description={`${data.name} (${data.id}) — this intervention is audited and cannot be silently undone.`}
                reasons={[
                  'Recorded in the audit log with your name, reason and timestamp.',
                  ...(needsAmount ? [`Posts ${action === 'reverse' ? 'reversing' : 'adjusting'} ledger entries${amount ? ` (₦${amount})` : ''} with an Idempotency-Key.`] : []),
                  ...(action === 'suspend' ? ['Suspends the account and blocks the user’s referral activity.'] : []),
                  ...(action === 're_verify' ? ['Forces the user to re-verify KYC before continuing.'] : []),
                ]}
                requireReason
                reasonPlaceholder="Basis for this intervention (recorded in the audit log)…"
                busy={busy}
                confirmLabel="Apply intervention"
                onConfirm={confirmIntervene}
                onCancel={() => { if (!busy) setConfirmOpen(false); }}
              />
            ) : null}
          </>
        )}
      </StateBlock>
    </div>
  );
}
